import express from "express";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import webPush from "web-push";
import { WebSocketServer } from "ws";
import { createPersistence, loadHouseholds } from "./persistence.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const port = Number(process.env.PORT || 4173);
const gracePeriodMs = Number(process.env.GRACE_PERIOD_MS || 10000);
const defaultHouseholdId = "demo-household";
const dataFilePath = process.env.DATA_FILE || path.join(rootDir, "data", "safezone.json");
const vapidKeysFilePath =
  process.env.VAPID_KEYS_FILE || path.join(path.dirname(dataFilePath), "vapid-keys.json");

function loadVapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
      source: "environment"
    };
  }

  try {
    if (existsSync(vapidKeysFilePath)) {
      const stored = JSON.parse(readFileSync(vapidKeysFilePath, "utf8"));
      if (stored.publicKey && stored.privateKey) {
        return { ...stored, source: "persistent-file" };
      }
    }
  } catch (error) {
    console.warn("Could not read persisted VAPID keys; generating a replacement.", error);
  }

  const generated = webPush.generateVAPIDKeys();
  mkdirSync(path.dirname(vapidKeysFilePath), { recursive: true });
  writeFileSync(
    vapidKeysFilePath,
    JSON.stringify({ publicKey: generated.publicKey, privateKey: generated.privateKey }, null, 2),
    { mode: 0o600 }
  );
  return { ...generated, source: "persistent-file" };
}

const vapidKeys = loadVapidKeys();
const vapidPublicKey = vapidKeys.publicKey;
const vapidPrivateKey = vapidKeys.privateKey;
const vapidSubject = process.env.VAPID_SUBJECT || "mailto:hello@safezone.local";

webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function createHousehold(data = {}) {
  return {
    id: data.id || defaultHouseholdId,
    patientName: data.patientName || "Loved One",
    patientRelationship: data.patientRelationship || "Family member",
    caregiverName: data.caregiverName || "Caregiver",
    zones: Array.isArray(data.zones) ? data.zones : [],
    subscriptions: Array.isArray(data.subscriptions) ? data.subscriptions : [],
    history: Array.isArray(data.history) ? data.history : [],
    careResponse: data.careResponse || null,
    pairingSessions: Array.isArray(data.pairingSessions) ? data.pairingSessions : [],
    patientDeviceTokenHash: data.patientDeviceTokenHash || null,
    pairedAt: data.pairedAt || null,
    geofence: {
      state: data.geofence?.state || "unknown",
      graceStartedAt: data.geofence?.graceStartedAt || null,
      alertSentForExit: Boolean(data.geofence?.alertSentForExit)
    },
    clients: new Map()
  };
}

const storedHouseholds = loadHouseholds(dataFilePath);
const households = new Map(
  (storedHouseholds.length > 0 ? storedHouseholds : [{ id: defaultHouseholdId }]).map((household) => [
    household.id,
    createHousehold(household)
  ])
);
const persistence = createPersistence(dataFilePath);

app.use(express.json({ limit: "1mb" }));
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});

function getHousehold(id = defaultHouseholdId) {
  if (!households.has(id)) {
    households.set(id, createHousehold({ id }));
    persistence.schedule(households);
  }

  return households.get(id);
}

function nowIso() {
  return new Date().toISOString();
}

function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

function tokenMatches(token, expectedHash) {
  if (!token || !expectedHash) return false;
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

function metersBetween(a, b) {
  const earthRadiusM = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthRadiusM * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function projectMeters(point, origin) {
  const earthRadiusM = 6371000;
  const lat = toRad(point.lat);
  const originLat = toRad(origin.lat);
  return {
    x: toRad(point.lng - origin.lng) * earthRadiusM * Math.cos((lat + originLat) / 2),
    y: toRad(point.lat - origin.lat) * earthRadiusM
  };
}

function distanceToSegmentMeters(point, a, b) {
  const p = projectMeters(point, point);
  const start = projectMeters(a, point);
  const end = projectMeters(b, point);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    return Math.hypot(p.x - start.x, p.y - start.y);
  }

  const t = Math.max(0, Math.min(1, ((p.x - start.x) * dx + (p.y - start.y) * dy) / lengthSq));
  return Math.hypot(p.x - (start.x + t * dx), p.y - (start.y + t * dy));
}

function pointInPolygon(point, polygon) {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersects =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi || Number.EPSILON) + xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function zoneMetrics(point, zone) {
  if (!zone.points || zone.points.length < 3) {
    return null;
  }

  const centroid = zone.points.reduce(
    (acc, zonePoint) => ({ lat: acc.lat + zonePoint.lat, lng: acc.lng + zonePoint.lng }),
    { lat: 0, lng: 0 }
  );
  centroid.lat /= zone.points.length;
  centroid.lng /= zone.points.length;

  let minBoundaryDistanceM = Infinity;
  let radiusM = 0;

  for (let i = 0; i < zone.points.length; i += 1) {
    const current = zone.points[i];
    const next = zone.points[(i + 1) % zone.points.length];
    minBoundaryDistanceM = Math.min(minBoundaryDistanceM, distanceToSegmentMeters(point, current, next));
    radiusM = Math.max(radiusM, metersBetween(centroid, current));
  }

  return {
    zone,
    isInside: pointInPolygon(point, zone.points),
    distanceToBoundaryM: Number.isFinite(minBoundaryDistanceM) ? minBoundaryDistanceM : null,
    cautionDistanceM: Math.max(10, radiusM * 0.2)
  };
}

function evaluateGeofence(household, point, timestamp) {
  const activeZones = household.zones.filter((zone) => zone.isActive !== false);

  if (activeZones.length === 0) {
    household.geofence = {
      state: "unknown",
      graceStartedAt: null,
      alertSentForExit: false
    };
    return {
      state: "unknown",
      previousState: "unknown",
      stateChanged: false,
      zoneId: null,
      distanceToBoundaryM: null,
      graceEndsAt: null,
      shouldPush: false
    };
  }

  const metrics = activeZones.map((zone) => zoneMetrics(point, zone)).filter(Boolean);
  const containingZone = metrics.find((metric) => metric.isInside);
  const previousState = household.geofence.state;
  let state = "safe";
  let graceEndsAt = null;
  let shouldPush = false;
  let chosenMetric = containingZone || metrics[0];

  if (containingZone) {
    state =
      containingZone.distanceToBoundaryM <= containingZone.cautionDistanceM ? "caution" : "safe";
    household.geofence.graceStartedAt = null;
    household.geofence.alertSentForExit = false;
  } else {
    if (!household.geofence.graceStartedAt || previousState === "safe" || previousState === "caution") {
      household.geofence.graceStartedAt = Date.parse(timestamp);
      household.geofence.alertSentForExit = false;
    }

    const elapsed = Date.parse(timestamp) - household.geofence.graceStartedAt;
    graceEndsAt = new Date(household.geofence.graceStartedAt + gracePeriodMs).toISOString();
    state = elapsed >= gracePeriodMs ? "alert" : "grace";

    if (state === "alert" && !household.geofence.alertSentForExit) {
      shouldPush = true;
      household.geofence.alertSentForExit = true;
    }
  }

  household.geofence.state = state;

  return {
    state,
    previousState,
    stateChanged: previousState !== state,
    zoneId: chosenMetric?.zone?.id || null,
    distanceToBoundaryM: chosenMetric?.distanceToBoundaryM ?? null,
    graceEndsAt,
    shouldPush
  };
}

function wsSend(client, payload) {
  if (client.readyState === client.OPEN) {
    client.send(JSON.stringify(payload));
  }
}

function broadcast(household, payload) {
  for (const client of household.clients.keys()) {
    wsSend(client, payload);
  }
}

function broadcastPresence(household) {
  const viewers = [...household.clients.values()]
    .filter((client) => client.role === "caregiver")
    .map((client) => ({ id: client.id, label: client.label }));

  broadcast(household, {
    type: "presence",
    viewers
  });
}

async function sendBoundaryPush(household, ping) {
  if (household.subscriptions.length === 0) {
    return;
  }

  const payload = JSON.stringify({
    title: "Navora alert",
    body: `${household.patientName} appears to have left the safe zone.`,
    data: {
      url: "/caregiver",
      ping
    }
  });

  const results = await Promise.allSettled(
    household.subscriptions.map((subscription) =>
      webPush.sendNotification(subscription.subscriptionObject, payload)
    )
  );

  household.subscriptions = household.subscriptions.filter((subscription, index) => {
    const result = results[index];
    const statusCode = result.status === "rejected" ? result.reason?.statusCode : null;
    return statusCode !== 404 && statusCode !== 410;
  });
  persistence.schedule(households);
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    environment: process.env.NODE_ENV || "development",
    persistence: true,
    vapidKeySource: vapidKeys.source
  });
});

app.get("/api/vapid-public-key", (_req, res) => {
  res.json({ publicKey: vapidPublicKey });
});

function publicHousehold(household) {
  const latestPing = household.history.at(-1) || null;
  return {
    id: household.id,
    patientName: household.patientName,
    patientRelationship: household.patientRelationship,
    caregiverName: household.caregiverName,
    pairedAt: household.pairedAt,
    zoneCount: household.zones.length,
    latestPing
  };
}

app.post("/api/households", (req, res) => {
  const patientName = String(req.body.patientName || "").trim().slice(0, 80);
  const caregiverName = String(req.body.caregiverName || "").trim().slice(0, 80);

  if (!patientName || !caregiverName) {
    return res.status(400).json({ error: "Caregiver and patient names are required." });
  }

  const household = createHousehold({
    id: randomUUID(),
    patientName,
    caregiverName,
    patientRelationship: String(req.body.patientRelationship || "Family member").slice(0, 80)
  });
  households.set(household.id, household);
  persistence.schedule(households);
  res.status(201).json({ household: publicHousehold(household) });
});

app.get("/api/households/:id", (req, res) => {
  const household = households.get(req.params.id);
  if (!household) {
    return res.status(404).json({ error: "Household not found." });
  }
  res.json({ household: publicHousehold(household) });
});

app.patch("/api/households/:id", (req, res) => {
  const household = households.get(req.params.id);
  if (!household) {
    return res.status(404).json({ error: "Household not found." });
  }

  const patientName = String(req.body.patientName || "").trim().slice(0, 80);
  const caregiverName = String(req.body.caregiverName || "").trim().slice(0, 80);
  if (!patientName || !caregiverName) {
    return res.status(400).json({ error: "Both names are required." });
  }

  household.patientName = patientName;
  household.caregiverName = caregiverName;
  if (req.body.patientRelationship) {
    household.patientRelationship = String(req.body.patientRelationship).trim().slice(0, 80);
  }
  persistence.schedule(households);
  broadcast(household, { type: "profile", patientName, caregiverName });
  res.json({ household: publicHousehold(household) });
});

app.post("/api/pairing", (req, res) => {
  const household = households.get(req.body.householdId);
  if (!household) {
    return res.status(404).json({ error: "Household not found." });
  }

  const token = randomBytes(32).toString("base64url");
  const shortCode = String(100000 + Math.floor(Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const pairing = {
    id: randomUUID(),
    tokenHash: hashToken(token),
    expiresAt,
    claimedAt: null
  };
  const shortCodePairing = {
    id: randomUUID(),
    tokenHash: hashToken(shortCode),
    expiresAt,
    claimedAt: null
  };

  household.pairingSessions = household.pairingSessions
    .filter((session) => Date.parse(session.expiresAt) > Date.now() && !session.claimedAt)
    .slice(-2);
  household.pairingSessions.push(pairing, shortCodePairing);
  persistence.schedule(households);

  const baseURL = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
  const patientURL = `${baseURL}/patient?household=${encodeURIComponent(household.id)}&pair=${encodeURIComponent(token)}`;
  res.status(201).json({
    pairingId: pairing.id,
    expiresAt: pairing.expiresAt,
    patientURL,
    shortCode
  });
});

app.get("/api/pairing/status", (req, res) => {
  const household = households.get(String(req.query.householdId || ""));
  if (!household) {
    return res.status(404).json({ error: "Household not found." });
  }
  res.json({ paired: Boolean(household.pairedAt), pairedAt: household.pairedAt });
});

function claimPairingSession(household, token) {
  const pairing = household.pairingSessions.find(
    (session) =>
      !session.claimedAt &&
      Date.parse(session.expiresAt) > Date.now() &&
      tokenMatches(token, session.tokenHash)
  );
  if (!pairing) return null;

  const deviceToken = randomBytes(32).toString("base64url");
  pairing.claimedAt = nowIso();
  household.patientDeviceTokenHash = hashToken(deviceToken);
  household.pairedAt = pairing.claimedAt;
  persistence.schedule(households);
  broadcast(household, {
    type: "patient_paired",
    pairedAt: household.pairedAt
  });
  return deviceToken;
}

app.post("/api/pairing/claim", (req, res) => {
  const household = households.get(req.body.householdId);
  if (!household) {
    return res.status(404).json({ error: "Household not found." });
  }

  const deviceToken = claimPairingSession(household, String(req.body.token || ""));
  if (!deviceToken) {
    return res.status(410).json({ error: "This pairing link is invalid or has expired." });
  }

  res.json({
    deviceToken,
    household: publicHousehold(household)
  });
});

app.post("/api/pairing/claim-code", (req, res) => {
  const code = String(req.body.code || "").replace(/\D/g, "");
  if (code.length !== 6) {
    return res.status(400).json({ error: "Enter the 6-digit code from the caregiver screen." });
  }

  for (const household of households.values()) {
    const deviceToken = claimPairingSession(household, code);
    if (deviceToken) {
      return res.json({
        deviceToken,
        household: publicHousehold(household)
      });
    }
  }

  res.status(410).json({ error: "This pairing code is invalid or has expired. Ask for a fresh code." });
});

app.get("/api/zones", (req, res) => {
  const household = getHousehold(String(req.query.householdId || defaultHouseholdId));
  res.json({ zones: household.zones });
});

app.post("/api/zones", (req, res) => {
  const household = getHousehold(req.body.householdId || defaultHouseholdId);
  const zone = {
    id: req.body.id || randomUUID(),
    householdId: household.id,
    name: req.body.name || "Safe Zone",
    color: req.body.color || "#8fbf9f",
    points: Array.isArray(req.body.points) ? req.body.points : [],
    isActive: req.body.isActive !== false
  };

  if (zone.points.length < 3) {
    return res.status(400).json({ error: "A zone needs at least three points." });
  }

  if (
    zone.points.length > 200 ||
    zone.points.some(
      (point) =>
        !Number.isFinite(Number(point.lat)) ||
        !Number.isFinite(Number(point.lng)) ||
        Number(point.lat) < -90 ||
        Number(point.lat) > 90 ||
        Number(point.lng) < -180 ||
        Number(point.lng) > 180
    )
  ) {
    return res.status(400).json({ error: "The zone contains invalid coordinates." });
  }

  const existingIndex = household.zones.findIndex((existingZone) => existingZone.id === zone.id);
  if (existingIndex >= 0) {
    household.zones[existingIndex] = zone;
  } else {
    household.zones.push(zone);
  }

  persistence.schedule(households);
  broadcast(household, { type: "zones", zones: household.zones });
  res.status(existingIndex >= 0 ? 200 : 201).json({ zone, zones: household.zones });
});

app.get("/api/history", (req, res) => {
  const household = getHousehold(String(req.query.householdId || defaultHouseholdId));
  const since = req.query.since ? Date.parse(String(req.query.since)) : 0;
  const history = household.history.filter((ping) => Date.parse(ping.timestamp) >= since);
  res.json({ history });
});

app.post("/api/subscribe", (req, res) => {
  const household = getHousehold(req.body.householdId || defaultHouseholdId);

  if (!req.body.subscriptionObject?.endpoint) {
    return res.status(400).json({ error: "Missing push subscription." });
  }

  const subscription = {
    id: randomUUID(),
    householdId: household.id,
    caregiverLabel: req.body.caregiverLabel || "Caregiver",
    subscriptionObject: req.body.subscriptionObject
  };

  household.subscriptions = household.subscriptions.filter(
    (existing) => existing.subscriptionObject.endpoint !== subscription.subscriptionObject.endpoint
  );
  household.subscriptions.push(subscription);
  household.subscriptions = household.subscriptions.slice(-20);

  persistence.schedule(households);
  res.status(201).json({ ok: true, id: subscription.id });
});

app.post("/api/respond", (req, res) => {
  const household = getHousehold(req.body.householdId || defaultHouseholdId);
  const action = req.body.action;
  const caregiverLabel = req.body.caregiverLabel || "Caregiver";

  if (!["acknowledge", "going", "cant", "takeover", "request_help", "clear"].includes(action)) {
    return res.status(400).json({ error: "Unknown care response action." });
  }

  household.careDeclines = household.careDeclines || [];

  if (action === "clear") {
    household.careResponse = null;
    household.careDeclines = [];
  } else if (action === "cant") {
    const decline = {
      id: randomUUID(),
      caregiverLabel,
      status: "declined",
      timestamp: nowIso(),
      resolvedAt: null
    };
    household.careDeclines = [decline, ...household.careDeclines].slice(0, 10);
    broadcast(household, { type: "care_declines", declines: household.careDeclines });
    persistence.schedule(households);
    return res.json({ ok: true, response: decline });
  } else {
    household.careResponse = {
      id: randomUUID(),
      caregiverLabel:
        action === "request_help"
          ? household.patientName
          : caregiverLabel,
      status:
        action === "request_help"
          ? "help_requested"
          : action === "takeover"
            ? "takeover"
            : "responding",
      timestamp: nowIso(),
      resolvedAt: null
    };
  }

  broadcast(household, {
    type: "care_response",
    response: household.careResponse
  });
  persistence.schedule(households);
  res.json({ ok: true, response: household.careResponse });
});

app.post("/api/location", async (req, res) => {
  const requestedHouseholdId = req.body.householdId || defaultHouseholdId;
  const household = households.get(requestedHouseholdId);
  if (!household) {
    return res.status(404).json({ error: "Household not found." });
  }
  const authorization = req.get("authorization") || "";
  const deviceToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : req.body.deviceToken;

  if (requestedHouseholdId !== defaultHouseholdId && !household.patientDeviceTokenHash) {
    return res.status(403).json({ error: "Pair a patient phone before sharing location." });
  }

  if (household.patientDeviceTokenHash && !tokenMatches(deviceToken, household.patientDeviceTokenHash)) {
    return res.status(401).json({ error: "This patient device is not paired with the household." });
  }

  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  const accuracy = Number(req.body.accuracy);
  const timestamp =
    req.body.timestamp && Number.isFinite(Date.parse(req.body.timestamp))
      ? new Date(req.body.timestamp).toISOString()
      : nowIso();
  const battery = typeof req.body.battery === "number" ? req.body.battery : null;

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return res.status(400).json({ error: "lat and lng must be valid geographic coordinates." });
  }

  const geofence = evaluateGeofence(household, { lat, lng }, timestamp);
  const ping = {
    id: randomUUID(),
    householdId: household.id,
    lat,
    lng,
    accuracy: Number.isFinite(accuracy) ? Math.max(0, Math.min(accuracy, 10000)) : null,
    timestamp,
    battery,
    stateAtTime: geofence.state,
    zoneId: geofence.zoneId,
    distanceToBoundaryM: geofence.distanceToBoundaryM,
    graceEndsAt: geofence.graceEndsAt
  };

  household.history.push(ping);
  household.history = household.history.slice(-2000);
  persistence.schedule(households);

  broadcast(household, { type: "location", ...ping });

  if (geofence.stateChanged) {
    broadcast(household, {
      type: "state_change",
      state: geofence.state,
      previousState: geofence.previousState,
      graceEndsAt: geofence.graceEndsAt,
      timestamp
    });

    if ((geofence.state === "safe" || geofence.state === "caution") && (household.careResponse || (household.careDeclines || []).length)) {
      household.careResponse = null;
      household.careDeclines = [];
      broadcast(household, { type: "care_response", response: null });
      broadcast(household, { type: "care_declines", declines: [] });
      persistence.schedule(households);
    }
  }

  if (geofence.shouldPush) {
    sendBoundaryPush(household, ping).catch((error) => {
      console.error("Failed to send push notification", error);
    });
  }

  res.json({ ok: true, state: geofence.state, previousState: geofence.previousState });
});

wss.on("connection", (socket, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const household = getHousehold(url.searchParams.get("householdId") || defaultHouseholdId);
  const meta = {
    id: randomUUID(),
    role: url.searchParams.get("role") || "caregiver",
    label: url.searchParams.get("label") || "Caregiver"
  };

  household.clients.set(socket, meta);
  wsSend(socket, { type: "hello", householdId: household.id, zones: household.zones });
  wsSend(socket, { type: "care_response", response: household.careResponse });
  broadcastPresence(household);

  socket.on("close", () => {
    household.clients.delete(socket);
    broadcastPresence(household);
  });
});

if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

server.listen(port, () => {
  console.log(`Navora backend listening on http://localhost:${port}`);
  console.log(`Web Push keys loaded from ${vapidKeys.source}.`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received. Saving Navora state...`);

  for (const client of wss.clients) {
    client.close(1001, "Server restarting");
  }

  await persistence.flush();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

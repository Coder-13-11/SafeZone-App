import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";

export function loadHouseholds(filePath) {
  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return Array.isArray(parsed.households) ? parsed.households : [];
  } catch (error) {
    console.error(`Could not read persisted Navora data at ${filePath}`, error);
    return [];
  }
}

export function createPersistence(filePath) {
  let timer = null;
  let pendingSnapshot = null;
  let activeWrite = Promise.resolve();

  function serialize(households) {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      households: [...households.values()].map((household) => ({
        id: household.id,
        patientName: household.patientName,
        patientRelationship: household.patientRelationship,
        caregiverName: household.caregiverName,
        zones: household.zones,
        subscriptions: household.subscriptions,
        history: household.history.slice(-2000),
        careResponse: household.careResponse,
        pairingSessions: household.pairingSessions,
        patientDeviceTokenHash: household.patientDeviceTokenHash,
        pairedAt: household.pairedAt,
        geofence: household.geofence
      }))
    };
  }

  async function writeSnapshot(snapshot) {
    const directory = path.dirname(filePath);
    const temporaryPath = `${filePath}.tmp`;
    mkdirSync(directory, { recursive: true });
    await writeFile(temporaryPath, JSON.stringify(snapshot), { mode: 0o600 });
    await rename(temporaryPath, filePath);
  }

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    if (!pendingSnapshot) {
      return activeWrite;
    }

    const snapshot = pendingSnapshot;
    pendingSnapshot = null;
    activeWrite = activeWrite
      .then(() => writeSnapshot(snapshot))
      .catch((error) => console.error("Navora persistence failed", error));
    return activeWrite;
  }

  return {
    schedule(households) {
      pendingSnapshot = serialize(households);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 750);
    },
    flush
  };
}

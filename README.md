# SafeZone

SafeZone is a browser-based safety app for families caring for someone with dementia. It turns two devices a family already owns into a shared safety system:

- The **patient device** securely streams its browser-provided location.
- The **caregiver device** answers three questions immediately: Are they safe? Where are they? Do I need to act?

SafeZone does not claim room-level precision. The caregiver map always displays the GPS accuracy radius reported by the patient device.

## Hackathon demo

```bash
npm install
npm run dev
```

Open:

- Product entry: `http://localhost:5173`
- Guided onboarding: `http://localhost:5173/onboarding`
- Caregiver: `http://localhost:5173/caregiver`
- Patient: `http://localhost:5173/patient`
- Guided story: `http://localhost:5173/caregiver?demo=1`

The guided story is explicitly labeled simulated movement. It sends a fixed demonstration path through the real backend geofence state machine so judges see safe, approaching, confirmation, alert, family response, and safe return states.

## Production build

```bash
npm ci
npm run build
npm start
```

The Express process serves the production frontend, REST API, WebSocket endpoint, push service, and health endpoint from one port.

## Required production environment

Copy `.env.example` into your deployment platform’s environment configuration. Do not commit real VAPID keys.

Generate VAPID keys once:

```bash
npm run vapid:generate
```

Set:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `PUBLIC_URL` to the deployed HTTPS origin used by patient pairing QR codes
- `DATA_FILE` to a path on persistent storage

Browser geolocation, service workers, and Web Push require HTTPS outside localhost.
Scanning a QR code from a separate patient phone therefore requires an HTTPS deployment; a `localhost` pairing URL works only on the same machine.

## Live deployment

- **App:** https://safe-zone-app.vercel.app
- **Supabase project:** `rjlvxopxrfljhcftuqpw` → https://rjlvxopxrfljhcftuqpw.supabase.co
- **GitHub:** https://github.com/Coder-13-11/SafeZone-App

Vercel build env vars are configured in `vercel.json`. Pushing to `main` redeploys automatically.

### Supabase one-time setup

1. **SQL Editor** → run all of `supabase/schema.sql`
2. **Authentication → URL Configuration**
   - Site URL: `https://safe-zone-app.vercel.app`
   - Redirect URLs (add all of these):
     - `https://safe-zone-app.vercel.app/onboarding`
     - `https://safe-zone-app.vercel.app/caregiver`
     - `http://localhost:5173/onboarding`
     - `http://localhost:5173/caregiver`
3. **Authentication → Email Templates → Magic Link**  
   Include the one-time code so sign-in works even when the email link opens in a different browser:

```html
<h2>Your SafeZone sign-in code</h2>
<p>Enter this code in SafeZone:</p>
<p style="font-size:24px;font-weight:700;letter-spacing:4px">{{ .Token }}</p>
<p>Or open this link in the <strong>same browser</strong> where you requested sign-in:</p>
<p><a href="{{ .ConfirmationURL }}">Sign in to SafeZone</a></p>
```
4. **Edge Functions → Secrets** (never commit `service_role` or `VAPID_PRIVATE_KEY`):

```bash
supabase secrets set \
  SUPABASE_URL=https://rjlvxopxrfljhcftuqpw.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=<from Supabase Settings → API> \
  PUBLIC_URL=https://safe-zone-app.vercel.app \
  VAPID_PUBLIC_KEY=BJJlOSiaWxLqMIPJIHzqVfODNyMlcejedSZ-Gq_ddt3ksflZXrmH9joVQHEgOJKgIRgfmd3eMew1cXCdZoFe_m0 \
  VAPID_PRIVATE_KEY=<from npm run vapid:generate> \
  VAPID_SUBJECT=mailto:you@example.com
```

5. Deploy edge functions:

```bash
supabase link --project-ref rjlvxopxrfljhcftuqpw
npm run supabase:functions
```

## Vercel + Supabase deployment

Use this path for public PWA reliability. Vercel serves the React app; Supabase stores accounts, households, zones, pairing sessions, patient-device tokens, location history, push subscriptions, care responses, and realtime updates.

1. Create a Supabase project.
2. Run the SQL in `supabase/schema.sql` in the Supabase SQL editor, or install the Supabase CLI and run:

```bash
supabase link --project-ref <your-project-ref>
npm run supabase:schema
```

3. Generate VAPID keys once:

```bash
npm run vapid:generate
```

4. Set Supabase Edge Function secrets:

```bash
supabase secrets set \
  SUPABASE_URL=https://<project-ref>.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
  PUBLIC_URL=https://<your-vercel-domain> \
  VAPID_PUBLIC_KEY=<generated-public-key> \
  VAPID_PRIVATE_KEY=<generated-private-key> \
  VAPID_SUBJECT=mailto:you@example.com
```

5. Deploy the functions:

```bash
npm run supabase:functions
```

6. In Vercel, set:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_PUBLIC_URL`
- `VITE_VAPID_PUBLIC_KEY`

7. Deploy the app to Vercel with:

```bash
npm run build
```

`vercel.json` is included for SPA routing and service-worker cache headers.

When these Vercel variables exist, SafeZone automatically uses Supabase Auth, Postgres, Edge Functions, and Realtime instead of the local Express JSON prototype.

## PWA reliability boundary

SafeZone can make a PWA reliable for accounts, pairing, storage, realtime dashboards, history, and notifications. A PWA cannot continuously collect GPS after iOS or Android suspends or closes the browser/web app. The patient phone must keep SafeZone open and location permission allowed for continuous web location updates.

For closed-app background location, build a native patient tracker with iOS Core Location / Android foreground location service and keep the caregiver dashboard as the PWA.

## Docker deployment

```bash
docker build -t safezone .
docker run --rm \
  -p 4173:4173 \
  --env-file .env \
  -v safezone-data:/data \
  safezone
```

Deploy the same container to any host that supports:

- HTTPS
- WebSocket upgrades
- A persistent volume mounted at `/data`
- The environment variables above

Health check: `GET /api/health`

## Demo checklist

1. Open the guided story on the presentation screen.
2. Click **Start live story**.
3. Narrate the progression:
   - “SafeZone starts with reassurance, not a map.”
   - “Care Confidence translates five technical signals into one understandable answer.”
   - “A gentle warning appears before a true crossing.”
   - “The server—not the browser—is the geofence source of truth.”
   - “When an alert becomes real, family members can claim responsibility.”
   - “The patient receives gentle positive feedback after returning safely.”
4. Open `/patient` on a phone to demonstrate the real two-device flow.

## Important deployment notes

- The included JSON persistence is suitable for a single-container hackathon deployment.
- Run only one backend instance against a given data file.
- For horizontal scaling, replace the file persistence and in-memory WebSocket presence with a shared database/pub-sub layer.
- iOS background Web Push requires installing the PWA to the Home Screen first.
- Browser background geolocation remains constrained by the operating system; SafeZone does not imply native-app background guarantees.

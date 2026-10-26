# Even Uber – Even Hub Display App

React + TypeScript app that shows an Uber ride on Even Realities G2 glasses. It
runs inside the Even App's WebView on the phone and draws to the glasses
through the Even Hub SDK.

**The React UI is a phone-side preview — it never reaches the glasses.** The
glasses get a separate six-container page built in [`src/glasses/`](src/glasses/);
see [`GLASSES_RENDERING.md`](GLASSES_RENDERING.md).

## Two ways to run

| Mode | What holds the ride | Used for |
|---|---|---|
| **Standalone** (`.ehpk`) | The page itself, persisted to `localStorage` | Real use. No PC or server. Ride details come from **Paste from Uber** — see [`SHORTCUT.md`](SHORTCUT.md) — or the built-in **Simulate a ride**. |
| **Dev server** | `server.ts` (Express, port 3000) | Development. Accepts `POST /api/ride-update` from curl, the iOS companion app or the Uber backend. |

The app picks a mode at startup by asking for `/health`: a dev server answers,
the packaged app has nothing there. Both modes apply the same validation,
merging and expiry rules (`src/models/rideStore.ts`).

## Setup

Requires Node.js 20.19+ or 22.12+ (Vite 7's floor). CI uses 22.

```bash
cd even-hub-display
npm ci
```

Use `npm ci`, not `npm install`. `package-lock.json` is committed; a fresh
resolve crashes npm 10's resolver on an optional-peer cycle in vitest. If you
change dependencies, regenerate the lockfile with npm 11 (`npx npm@11 install`).

## Commands

```bash
npm run dev          # Vite UI on 127.0.0.1:5173 + API on 127.0.0.1:3000
npm run dev:glasses  # Same, with Vite on 0.0.0.0 so the Even App can load it
npm run qr           # QR code for the dev URL — scan it in the Even App
npm test             # Unit tests (vitest)
npm run type-check   # App and server
npm run build        # Type-check + production build into dist/
npm run pack         # Build, then package dist/ as EvenUber.ehpk
```

## Trying it in a browser

Run `npm run dev`, open http://127.0.0.1:5173/, then push a ride:

```bash
curl -X POST http://127.0.0.1:3000/api/ride-update \
  -H "Content-Type: application/json" \
  -d '{
    "driverName": "John D.",
    "driverRating": 4.9,
    "vehicleMake": "Toyota",
    "vehicleModel": "Prius",
    "vehicleColor": "Silver",
    "licensePlate": "ABC123",
    "etaMinutes": 3,
    "requesterLat": 37.7755,
    "requesterLng": -122.4180,
    "timestamp": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
  }'
```

`timestamp` matters: the ETA counts down from it, and a ride stops being shown
once it's stale (15 min en route, 5 min waiting at the pickup, 2 h on a trip,
60 s after it ends). Add
`"status": "arriving" | "arrived" | "ontrip" | "completed" | "cancelled"` to
move it through its lifecycle; a bare status update merges onto the ride
already showing. Outside the Even App the glasses calls fail harmlessly — a
"❌ Glasses page create and rebuild both failed" console line is expected — and
the page works as a normal web app.

### API (dev server only)

| Endpoint | Purpose |
|---|---|
| `POST /api/ride-update` | Apply an update. `400` if an en-route update lacks `driverName`/`etaMinutes`; `{"status":"ignored"}` for a status update with no ride to apply it to |
| `GET /api/ride` | The active ride, or `404` |
| `POST /api/ride-clear` | Drop the active ride |
| `GET /api/status` | Uptime, active ride, when it was last updated |
| `GET /health` | Health check — also how the app detects dev-server mode |
| `POST /api/debug-log` | Glasses log lines relayed from the WebView, printed by the server |

## Layout

```
src/
├── App.tsx              # Ride source polling, history, views
├── rideSource.ts        # Dev-server vs standalone ride storage
├── demoRide.ts          # "Simulate a ride"
├── components/          # Phone-side UI (PasteFromUber, RideCard, …)
├── glasses/             # Everything that reaches the G2 — see GLASSES_RENDERING.md
└── models/
    ├── RideData.ts      # The ride payload, shared with server.ts
    ├── rideStore.ts     # Validation, merging and expiry for the active ride
    ├── rideMerge.ts     # Folding a partial update onto the current ride
    ├── rideTiming.ts    # ETA countdown, staleness, trip distance
    ├── rideHistory.ts   # History entries from the ride over time
    └── uberText.ts      # Ride details from text read off the Uber screen
server.ts                # Dev server
app.json                 # Even Hub package manifest
```

## Deploying to the glasses

```bash
npm run pack
```

produces `EvenUber.ehpk` (gitignored); see the Even Hub docs for installing a
package. While developing, `npm run dev:glasses` + `npm run qr` loads the live
dev build in the Even App instead.

`vite.config.ts` pins the build target to Safari 14 / Chrome 87 — the output
that was hardware-tested — since the bundle runs in whatever WebView the
phone's OS provides.

## Resources

- Even Hub docs: https://hub.evenrealities.com/docs
- Community: https://discord.gg/GsuDkKDXDe

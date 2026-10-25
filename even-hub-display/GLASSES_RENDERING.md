# Rendering to the G2 Glasses

**The React component tree does not appear on the glasses.** It is a phone-side
preview. Output to the G2 goes through the Even Hub SDK's container model, which
is implemented in [`src/glasses/`](src/glasses/).

This surprises people, and the project's own docs asserted otherwise for a
while, so it's worth being explicit.

---

## How it actually works

The page runs inside the **Even App's WebView**, where the host injects
`window.flutter_inappwebview.callHandler`. The SDK bridges to it. Rendering to
the glasses means creating absolutely positioned **containers** once, then
updating their contents in place:

```ts
const bridge = await waitForEvenAppBridge()

await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({ ... }))
await bridge.textContainerUpgrade(new TextContainerUpgrade({
  containerID: 4, containerName: 'eta', content: '3 MIN'
}))
```

There is no HTML, no CSS, and no layout engine on the glasses. What you write is
what gets drawn.

> The SDK's README shows plain object literals in these calls. The shipped
> TypeScript types require **class instances** — they carry a `toJson()` used on
> the way to native. `renderer.ts` constructs them at the boundary.

## Constraints

Taken from the SDK's own type declarations, not the README — which omits the
image cap:

| Constraint | Value |
|---|---|
| Total containers | 1–12 |
| Text containers | max 8 |
| Image containers | max 4 |
| Image width | 20–288 px |
| Image height | 20–144 px |
| Event capture | exactly one container with `isEventCapture: 1` |
| `zOrderIndex` | all containers or none; unique when present |

`validateLayout()` in `layout.ts` enforces every one of these before we call the
SDK, because a violation otherwise comes back as a bare
`StartUpPageCreateResult.invalid` with no indication of what was wrong.

## Layout

Five text containers on the left, the map image on the right:

```
┌──────────────────────────────┬──────────────────┐
│ John D. ★4.9        (driver) │                  │
│ Silver Toyota Prius (vehicle)│                  │
│ Plate ABC123        (plate)  │   map (image)    │
│                              │   280 × 144      │
│ 3 MIN               (eta)    │                  │
│ ON THE WAY          (status) │                  │
└──────────────────────────────┴──────────────────┘
                576 × 288
```

Six containers total — comfortably inside every limit, leaving headroom.

## Files

| File | Role |
|---|---|
| `constants.ts` | Geometry, container IDs, SDK limits |
| `layout.ts` | Container definitions + validation. No SDK imports, so it's testable without a device |
| `format.ts` | `RideData` → the text for each container; diffing |
| `rasterize.ts` | Draws the map to a canvas and converts to bytes |
| `bridge.ts` | Acquires the bridge, or reports its absence |
| `renderer.ts` | Lifecycle, SDK type conversion, incremental updates |
| `useGlasses.ts` | React hook wiring it to the current ride |

## Running in a browser

`acquireBridge()` feature-detects `window.flutter_inappwebview.callHandler`
before doing anything, and races `waitForEvenAppBridge()` against a 5-second
timeout. Outside the Even App you get one console line —

```
ℹ️ Not running in Even App WebView — glasses output disabled
```

— and the page behaves like an ordinary web app. `npm run dev` is unaffected.

The SDK is loaded with a dynamic `import()`, so it is code-split out of the main
bundle and never fetched in a plain browser.

## Efficiency

Every update crosses a Bluetooth LE link, so:

- Text is **diffed** — only lines whose content changed are sent, not all five
  on every 2-second poll.
- The map image is re-sent only when the coordinates or ETA actually change.
  It is by far the most expensive payload.

The renderer also **repaints itself every 10 seconds**, because the ETA counts
down from the ride's timestamp while no new data arrives — in the standalone
app nothing new comes in between pastes. A refresh that changes nothing sends
nothing; one that rolls the minute over sends the ETA line (and, before
pickup, the map, whose range ring tracks the ETA).

It also keeps the latest ride from before the page exists. On reopen the ride
is restored from storage before the host hands over the bridge; the page used
to come up on the idle screen and stay there until something changed.

## ✅ Verified on hardware (G2 + iPhone, October 2026)

- **Image byte format:** 8-bit grayscale (`RASTER_FORMAT = 'grayscale'`) renders
  correctly. The PNG path is not needed.
- **Text sizing:** the current `MAX_CHARS` budgets fit — no clipping or wrapping
  on the ride card.
- **Lifecycle:** en route → arrived (range ring removed) → trip complete → idle
  all render as expected.

Two host behaviours the SDK's validator and docs don't tell you:

1. **Unknown fields make the whole page `invalid`.** A stray `id`/`name` on one
   text container (from an object spread) passed `validateEvenHubPageContainer`
   but the host rejected the page. Pass only the documented properties.
2. **One startup page per session.** A second `createStartUpPageContainer` —
   from a page reload, HMR, or React StrictMode's double mount — returns
   `invalid`. `renderer.ts` falls back to `rebuildPageContainer` with the same
   layout.

## Testing on the glasses

```bash
npm run dev:glasses   # Vite on 0.0.0.0:5173, API on 127.0.0.1:3000 (proxied)
npm run qr            # QR for http://<this machine's LAN IP>:5173 — scan in the Even App
```

Phone and PC must share a network; Windows may ask to allow Node.js through the
firewall. The WebView's console isn't visible, so glasses log lines are also
POSTed to `/api/debug-log` and printed by the server (`[glasses:info] …`).
Push test rides with `curl` to `/api/ride-update` as in the README.

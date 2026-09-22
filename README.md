# Navigator

A GitHub Pages PWA for bounded, first-person exploration of real OpenStreetMap streets. **Prototype C** adds an eye-height, heading-driven chevron to Prototype B’s opt-in GPS and compass tethering. Sensors are off until you enable them; the app never requests a camera and does not provide route guidance.

- Live app: https://stewalexander-com.github.io/navigator/
- Architecture: https://stewalexander-com.github.io/navigator/architecture.html
- Local: `npm ci`, `npm run dev`, open the printed URL at `/navigator/`.
- Production: `npm test && npm run build`, then `npm run preview`.

## Controls

WASD translates, arrow keys turn/look, and dragging changes the view. Touch buttons support movement and turning. Recenter restores the starting pose. Manual exploration stays within 120 m of the loaded area's origin; scene visibility ends at 180 m.

**Use my location** (header or field guide) opens an explicit prompt, then requests Geolocation and, on iPhone, motion & orientation permission from that tap. While enabled, your real position moves the camera and your compass turns it; movement buttons hide, and drag adjusts pitch only. If the compass is denied or absent, drag and the turn buttons keep controlling heading. Recenter becomes **Snap** (jump to the latest fix). Toggling the button again returns to manual controls at the current place.

The app starts with a bundled, real OSM area. The field guide offers an explicit live Overpass refresh, falling back to the OSM API if Overpass is unavailable. Overpass can be unavailable or rate-limited; a failed refresh retains the current scene. Refreshed and GPS-downloaded data last for the current session. The bundled area and shell work offline after the service worker finishes installation.

## Architecture and scope

Read `public/architecture.html` for the complete staged architecture, explicit adaptations, privacy model and platform limitations. MapLibre controls the true 1.65 m eye-height camera. A single Three.js custom layer batches extruded OSM footprints, ground and roads into three world draw calls, plus four for the hovering chevron. GPU shaders enforce distance fog and cutoff. OSM conversion and building triangulation run in a worker. Native `fill-extrusion` is deliberately replaced by this inspectable bounded renderer.

Buildings use real OSM footprints, including polygon holes. Missing height tags use simple defaults. Windows and road widths are illustrative. No surveyed façade, terrain, collision detection, sun or camera heading correction, or route engine is claimed in this stage.

## Budgets

90,000 building vertices; 160 buildings; 18,000 road vertices; 180 m rendered radius; 1.5 maximum device pixel ratio; 8 MiB response cap; one 800 m GPS square loaded at a time (500 m retry if the response cap is hit). Complex buildings downgrade to bounding boxes under pressure before remaining distant features are omitted. Geometry replacement disposes the old buffers. A future chunk pass will add pooling and ingestion-based sectors.

Sensor thresholds (`src/sensors.js`): fixes worse than ±60 m are ignored; motion implying more than 15 m/s beyond the combined accuracy radii is rejected, recovering after three consecutive rejections or 30 s; position eases with a 0.55 s time constant and snaps above 45 m; heading eases with a 0.22 s time constant. The render loop sleeps once the pose settles within 1 cm and 0.05°, so a stationary user costs no frames.

Performance UI shows measurements, not hardcoded success values. Geometry byte counts exclude road buffers, browser and GPU overhead. The frame interval is requestAnimationFrame timing while moving, not GPU execution time. Total GPU memory is unavailable. Physical-device 15–20 minute sessions remain untested until recorded.

## Deployment

The Pages workflow installs the lockfile, runs tests, builds, uploads `dist`, and deploys. GitHub repository Settings → Pages must use GitHub Actions. Vite base, PWA scope and service worker scope are `/navigator/`. No API keys or environment secrets are required. App dependencies are bundled locally, not loaded from a CDN at runtime.

## Data and assets

OpenStreetMap data is © OpenStreetMap contributors, available under the ODbL: https://www.openstreetmap.org/copyright. The fixed snapshot's provenance is in `public/osm-provenance.json`; the raw OSM download is preserved in `public/osm-snapshot.json`. Do not replace this with fabricated data under an OSM label. GPS areas are live Overpass/OSM API downloads of the 800 m square around your fix; when a fix lies inside the bundled Los Angeles box, the bundled snapshot is reused instead of downloading.

The supplied reference image is preserved unchanged and displayed rotated 90° clockwise on the architecture page using CSS. It is a reference, not the 3D scene background. It is excluded from the offline shell cache.

## Reproduce browser validation

Run `npx playwright install chromium`, start `npm run preview -- --port 4173` after building, then run `npm run test:browser`. Screenshots and raw measurements go to ignored `test-results/`. For Prototype C occlusion checks, also start `npm run dev -- --port 5173` and run `npm run test:chevron`; this checks partial/full/behind-wall cases and a real OSM wall through the production renderer. These checks cover movement, recenter, mouse look, dialogs, narrow-screen layout, same-origin startup requests, and a real offline reload. A second browser context grants geolocation and drives the real Geolocation API with Playwright fixes plus synthetic `deviceorientationabsolute` events: opt-in dialog, first fix, eased movement and travel course, compass heading with drag locked out, an inaccurate fix being ignored, a walk that re-anchors a live square (Overpass answered with the bundled real snapshot), and stopping. A third context denies geolocation and must stay usable manually. Results are recorded in `docs/validation.md`.

## Hovering chevron

A cyan beveled chevron floats at 1.65 m eye height, 4.5 m ahead of the view, with a 30° tilt for readability. Body, edges, glow and ground shadow are depth-tested against the same building geometry as the world. It consumes `player.heading`, the same resolved heading as the camera: smoothed compass when available, manual look otherwise. GPS travel course remains separate and does not override the chevron. Sun/camera fusion is deferred to its assigned stages; this is heading indication, not route guidance or a measured travel direction. The total draw-call budget remains seven, including four for the chevron. See [Organic Maps ideas and implementation](docs/organic-maps-reference.md).

## GPS and compass (Prototype B)

Position uses `navigator.geolocation.watchPosition` with high accuracy; the Geolocation API exposes no polling rate, so adaptivity comes from filtering and from the idle render loop rather than from sensor duty cycling. Heading uses `deviceorientationabsolute` where available, otherwise `deviceorientation`; iOS supplies `webkitCompassHeading` and requires `DeviceOrientationEvent.requestPermission()` inside the enabling tap. Non-absolute `alpha` values are never treated as a compass. The facing direction is derived from the device rotation matrix by projecting the screen-up axis (device flat) or the rear-camera axis (device upright) onto the ground, whichever is longer, and correcting for `screen.orientation.angle`.

Hiding the tab stops the position watch and orientation listener; returning restarts them. Readings live only in memory; nothing is persisted or sent to any server of ours. Enabling GPS does send the 800 m bounding box to Overpass or the OSM API, and that is stated in the prompt. Compass heading is magnetic, uncorrected by sun or camera (Prototypes D and Tier 2), and can be disturbed indoors or near vehicles. Physical iPhone and Android walking results are not yet recorded; Chromium-driven checks are not a substitute.

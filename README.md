# Navigator

A GitHub Pages PWA for bounded, first-person exploration of real OpenStreetMap streets. **v0.1.1 · Prototype F** adds an ingest-time street-sector graph for the bundled area and optional GPS free look, retaining bounded streaming, shadow alignment and the compass chevron. Sensors are off until you enable them; the app never requests a camera and does not provide route guidance.

- Live app: https://stewalexander-com.github.io/navigator/
- Architecture: https://stewalexander-com.github.io/navigator/architecture.html
- Local: `npm ci`, `npm run dev`, open the printed URL at `/navigator/`.
- Production: `npm test && npm run build`, then `npm run preview`.

## Controls

WASD translates, arrow keys turn/look, and dragging changes the view. Touch buttons support movement and turning. Recenter restores the starting pose. Manual exploration stays within 120 m of the loaded area's origin; scene visibility ends at 180 m.

**Use my location** (header or field guide) opens an explicit prompt, then requests Geolocation and, on iPhone, motion & orientation permission from that tap. While enabled, your real position moves the camera and your compass turns it; movement buttons hide, and drag adjusts pitch only. Tap **View: compass** to enter **View: free look**: drag or use the turn buttons while GPS keeps moving your position. Compass readings continue unchanged, and the chevron keeps its resolved compass bearing while you look around. Tap the same button to ease the view back to compass-follow. If the compass is denied or absent, drag and the turn buttons keep controlling heading. Recenter becomes **Snap** (jump to the latest fix). Toggling the button again returns to manual controls at the current place.

The app starts with a bundled, real OSM area. The field guide offers an explicit live Overpass refresh, falling back to the OSM API if Overpass is unavailable. Overpass can be unavailable or rate-limited; a failed refresh retains the current scene. Refreshed and GPS-downloaded data last for the current session. The bundled area and shell work offline after the service worker finishes installation.

## Architecture and scope

Read `public/architecture.html` for the complete staged architecture, explicit adaptations, privacy model and platform limitations. MapLibre controls the true 1.65 m eye-height camera. A single Three.js custom layer batches extruded OSM footprints, ground and roads into three world draw calls, plus four for the hovering chevron. GPU shaders enforce distance fog and cutoff. OSM conversion and building triangulation run in a worker. Native `fill-extrusion` is deliberately replaced by this inspectable bounded renderer.

Buildings use real OSM footprints, including polygon holes. Missing height tags use simple defaults. Windows and road widths are illustrative. No surveyed façade, terrain, collision detection, camera heading correction, or route engine is claimed in this stage. Sun correction requires the explicit shadow alignment described below.

## Budgets

90,000 building vertices; 160 buildings; 18,000 road vertices; 180 m rendered radius; 1.5 maximum device pixel ratio; 8 MiB response cap; one 800 m GPS square loaded at a time (500 m retry if the response cap is hit). Complex buildings downgrade to bounding boxes under pressure before remaining distant features are omitted. Geometry replacement disposes old GPU buffers. Prototype E reuses cached chunk geometry; Prototype F supplies ingest-time street sectors for the bundled snapshot; broader buffer pooling remains future work.

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

A cyan beveled chevron floats at 1.65 m eye height, 4.5 m ahead of the view, with a 30° tilt for readability. Body, edges, glow and ground shadow are depth-tested against the same building geometry as the world. It consumes the smoothed compass heading when available, including during free look; otherwise it uses manual view heading. Compass-follow uses the same smoothing for the camera. Free look changes only view direction, while retaining GPS position, compass observations and the chevron’s compass direction. GPS travel course remains separate and does not override the chevron. Prototype D can add a user-applied shadow-alignment offset to this same heading; camera fusion is deferred. This is heading indication, not route guidance or a measured travel direction. The total draw-call budget remains seven, including four for the chevron. See [Organic Maps ideas and implementation](docs/organic-maps-reference.md).

## GPS and compass (Prototype B)

Position uses `navigator.geolocation.watchPosition` with high accuracy; the Geolocation API exposes no polling rate, so adaptivity comes from filtering and from the idle render loop rather than from sensor duty cycling. Heading uses `deviceorientationabsolute` where available, otherwise `deviceorientation`; iOS supplies `webkitCompassHeading` and requires `DeviceOrientationEvent.requestPermission()` inside the enabling tap. Non-absolute `alpha` values are never treated as a compass. The facing direction is derived from the device rotation matrix by projecting the screen-up axis (device flat) or the rear-camera axis (device upright) onto the ground, whichever is longer, and correcting for `screen.orientation.angle`.

Hiding the tab stops the position watch and orientation listener; returning restarts them. Readings live only in memory; nothing is persisted or sent to any server of ours. Enabling GPS does send the 800 m bounding box to Overpass or the OSM API, and that is stated in the prompt. Without an applied shadow alignment, compass heading is uncorrected and can be disturbed indoors or near vehicles. Camera correction remains deferred. Physical iPhone and Android walking results are not yet recorded; Chromium-driven checks are not a substitute.


## Sun cross-check (Prototype D)

Tap **Check with a shadow**. With GPS and compass enabled, stand still by a clear shadow from an upright object on level ground. Hold the phone flat, screen up, with its top edge pointing from the object's base toward the shadow tip. Tap **I'm aligned — check compass**. No need to look at the Sun. When shadows are unclear, indoors or under cloud, skip the check.

NOAA's approximate solar equations predict the true-north shadow bearing from position and UTC time. This independent user alignment enables comparison with the raw compass. Differences of 15° or more get a visible disagreement indicator; the difference may include magnetic declination, interference and alignment error. It is a recorded comparison, not continuous detection of compass drift or a heading-accuracy estimate.

**Apply temporary correction** is a separate, optional action. It adds the observed offset to the compass before existing circular smoothing; both camera and chevron consume that result. **Clear check and correction** restores the uncorrected compass. The check and correction clear on stale sensors, 10 minutes, 100 m displacement, screen rotation, disabling GPS or hiding the app. No camera, network, storage or new permissions are added.

Observation gates: GPS age ≤30 s; compass age ≤2 s; phone tilt under 20° on both axes; at least three readings spanning 400 ms with under 5° spread; solar elevation 10–75°. iOS-reported compass accuracy worse than 20° rejects recording. These thresholds are prototype choices, not calibrated accuracy guarantees. Readings are held in a bounded window (at most 16); solar math runs on status/input refresh, never in the render loop. A stationary GPS session refreshes status once per second; hidden/manual sessions have no timer.

Run `npm run test:sun` against production preview on port 4173 for the controlled daylight/disagreement/apply/clear/stale/night/offline flow. Its clock, GPS fixes and orientation are simulated; physical-phone accuracy remains unvalidated. Math source: [NOAA equations](https://gml.noaa.gov/grad/solcalc/solareqns.PDF). Independent numeric check: [NREL SPA Table A5.1](https://docs.nlr.gov/docs/fy08osti/34302.pdf). Navigator implements the lightweight NOAA approximation, not NREL SPA's precision algorithm.


## Chunk streaming (Prototype E)

The worker partitions the downloaded OSM area into 128 m buckets. Each building and road segment has one owning bucket; selection uses expanded feature bounds so large features crossing bucket boundaries remain candidates. At most 24 chunks intersecting the 180 m view radius plus a 12 m movement margin are active. Up to four additional chunks are prepared ahead of travel, within a 308 m reach. GPS course or accepted manual displacement supplies travel direction, with viewing heading used before movement.

Resident building geometry is cached and reused. Chunks outside the active/prefetch set lose their cache references and become eligible for garbage collection. Changed active geometry is transferred into a single building batch; roads into one road batch. The renderer disposes the previous GPU meshes on replacement. An unchanged active set sends no new geometry; under aggregate budget pressure, priority-order changes may trigger a new batch. The 180 m shader cutoff remains fixed. Initial active chunks are prepared before the bounded prefetch work in the same worker request.

Caps: 28 resident chunks; each cached building chunk ≤9,000 vertices / 16 buildings; each road chunk ≤600 vertices. Active batches still obey ≤90,000 building vertices / 160 buildings and ≤18,000 road vertices (the current 24-chunk road cap is 14,400). Complex footprints simplify under the per-chunk vertex cap; excess buildings and whole chunks that cannot fit the aggregate budget are omitted. The Performance panel exposes omissions. Chunk selection runs after roughly 12 m of movement or a 45° travel-direction change while the movement loop is active, not every frame. Draw calls remain seven.

Performance reports active/prefetched/resident counts, cache bytes, evictions/promotions, disposed meshes, source numeric-payload estimate and chunk update time. The geometry estimate is cached building typed arrays plus twice active building/road arrays (CPU plus an assumed GPU copy). It excludes temporary build/transfer copies, JS object overhead, shaders, textures, ground/chevron, MapLibre and driver allocations; it is not total memory. Source data is still parsed and retained for one whole downloaded area. This pass streams geometry within that area, not network chunks. Prototype F adds a precomputed sector graph for the bundled area; PMTiles range reads remain later work. The existing GPS download/re-anchor and failure behavior are retained.

Run `npm run test:stream` against production preview on port 4173 for an actual worker/renderer walk with browser-supplied GPS fixes. This verifies promotion, eviction, bounded counts, GPU disposal counters, idle reuse, same-origin requests and desktop/mobile performance layout. See `docs/validation.md` for measured results and physical-device limits.


## Street-sector index (Prototype F)

`public/osm-sectors.json` is generated offline from the unchanged bundled OSM snapshot. It contains 14 street-derived polygon faces, 28 shared-boundary adjacency links, memberships for all 60 existing chunks, and a point-location table. Ground-level primary/secondary/tertiary/residential/unclassified/living-street/pedestrian centerlines define the faces; bridges, tunnels and nonzero layers are excluded. The source envelope closes the outer faces. These are derived rendering sectors, including fringe faces, not surveyed blocks or a walkable route graph.

The worker verifies the source SHA-256, origin, graph structure/connectivity and complete chunk memberships before use. It locates the player's face using the prebuilt locator, traverses adjacent faces intersecting the query bounds, and then applies the existing exact chunk-bound distance and resource filters. Precomputed memberships also avoid rebuilding the bundled spatial buckets. The graph is cached with the offline app shell. Live GPS/refresh downloads, stale/missing graph data, unavailable source hashing and point-location failures retain the existing radius lookup; no street polygonization or graph construction runs on the device.

The Performance panel shows lookup mode, visited sectors, candidate chunks, graph bytes and lookup time. `npm run bench:sectors` verifies equality at 441 positions and measures both query paths over 8,820 queries. On this small dataset the graph is slightly slower: about 0.0115 ms/query versus 0.0075 ms for the radius scan in one local run. The initial-area query visits all 14 faces and collects all 60 chunks, so no speedup is claimed. Both paths preserve identical active/prefetch sets and geometry in the tested walks.

Rebuild the artifact only when ingesting source changes:

```sh
python3 -m venv /tmp/navigator-ingest
/tmp/navigator-ingest/bin/pip install -r scripts/requirements-ingest.txt
NAVIGATOR_PYTHON=/tmp/navigator-ingest/bin/python npm run ingest:sectors
npm run check:sectors
npm run bench:sectors
```

The ingest step uses Shapely/GEOS to node street lines and polygonize their faces. It runs locally/build-time, never in the PWA. `npm run build` checks the committed artifact against the snapshot; CI does not need Python or Shapely. The derived graph remains covered by the existing OSM attribution/ODbL notice. The source snapshot and supplied image remain unchanged.

`npm run test:free-look` checks default compass-follow, independent drag/turn while GPS moves, unchanged raw compass readings, compass-directed chevron during free look, return to follow, mode reset when GPS stops, phone layout and stale-graph fallback. The view defaults to compass-follow on every GPS enable; manual and denied-compass behavior remain available. The performance panel distinguishes sensor bearing from the view heading.

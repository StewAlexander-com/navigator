# Prototype A validation

Recorded 2026-09-15T16:28:29.966Z in local headless Chromium, desktop 1440 × 900 and narrow viewport 390 × 844. This is not physical iPhone or Android validation.

- Six geometry/data tests passed: real snapshot at the center and four boundary positions; overloaded vertex budget; distance rejection; courtyard roof area; height/unit and movement rules; incomplete response rejection.
- Browser checks passed: WASD movement, pointer look, recenter, on-screen movement button, guide close/Escape, performance panel, no horizontal overflow, all startup requests same-origin, and reload with browser network disabled.
- No browser console/page errors or HTTP asset errors in the bundled-area run.
- Five-second desktop movement sample: 78.4 fps from smoothed animation-frame interval (12.75 ms). This is a short sample, not a sustained benchmark or GPU time.
- World draw calls: 3. Starting geometry: 36 buildings, 6903 building vertices, 10410 road vertices.
- Starting building typed arrays: 220896 bytes. This excludes road arrays, working copies, textures, MapLibre/Three overhead, and browser/GPU memory.
- Latest movement-triggered worker rebuild: 1.40 ms. Initial offline fetch + parse + build: 45.20 ms.
- First view ready in the local run: 181.5 ms. Localhost and cached builds do not predict first network load time.
- OSM snapshot response: 2797291 bytes.
- GPU memory: unavailable. Sensor accuracy: not applicable, sensors off.

## Outstanding acceptance

Physical iOS/Android testing, 15–20 minute sessions, memory-pressure behavior, compass/GPS behavior and real walking are not yet validated. Prototype A has no sensor integration.

Reproduce using the instructions in README.md. Screenshots and detailed JSON are emitted into test-results/.

## Live data check

A real browser refresh succeeded using the OSM API fallback after Overpass failed. Fetch + parse + geometry build took 1873.4 ms, with a 2,797,291-byte response and 36 visible buildings. This is one observed request, not a service latency guarantee.

## Hovering chevron update

Eight unit tests passed. Browser checks also verified sideways and backward bearings, look-only bearing retention, phone layout, and offline reload. The updated scene uses seven draw calls; the chevron body contains 132 vertices. A five-second local headless movement sample measured 68.9 fps (14.51 ms smoothed frame interval). This remains a short desktop sample, not a physical-phone benchmark.

The isolated GPU fixture showed the chevron with no blocker and zero cyan pixels after an opaque wall was placed between the camera and the chevron. Body, edges, glow and shadow all retain depth testing.

## Prototype B — GPS and compass

Recorded 2026-09-18 in local headless Chromium (software GL) with Playwright-supplied Geolocation fixes and synthetic `deviceorientationabsolute` events. This is not physical-device validation; no real receiver, magnetometer or walking session is represented.

- Fifteen unit tests passed: seven new tests cover facing-direction derivation (flat, upright, screen-rotated, iOS `webkitCompassHeading`, non-absolute rejected), circular heading easing, position easing and snap, fix gating (inaccurate, out-of-order, implausible, recovery after three rejections, stale reset), travel course rules, 800 m square geometry and re-anchor thresholds, and parsing with a moved origin.
- Browser checks passed in three contexts: the existing manual/offline context; a GPS context (opt-in dialog, first fix, eased movement, compass heading with drag locked to pitch, inaccurate fix ignored, walk with re-anchor, stop to manual); a denied-permission context that stayed usable manually.
- First accepted fix 39–41 ms after tapping Enable (browser-emulated receiver; a real GPS cold start is seconds to tens of seconds).
- A 33 m single-fix step eased to within 3 m of the target in 1.29–1.33 s (τ 0.55 s). Fix interval during the simulated walk: 658 ms. Twelve fixes used, one rejected as inaccurate (±120 m).
- Compass: a synthetic upright east-facing event (alpha 270, beta 90) settled the view heading to within 0.5° of 90° in under 5 s; a subsequent 200 px drag left heading unchanged.
- Re-anchor triggered at the first fix where the 180 m view radius left the bundled box (~133 m north of the origin), loading one 800 m square via one Overpass request (answered by the bundled real snapshot). After re-anchoring: 17 buildings, 4,125 building vertices, 10,410 road vertices, 7 draw calls, 1.2 ms worker rebuild, 9.5 MiB JS heap.
- GPS-mode smoothed frame interval 16.7–29.1 ms while easing (software GL, not GPU time). Manual desktop movement sample in the same run: 34.8 ms (28.8 fps), lower than earlier records because this VM has no GPU.
- No console/page errors in any context; non-same-origin requests were limited to the single mocked Overpass URL in the GPS context.

Outstanding: iPhone Safari (`requestPermission`, `webkitCompassHeading`), Android Chrome (`deviceorientationabsolute`), real fix cadence and accuracy, magnetic disturbance, 15–20 minute walks, memory pressure, and live Overpass density for an 800 m square in a dense city (the 8 MiB cap with the 500 m retry is enforced but untested against a real dense response).


## Prototype C — eye-height heading chevron

Recorded 2026-09-21 against local changes based on GitHub `main` at `98c71f8fd4980f1c895a9b2ad6527b2f22725ba2`. `git pull --ff-only` reported already up to date before edits.

- `npm test`: 15 passed, 0 failed. `npm run build`: passed (Vite retains its bundle-size warning).
- `npm run test:browser`: passed; no console/page or asset errors. Covers manual movement, compass-driven chevron while GPS course differs, denied GPS fallback, live-square re-anchoring with a mocked Overpass response, offline reload, and 390 × 844 layout without horizontal overflow. Desktop and mobile screenshots visually inspected.
- Chevron origin: 1.65 m above the flat ground, 4.5 m ahead. Its 132-vertex body, edges, glow and ground shadow still use four draw calls; world total remains seven. Unique chevron geometry typed arrays total 5,372 bytes, excluding GPU copies, shader programs and object overhead. Geometry is reused during pose updates.
- Five-second manual desktop sample: 71.18 fps, 14.05 ms smoothed animation-frame interval; 33 loaded buildings, 4,422 building vertices, 141,504 building-buffer bytes, and 10,410 road vertices. Latest worker rebuild: 1.50 ms. First view: 205.60 ms on localhost. These are short headless Chromium measurements, not phone benchmarks or GPU execution time; total GPU memory remains unavailable.
- `npm run test:chevron`: passed. Isolated fixture: 6,034 cyan pixels unobstructed, 0 behind a full wall, 3,017 behind a half-width wall, 6,034 when the wall is farther away than the chevron.
- Production MapLibre custom-layer fixture uses bundled OSM `relation/6333145` (576 building vertices), with the eye 2 m outside a real wall and the chevron on the other side. Unobstructed: 18,728 cyan pixels; building present: 0; building removed: 18,728. Both screenshots visually inspected. This proves shared-depth occlusion for that wall and pose, not every possible geometry or device.
- Heading source is the camera's resolved `player.heading` (smoothed absolute compass, otherwise manual). GPS course remains a separate observation. Sun/camera fusion is not implemented in this stage; real heading accuracy cannot be inferred from synthetic orientation events.

Reproduce: start production preview on port 4173 after building, run `npm run test:browser`; also start Vite dev on port 5173 and run `npm run test:chevron`. Raw JSON and screenshots are retained locally in ignored `test-results/`. Physical iOS/Android, compass accuracy and 15–20 minute walking/memory-pressure checks remain outstanding. No deployment was performed for this change.


## Prototype C publication and Prototype D validation

Recorded 2026-09-22. Prototype C was pushed as `d9ff367c540b80b75648a3208f15edbc3e46b116`; [GitHub Pages run 35675236132](https://github.com/StewAlexander-com/navigator/actions/runs/35675236132) succeeded. The public page served PROTOTYPE C and `index-DZXs4XvO.js`, whose SHA-256 matched the tested local build: `51220996f16bb6b79476956d8463a713e1efb0562c75e027520e214965b2f838`.

Part D is a subsequent local change, not part of that deployment.

- 20 unit tests passed; production build passed with the existing large-bundle warning. New tests cover the independent NREL reference, UTC/time-zone equivalence, leap day, southern hemisphere and polar conditions, explicit observation/apply requirements, daylight and freshness gates, flat-phone/accuracy gating, expiry, relocation, screen rotation and backwards clock changes.
- NOAA approximation at the NREL SPA example (2003-10-17 19:30:30 UTC, 39.742476° N, 105.1786° W): azimuth 194.477187°, elevation 40.097871°. Published SPA azimuth 194.34024°, elevation 39.88838°: absolute differences 0.136947° and 0.209491°. This single-case comparison is not a global accuracy bound, nor a compass-accuracy result. NOAA calculation omits atmospheric refraction.
- `npm run test:sun` passed in Chromium at 390 × 844 with a controlled clock, Playwright GPS and synthetic compass events. Host-provided GPS timestamps are restamped into the test clock. A deliberately introduced +40° discrepancy appeared in the UI without changing the heading; Apply moved both camera and chevron to the corrected heading; Clear restored raw heading. Stale compass input removed the offset; upright-phone and nighttime conditions disabled observation; offline reload worked and had no retained observation. All observed requests were same-origin; zero console/page errors. Disagreement, applied and night screenshots inspected.
- Existing browser regression checks passed: movement, GPS/compass, denied permissions, area re-anchoring, narrow layout and offline reload. Five-second manual sample: 68.29 fps / 14.64 ms, 7 draw calls, 4,422 building vertices and 141,504 building-buffer bytes; latest worker rebuild 1.50 ms. Headless desktop timing is not a physical-phone benchmark.
- Solar math microbenchmark: 100,000 calculations in 42.70 ms (0.000427 ms/call mean) after 1,000 warm-up calls in local Node. Browser timing was below the exposed timer resolution in the captured status sample. The heading render path performs only validity checks and applies an offset; solar prediction runs during lower-frequency status/input refresh. No additional GPU geometry or draw calls; temporary heading samples are capped at 16. Browser/GPU total memory and field heading accuracy remain unavailable.

Physical iPhone/Android shadow alignment, cloudy/outdoor usability, declination/interference behavior and 15–20 minute walking sessions remain unvalidated. The 15° alert threshold and alignment/expiry gates are explicit prototype choices, not empirically calibrated guarantees. No camera or persistent sensor capture is introduced.


## Prototype E — bounded geometry streaming

Recorded 2026-09-22. Part E builds on the uncommitted Part D changes; neither is included in the live Prototype C deployment above.

- `npm test`: 25 passed, 0 failed. Five new tests cover real-snapshot cache reuse and bounds; directional prefetch/promotion/eviction; empty-area cleanup; dense aggregate budgets; and a large footprint crossing its owning bucket. Production build passed with the existing bundle-size warning.
- `npm run test:stream`: passed in Chromium with browser-supplied GPS fixes along nine positions in the bundled area. This is an accelerated simulated path, not a walking/receiver accuracy test. Every position retained seven draw calls and respected all vertex/building/resident caps. No area download or other off-origin request occurred; no console/page errors. One second idle caused no extra mesh disposal.
- Maximum residency: 23 of 28 allowed chunks. End state: 17 active + 4 prefetched, 52 chunks prepared cumulatively, 31 evicted, 134 cache hits, 11 prefetch promotions. Renderer disposed 16 replaced building/road meshes. These counters prove the disposal code paths ran; they do not measure the driver's actual memory release timing.
- Maximum cached building typed arrays: 433,056 bytes. Maximum reported geometry CPU/GPU estimate: 1,383,072 bytes (1.32 MiB). Source coordinate numeric payload estimate: 79,384 bytes. The geometry estimate assumes one GPU copy and excludes temporary allocations and JS/browser/driver overhead; total GPU memory remains unavailable.
- Chunk selection/build samples on that path: 0.20–5.80 ms. Five-second manual regression sample: 66.67 fps / 15.00 ms, 7 draw calls, 10,578 building vertices / 63 submitted buildings and 4,266 road vertices. A cached movement update took 0.10 ms including worker response preparation. Whole active chunks may include buildings beyond the fixed 180 m fragment cutoff; submitted counts are not counts of visible buildings.
- Existing `test:browser` and `test:sun` passed against streaming builds: manual/GPS controls, denied permissions, area re-anchor, sun alignment/correction expiry, narrow layout and offline reload. Desktop and mobile scene/performance screenshots visually inspected. Raw logs and JSON remain in ignored `test-results/`.

Limits: this is prepared-geometry streaming inside one downloaded OSM area. Source parsing still materializes the whole area. Uniform buckets are built in the worker after download, not an ingest-time sector graph. Prefetch is CPU geometry preparation, not network fetching. The next sector and PMTiles stages remain separate. Physical iOS/Android memory-pressure and 15–20 minute walking tests remain outstanding.


## Prototype F — ingest-time sector graph and GPS free look

Recorded 2026-09-22. Local work includes Parts D, E and F; the public deployment is still Prototype C.

- Offline ingestion produced 14 street-derived polygon faces, 28 shared-boundary edges and memberships for all 60 chunks. Serialized artifact size: 48,160 bytes. Source SHA-256: `3d81375df1d7d543c43ec79015a5252b14e90470d27283c7af2c86bb1979b95d`. Shapely 2.1.2/GEOS performs line union and polygonization only during ingestion. The checked-in artifact includes a point locator; no street graph construction runs in the PWA. Build-time and runtime checks reject stale source hashes, invalid/disconnected graphs and incomplete memberships.
- `npm test`: 29 passed, 0 failed. New tests verify exact reconstructed chunk memberships, graph/radius candidate parity over random positions and sector boundaries at radii 0/50/192/308 m, identical geometry and prefetch results along a walk, malformed/stale artifacts, and independent chevron bearing during free look. Production build passed; the existing Vite size warning remains.
- `npm run bench:sectors`: exact parity at 441 positions. Over 8,820 measured lookups after warm-up: radius scan 66.205 ms total / 0.007506 ms mean; sector traversal 101.250 ms total / 0.011480 ms mean. This dataset shows about 0.004 ms extra per lookup, not a speedup. The origin query visits all 14 sectors and collects all 60 candidate chunks because the source has few closed street faces and broad fringe faces. A larger data/index design would need fresh evidence before claiming reduced lookup cost.
- Bundled startup and offline reload report `sector graph`; the existing live-area re-anchor reports `radius fallback`. `test:free-look` additionally passed with deliberately stale graph content and with WebCrypto disabled inside the worker: the scene remained usable through radius lookup. Source verification failure does not disable manual exploration.
- Free-look browser test: default GPS compass-follow still rejects drag yaw; enabling free look exposes drag and turn controls without disabling GPS. In one recorded sample the view remained about 125.95°, raw compass became 180°, the chevron eased to about 180°, and the GPS position moved over 14 m north. Turn controls changed the view independently; toggling back restored compass-follow; stopping GPS reset the mode to its default. Phone-width screenshot inspected, with no horizontal overflow.
- Existing navigation, GPS denial/re-anchor, chunk streaming, sun alignment/expiry and offline checks passed. The final ordinary five-second desktop movement sample measured 70.08 fps / 14.27 ms, seven draw calls, 10,578 building vertices and 4,266 road vertices. One cached worker update took 0.10 ms; the browser's individual lookup reading was below timer resolution. First local view: 477.8 ms. These are short desktop samples, not field performance guarantees.
- The graph adds one same-origin static file to the offline shell (13 assets). No new sensor permission or third-party service is used. The source OSM snapshot and supplied reference image are unchanged. JSON, screenshots and benchmark results are retained in ignored `test-results/`.

Limits: sectors are derived street-centerline faces closed by the source envelope, including fringe faces; they are neither surveyed blocks nor a pedestrian route graph. Fresh GPS areas need an externally ingested matching graph to use sector lookup; until then they retain the tested radius path. Total graph object/GPU memory and physical iPhone/Android behavior remain unmeasured. Free look is opt-in and does not change raw compass or GPS observations.

## v0.1.1 patch release

Prepared 2026-09-22 with Prototypes D–F and GPS free look. Earlier deployment statements above describe their recording dates. Release validation includes 29 unit tests, production build, browser navigation/offline checks, sun alignment, streaming and free-look regression checks. GitHub Pages deployment and public-origin verification are recorded with the GitHub release. Physical-device limitations above still apply.

## v0.1.2 — temporary compass look-around

Recorded 2026-09-22. Compass-follow now allows an unlimited horizontal drag, with 360° across 80% of the viewport, then eases to the latest resolved phone heading on release or pointer cancellation. Sensor updates and compass-directed chevron remain active; explicit free look retains its held-view behavior. Angle deltas now wrap correctly after repeated turns in either direction.

Validation: 30 unit tests passed; production build and browser navigation/offline suite passed. The free-look suite verified mouse circles both directions, a changing compass while the view is held, shortest-arc return, phone-sized browser touch circles and touch cancellation, plus existing free-look controls and graph fallbacks. Physical phone gesture feel and sensor behavior remain unverified.

## v0.1.3 — level chevron and nearby street pill

Recorded 2026-09-22. The chevron is parallel to the ground, with a 0.75 m hover height and thinner extrusion beneath the unchanged 1.65 m camera. A bounded translucent DOM pill projects above it; OSM names/types survive uniform and prepared-sector chunks. Nearby segment selection uses position and 3 m intersection hysteresis, with explicit unnamed/distant fallbacks. The label ignores pointer input and hides near the upper sightline and bottom controls. It is screen-overlay map context, not a depth-occluded route marker or confirmed road match.

32 unit tests passed, including horizontal transforms, road-name preservation, proximity and hysteresis. Browser checks verified South Spring Street in demo and simulated GPS modes, phone bounds, gestures starting on the pill, chevron GPU occlusion, full-circle spring-back, existing free look, navigation and offline labels. No browser errors; seven draw calls retained. Desktop and 390 × 844 screenshots inspected. Physical-device readability and sensor behavior remain unverified.

## v0.1.11 — driving-speed sensor rules

Recorded 2026-09-23 in local headless Chromium on macOS. Motivation: a real 60 mph drive near Mebane, NC showed the 15 m/s walking gate rejecting three of four 1 Hz fixes with a ±3–6 m receiver, then "recovering" with a 108 m jump above the 45 m snap threshold, while the camera trusted an in-car magnetometer.

- `npm test`: 53 passed, 0 failed (49 before). New tests: the 60 s / 1 Hz straight-road drive through the real `evaluateFix` at 27 m/s with 3, 5 and 6 m accuracy accepts 60 of 60 fixes with 27 m steps (the speedless path still accepts 15 of 60, documenting the baseline); walking and 11 m/s drives are unchanged; a 400 m jump stays implausible at any claimed speed; snap threshold scaling and the explicit `smoothPosition` snap argument; dead-reckoning gating below 3 m/s, direction and 2 s cap; course weight 0 at ≤3 m/s, 0.5 at 5 m/s, 1 at ≥7 m/s or with compass accuracy worse than 25° while moving; circular fusion.
- `npm run test:browser`: passed, including the new 60 mph context. 31 of 31 fixes used, 0 rejected, fix interval 1,004 ms; heading source GPS COURSE, view heading 0.000° and chevron bearing within 5° of the course while the synthetic compass swung 60–120°; 2,019 probe frames over 30 s with a maximum per-frame step of 1.64 m, no backwards frame, 835 m travelled (810 m of fixes plus dead-reckoning lead); three Overpass requests, all answered by the bundled real snapshot; no console/page errors.
- Existing manual, GPS-walk, denied-permission and offline checks passed unchanged; the walking context's Playwright fixes carry no speed and therefore exercise the pre-existing path (400 m square, one Overpass request, one inaccurate rejection).

Limits: Playwright 1.62.1 drops `coords.speed`/`coords.heading`, so the drive uses a page-side `watchPosition` shim; a real receiver's speed and course noise, magnetometer disturbance in a car, and fix cadence on phones are not represented. These rules are inert without a reported speed.

## v0.1.12 — road-cache churn at speed

Recorded 2026-09-23 in local headless Chromium on macOS. Motivation: at 27 m/s the road worker's 25 m maintenance ran about once per second, each call gunzipping, SHA-256-hashing and re-parsing the in-range package (a real 3.16 MB Mebane tile measured about 67 ms per call in Node) and rewriting the plan record; enabling GPS in a moving car also started the 69-tile bulk plan at once.

- `npm test`: 55 passed, 0 failed (53 before). New: a counting store shows one `get()` and one decode across five 30 m position updates in the same package, eviction of the decoded copy beyond the 300 m view range, one re-decode on return, removal clearing it, and a freshly downloaded package seeding the parsed map; the plan record is written once after installation and not again for position-only updates. The existing corrupt-payload test now corrupts the store and reloads a fresh engine, which is when verification happens.
- `npm run test:browser`: passed. The 60 mph context now begins with a 27 m/s fix: the driving hold engaged before any GPS-centred road plan, stayed on for the 30 s drive, and the Cache this area tap released it and created the plan. Drive figures matched v0.1.11 (31/31 fixes, max per-frame step 1.60 m, three Overpass requests).
- `npm run test:road-cache`: passed unchanged (installation, IndexedDB persistence, offline reload, second tab read-only, clear).

Limits: the position-update spacing and the hold live in `main.js` and are exercised only through the browser drive; the post-change `view()` cost on the real tile was not re-measured. The hold applies only when GPS is enabled above 8 m/s before a GPS plan exists; a plan already running continues as before.

## v0.1.13 — drive-friendly building squares

Recorded 2026-09-23 in local headless Chromium on macOS. Motivation: at 27 m/s the fixed 800 m square was exhausted every 220 m (a 166 KB Overpass request every eight seconds around Mebane, NC), nothing was cached or prefetched, any failure held for a flat 30 s (810 m of fog), and a 429 was followed at once by a request to the OSM API.

- `npm test`: 63 passed, 0 failed (55 before). `tests/world-worker.test.mjs` hosts the real worker module in Node with a stub `self` and scripted `fetch`: one Overpass download per square then cache reuse for any fix it covers with the 180 m margin, `fresh` bypass, prefetch followed by a cache-hit swap through the ordinary load, count (8) and byte (16 MiB) bounds with oldest-first eviction, 429 with `Retry-After: 45` → 45,000 ms, an HTTP-date `Retry-After`, a bare 429 → 60,000 ms, no OSM API request on any rate limit (including prefetch), and the 1,000 → 400 → 250 m step-down on 504 and on Overpass timeout remarks with the OSM API tried only for the smallest still-dense square. `tests/sensors.test.mjs` adds `liveSquare` (400 m on the fix below 3 m/s; 700 m at 13 m/s; 1,000 m cap; six-second lead along the course; the led square still covers the fix), `edgeRunway`/`shouldPrefetch` (never below 3 m/s; 100 m minimum; 216 m at 27 m/s) and `retryDelay` (30 s → 5 min, ±20 %, Retry-After floor).
- `npm run test:browser`: passed. In the 60 mph context the prefetch fired while the bundled area still covered the fix (122 m of runway < 216 m), the prefetched square was 2 km, the edge swap reported `cached`, and the 835 m drive cost exactly one Overpass request (three in v0.1.11–12) with zero failures. A new rate-limit context (429, `Retry-After: 45` exposed via CORS) recorded one failure with a 45 s hold, kept the bundled scene with buildings, showed "next attempt in 45 s", and sent no OSM API request and no further Overpass request while more fixes arrived. Walking, denied and offline checks unchanged.
- `npm run test:stream`, `npm run test:sun`, `npm run test:street-label`: passed. `npm run test:free-look` fails in its stale-graph fallback step both before and after this change on this machine (the worker reports `sector graph` although `osm-sectors.json` is routed to a stale stub); this is pre-existing and not caused by v0.1.11–13.

Limits: `Retry-After` is not a CORS-safelisted header; unless the service exposes it the app cannot read it and uses 60 s. The session cache holds parsed squares in worker memory and is lost on reload. Real Overpass density for a 2 km square in a city is untested against the 8 MiB cap beyond the step-down logic.

## v0.1.14 — houses in tag-poor OSM

Recorded 2026-09-23 in local headless Chromium on macOS. Motivation: in the real 800 m square around Elizabeth Lane, Mebane, NC (`tests/fixtures/mebane-800m.json`, a genuine Overpass response, © OpenStreetMap contributors), 151 of 153 buildings are bare `building=yes` with no height, level or address tags; every one received the 12 m generic default, which made the residential land-use home rule unreachable, so the square rendered as 85 four-storey "apartments" and 63 office-like "neutral" blocks.

- `npm test`: 68 passed, 0 failed (63 before). New tests: height defaults (12 m generic; 6.5 m for ≤ 250 m² in residential context; per-type house/outbuilding values; levels still win) and `hasHeightTag`; the land-use rule now reachable with a default height while explicit tags win and homes get 2.9 m floors; the road-context fallback's gates (street class, small-footprint prior, height evidence, footprint size, shop/office/amenity cues) and `nearestRoadClass` within 60 m; the real Mebane square yielding ≥ 120 homes and 0 offices while the bundled Los Angeles snapshot classifies exactly as before (47 / 0 / 26 / 28 / 3 / 13 / 5, prior false, no footprint inference, 6,903 start-view vertices); gable geometry (42 vertices, ridge at h + 0.29 × short side, four sloped and two vertical unit normals), door code 17 versus shopfront code 9, flat roofs for other shapes and styles, 160 gabled homes under budget, finite Mebane geometry.
- Mebane classification: 120 homes, 24 neutral (footprints over 250 m², or small footprints beside tertiary/secondary roads or more than 60 m from a residential/service road), 4 apartments (larger footprints in residential land use), 5 civic (tagged). 111 buildings at 6.5 m, 42 at 12 m.
- `npm run test:browser`: passed. New Mebane context: the fixture answers the Overpass request for the 36° N bbox, the loaded 800 m square reports 120 / 0 offices / 5 civic with the small-footprint prior, 79 buildings and 3,648 vertices in view, seven draw calls; a 12 s drive north at 27 m/s used 13 of 13 fixes with a maximum per-frame step of 1.20 m and no backwards frame, at most two Overpass requests. The 60 mph Los Angeles drive and rate-limit contexts were unchanged (max step 1.63 m, one Overpass request).
- `npm run test:building-styles`: passed; the home sample now renders as a 14 × 12 m gabled house with a front door, and the seven styles remain pairwise distinct. `npm run test:chevron`, `test:stream`, `test:sun`, `test:street-label`, `test:road-cache`: passed.
- Non-regression screenshot: the bundled Los Angeles start view (0, 0, heading 38°) captured before and after this change differs in 0 of 1,296,000 pixels (maximum channel delta 0), with the same 63 buildings and 10,578 vertices.

Limits: these are inferences from footprint size and street context, not surveyed use; a small shop with no tags on a service alley in a mostly-small-footprint square would be drawn as a home. The 250 m² footprint, 60 m reach, 70 % prior and 0.29 gable rise are documented defaults. Physical-phone GPU cost of the extra roof triangles (12 vertices per gabled home) is unmeasured.

## v0.1.15 — progress feedback

Recorded 2026-09-23 in local headless Chromium on macOS. Motivation: a first GPS fix can take tens of seconds and a live square is a multi-second download plus parse and build, with no visible progress beyond a static notice.

- `npm test`: 72 passed, 0 failed (68 before). New: `progressFraction` trusts `Content-Length` only while the bytes read stay within it (a compressed transfer overtakes it and the bar goes indeterminate); the tqdm-style status line (`42 % · 1.20 / 2.85 MiB · 0.41 MiB/s · 00:03 · parsing OSM data`, bytes-only variants, clock-only GPS variant); transfer-rate sampling at ≥ 400 ms with smoothing; the worker's `progress` messages in order downloading → parsing → building with monotonic bytes and the final download report equal to the body size, prefetch progress tagged `prefetch` without a build phase, and a cache hit reporting only the build phase.
- `npm run test:browser`: passed. The strip is hidden once the bundled area is ready; in the 60 mph context it is visible with task `gps`, a label mentioning GPS and a `mm:ss` clock between the enabling tap and the first fix, and gone once the fix is accepted; in the Mebane context the first routed Overpass answer is held for 1.5 s and the strip shows "Downloading the OpenStreetMap area around you" with the elapsed clock, then hides once the area is live. Screenshots `progress-gps.png` and `progress-download.png` inspected. Existing walking, rate-limit, denied and offline checks unchanged.
- `npm run test:stream`, `test:sun`, `test:street-label`, `test:road-cache`, `test:building-styles`, `test:chevron`: passed.

Limits: the determinate bar depends on the service sending an uncompressed body or an honest total; Overpass and GitHub Pages compress JSON, so in practice downloads show bytes and rate with a sweeping bar. GPS acquisition has no knowable total, so it shows elapsed time and the last rejection reason only. Parse and build phases on a phone are not timed here.

## v0.1.16 — indoor hint

Recorded 2026-09-23 in local headless Chromium on macOS. A confidence-gated "You may be / are probably inside …" pill from the accepted GPS fix and the loaded OSM footprints.

- `npm test`: 76 passed, 0 failed (72 before). New: edge depth (rectangle, near edge, courtyard hole) and footprint lookup with bounds rejection, holes and invalid input; verdict gating (depth ≥ 1 × accuracy → likely, ≥ 0.3 × → maybe, less → none; speed above 3 m/s → none; invalid accuracy → none) and wording with OSM names or inferred style; the real Mebane house `way/1179878853` (depth 4–7 m at its centre): likely at ±4 m, maybe at ±12 m, none at ±40 m, a road point outside, `Lambs Chapel` named. Worker `locate` answers only for the current world frame and null elsewhere.
- `npm run test:browser`: passed. The Mebane context now starts at that house: after the live square loads, the pill shows "You are probably inside a home" with "HIGH CONFIDENCE · ±4 m"; two ±40 m fixes at the same spot hide it (hysteresis of two fixes) while the located footprint is still reported; the 12 s drive at 27 m/s ends with no verdict. Screenshot `indoor-hint.png` inspected (the camera is visibly inside the house's walls). Other contexts unchanged.
- `npm run test:stream`, `test:sun`, `test:street-label`, `test:road-cache`, `test:building-styles`, `test:chevron`: passed.

Cost and limits: one small worker message per accepted fix (≤ 1 Hz) with a bounds scan and a single point-in-polygon; one DOM update; no geometry or draw calls. Multipath near tall walls can place an outdoor fix inside a footprint; courtyards and footprints missing from OSM produce no hint. Not tested on a phone indoors.

## v0.1.17 — overlay layout

Recorded 2026-09-23 in local headless Chromium on macOS. Pills (notice with progress strip, indoor hint, street pill, sun and view-mode buttons, road-status line) must never overlap each other or anchored UI at any viewport; move first, shrink only when no slot fits.

- `npm test`: 80 passed, 0 failed (76 before). New `tests/layout.test.mjs`: a free pill keeps its position and ignores obstacles outside its column; a blocked pill moves to the nearest free slot below or above (exact ties move down), stacks past several obstacles and is clamped inside the viewport; with no slot tall enough it shrinks into the largest gap, centred, with a 60 % floor even when the gap is smaller; a gap just tall enough is used at full size; pair counting.
- `npm run test:browser`: passed. Manual and GPS phone layouts report zero overlaps. In the Mebane context with notice, indoor pill and street pill visible: 1440 × 900 — nothing moved or shrunk; 390 × 844 — the indoor pill (designed at the notice's row) moved below the notice at full size, street pill below it; 390 × 600 — the indoor pill shrank to about 66 % because no slot in its column could fit it; zero overlaps and zero fixed-UI overlaps at each size. Probing 1024 × 480 separately also gave zero overlaps (the street pill shrank to 67 %).
- `npm run test:stream`, `test:sun`, `test:street-label`, `test:road-cache`, `test:building-styles`, `test:chevron`: passed.

Limits: movement is vertical within a pill's own column; the resolver does not reflow anchored UI (brand, compass, minimap, bottom bar), whose CSS positions are already collision-free at the tested sizes. A shrunk pill at 60 % remains legible on the tested displays; physical-phone legibility is not verified.

## v0.1.18 — Prototype G level of detail and driving position track

Recorded 2026-09-24 on Linux (sandbox, Node 20, headless Chromium with software GL).

- `npm test`: 82 passed, 0 failed (80 before). New: LOD split on the real LA snapshot within the silhouette caps; hysteresis (full at 131 m and 142 m, released at 146 m, re-entry only below the near boundary); a dense world downgrades over-budget near chunks to silhouettes; ring simplification and a box silhouette (30 vertices, roof at full height); track walking passthrough, stale-fix rejection, latency-corrected prediction, reset on jump, frame shift, and sim bounds at 20/35/60 mph.
- `npm run sim:drive`: see README "Driving position track" for the table.
- Bundled LA in the preview build: 8 world draw calls, 12 full / 20 silhouette chunks, 57 silhouette buildings / 3,150 vertices, no page errors; screenshot inspected.
- Not re-run to completion here: the timing-dependent browser checks (`test:browser`, `test:stream`). Software GL in this sandbox renders about 4 frames per second for both v0.1.17 and v0.1.18, so the walk-distance and timeout assertions fail for both builds. Their draw-call expectations were updated from 7 to 8. Re-run on macOS before treating Prototype G as validated; the real-device fps / memory check over a drive is also outstanding.

## v0.1.19 — OSM surfaces, trees and lane markings

Recorded 2026-09-24 on Linux (sandbox, Node 20, headless Chromium with software GL).

- `npm test`: 84 passed, 0 failed (82 before). New `tests/extras.test.mjs`: surface classification and ordering (underground parking excluded), mapped trees first with tagged height, tree-row spacing, illustrative park trees bounded per area, deterministic and never inside a footprint, surfaces below the road plane, nearest-tree cap; bundled LA extras within budget and parsed in under 500 ms; South Spring Street parsed as one-way and at least one two-way 14 m road.
- Preview build: 10 world draw calls, 26 surfaces / 624 vertices, 33 trees drawn from 607 (258 mapped), no page errors. Screenshots inspected: dashed white divider on one-way South Spring Street, double yellow on the two-way cross street, OSM trees at the end of the block.
- Browser checks' draw-call expectations updated from 8 to 10. The timing-dependent browser checks were not re-run to completion here, for the same software-GL reason as v0.1.18.

## v0.1.20 — road flicker fix and tree polish

Recorded 2026-09-24 on Linux (sandbox, headless Chromium with software GL).

- `npm test`: 84 passed, 0 failed. Preview build: 11 world draw calls, 33 trees drawn, no page or shader errors. Screenshots inspected: OSM-tagged palms on South Spring Street render as palms; road edges and markings have no z-fighting in stills. The flicker was seen while moving on a real device, which I could not reproduce here, so it needs confirming there.

## v0.1.21 — softer tree crowns

- `npm test`: 84 passed. `tests/trees.html` close-ups inspected in headless Chromium (software GL): broadleaf crowns round and lumpy with no visible facet lines; the underside is shaded green, not near-black. Conifer and palm crowns show a faint fine cross-hatch in this software renderer. It persisted through every variant tried (with and without noise, one- and two-sided faces), so it is probably specific to the software renderer. Confirm on a real GPU.

## v0.1.22 — tree variety and palm shape

- `npm test`: 84 passed. `tests/trees.html` inspected: three palms at 10, 12 and 15 m with frond crowns, tapered, leaning trunks and distinct crowns; broadleaf and conifer unchanged in cost.

## v0.1.23 — street label follows the street in view

- `npm test`: 85 passed (one new: along, down −20°, up +4°, turned 60°, straight across, facing away 20 m off the street, behind-only and empty input).
- Preview build, headless Chromium, 1100 × 700: the pill stayed visible and centred for start, pitch −18°, pitch +4°, heading 92° (54° off the street axis) and heading 2°. Before the fix the pitch −18° case was hidden by the fixed band.

## v0.1.24 — parking lots

- `npm test`: 85 passed. The extras test now checks that curb strips come last, in whole quads, and that parking uv spans the lot. `tests/scene.html?x=-11.5&y=108.8&h=161` (the user's reported view) inspected level and at −15° pitch: stall rows aligned to the lot, curb edge against the sidewalk, lines fading with distance, no errors.

## v0.1.25 — explore any place

- `npm test`: 87 passed (two new: coordinate parsing, including hemisphere letters, swapped order and bounds; Nominatim first-hit, no-hit and error handling).
- Preview build, headless Chromium, live network: `36.0957, -79.2670` loaded an 800 m square (Overpass unavailable, OSM API fallback) with 60 buildings and the player at the centre, URL `?at=36.09570,-79.26700`. "Mebane, North Carolina" resolved through Nominatim to 36.09597, −79.26696 with 63 buildings. Back to the Los Angeles demo restored the bundled area and cleared the URL. No page errors.

## v0.1.26 — walk to the edge, then load the next area

- `npm test`: 88 passed (new: clamp at the area edge less the 10 m margin, and edge distance).
- Dev server, headless Chromium, live network: starting 3 m inside the east edge of the bundled LA box and walking east, the end-of-area dialog opened at x = 405.6 m. Download the next area loaded an 800 m square centred on that point. The player kept its position (now 0, 0 in the new frame), the area was named "Near downtown Los Angeles", and there were no page errors. `window.navigatorTeleport` is a development-only hook and is absent from production builds.

## v0.1.27 — building name pills

- `npm test`: 92 passed (new `tests/labels.test.mjs`: anchors only for named buildings, outside the chosen wall; in-front, facing, distance and occlusion rules; info rows with joined address, skipped generic type and safe links; the exact OSM API URL and rejection of malformed ids).
- Dev server, headless Chromium, live network, bundled LA at the start pose: 13 named anchors and 22 blockers. Before the 5–7 m rule, "Crawford Addition" showed its pill with ⓘ at about 100 m; tapping ⓘ loaded 145 South Spring Street, Los Angeles; commercial; 10 floors; 59.9 m; built 1948. Moving 3 m closed the pop-up and cleared its rows. No page errors.
- After the 5–7 m rule: no pills at the LA start pose (on South Spring Street, more than 7 m from any named footprint). Beside Pan American Lofts: its pill shows at 3 m and at about 7 m, and is gone at about 14 m. Unit tests cover 4 m (shown), 6.5 m (shown only because nothing is within 5 m), 10 m (hidden), behind the camera, far along the street, and occlusion.

## v0.1.28 — food places and landmarks named from afar

- `npm test`: 93 passed (new: place categories; a café point attached to its footprint, with the pill on the wall at the point and details from its node; named at 40 m while an ordinary building is not; hidden when a kiosk blocks 2 m of the name area; hidden beyond 120 m).
- Dev server, bundled LA at the start pose (heading 38°): "(abeautifullife) Jamaican" (food) and "Crawford Addition" (landmark) show. "The Blue Cube" was selected but hidden, because it would have had to move around the HUD. Facing 218°, nothing shows. No page errors.

## v0.1.29 — name pills: noise budget

- `npm test`: 94 passed (new: strict landmark rule, food limited to 60 m, landmarks to 120 m, at most two specials and one plain name, cuisine and hours formatting).
- Dev server, bundled LA, ten poses: at most one name on screen at a time. The debounce was confirmed (nothing at 150 ms after arriving; "Pan American Lofts" after it settles). Its card showed five rows (address 253 South Broadway, apartments, built 1897, 5 floors, 26.3 m) with no "More" button. A bug found here and fixed: a pending fade-in never completed once the render loop slept, now handled by a 150 ms timer.

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

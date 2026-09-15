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

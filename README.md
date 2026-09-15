# Navigator

A GitHub Pages PWA for bounded, first-person exploration of real OpenStreetMap streets. **Prototype A** uses manual controls. It does not use GPS, request a camera, or provide route guidance.

- Live app: https://stewalexander-com.github.io/navigator/
- Architecture: https://stewalexander-com.github.io/navigator/architecture.html
- Local: `npm ci`, `npm run dev`, open the printed URL at `/navigator/`.
- Production: `npm test && npm run build`, then `npm run preview`.

## Controls

WASD translates, arrow keys turn/look, and dragging changes the view. Touch buttons support movement and turning. Recenter restores the starting pose. Exploration stays within 120 m of the fixed downtown Los Angeles origin; scene visibility ends at 180 m.

The app starts with a bundled, real OSM area. The field guide offers an explicit live Overpass refresh, falling back to the OSM API if Overpass is unavailable. Overpass can be unavailable or rate-limited; a failed refresh retains the current scene. Refreshed data lasts for the current session. The bundled area and shell work offline after the service worker finishes installation.

## Architecture and scope

Read `public/architecture.html` for the complete staged architecture, explicit adaptations, privacy model and platform limitations. MapLibre controls the true 1.65 m eye-height camera. A single Three.js custom layer batches extruded OSM footprints, ground and roads into three world draw calls. GPU shaders enforce distance fog and cutoff. OSM conversion and building triangulation run in a worker. Native `fill-extrusion` is deliberately replaced by this inspectable bounded renderer.

Buildings use real OSM footprints, including polygon holes. Missing height tags use simple defaults. Windows and road widths are illustrative. No surveyed façade, terrain, collision detection, real GPS, fused heading, route engine, or 3D chevron is claimed in this stage.

## Budgets

90,000 building vertices; 160 buildings; 18,000 road vertices; 180 m rendered radius; 1.5 maximum device pixel ratio; 8 MiB response cap. Complex buildings downgrade to bounding boxes under pressure before remaining distant features are omitted. Geometry replacement disposes the old buffers. A future chunk pass will add pooling and ingestion-based sectors.

Performance UI shows measurements, not hardcoded success values. Geometry byte counts exclude road buffers, browser and GPU overhead. The frame interval is requestAnimationFrame timing while moving, not GPU execution time. Total GPU memory is unavailable. Physical-device 15–20 minute sessions remain untested until recorded.

## Deployment

The Pages workflow installs the lockfile, runs tests, builds, uploads `dist`, and deploys. GitHub repository Settings → Pages must use GitHub Actions. Vite base, PWA scope and service worker scope are `/navigator/`. No API keys or environment secrets are required. App dependencies are bundled locally, not loaded from a CDN at runtime.

## Data and assets

OpenStreetMap data is © OpenStreetMap contributors, available under the ODbL: https://www.openstreetmap.org/copyright. The fixed snapshot's provenance is in `public/osm-provenance.json`; the raw OSM download is preserved in `public/osm-snapshot.json`. Do not replace this with fabricated data under an OSM label.

The supplied reference image is preserved unchanged and displayed rotated 90° clockwise on the architecture page using CSS. It is a reference, not the 3D scene background. It is excluded from the offline shell cache.

## Reproduce browser validation

Run `npx playwright install chromium`, start `npm run preview -- --port 4173` after building, then run `npm run test:browser`. Screenshots and raw measurements go to ignored `test-results/`. These checks cover movement, recenter, mouse look, dialogs, narrow-screen layout, same-origin startup requests, and a real offline reload.

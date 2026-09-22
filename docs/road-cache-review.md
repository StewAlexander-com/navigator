# Local OSM road downloads: five-pass implementation review

Implemented in v0.1.6. GitHub Pages serves the application and its bundled demo; newly downloaded road packages live only in this browser's IndexedDB. No hosted backend or Organic Maps binary files are used.

## Pass 1 — Diagnose the reported street name

At the reported demo coordinate (-118.24544, 34.05154), West 2nd Street was already in the bundled OSM data. Its centerline is 4.206 m away, inside the rendered 14 m road width; an unnamed footway centerline is 2.240 m away. Centerline-only matching incorrectly preferred that footway.

Applied: compare road-surface distance and prioritize a named street containing the position over the adjacent unnamed footway. Intersection hysteresis cannot preserve that inferior match. The pill says STREET/PATH instead of NEARBY and reports missing names as unavailable. A regression test uses the actual source and coordinate. Road widths and GPS remain approximate; this is not confirmed map matching or route guidance.

## Pass 2 — Adapt Organic Maps' download lifecycle to OSM

Organic Maps uses prebuilt regional .mwm files, persisted download queues, HTTP range resumption, remote size/hash metadata, verified installation, and obsolete-version cleanup. Navigator borrows durable progress, near-area priority, validation before installation, atomic replacement and cleanup.

Navigator obtains OSM highway ways, names and geometry through public Overpass queries. Geographic areas form independently usable local packages. Completed areas survive reload; interrupted areas restart. Dense responses subdivide recursively. This is area-level resumption, not byte-range resumption of immutable remote files. OSM response validation rejects incomplete/error responses; SHA-256 detects local payload corruption. It is not a trusted publisher-provided checksum.

The source remains a public query service. Serial requests are spaced at least five seconds apart, with timeouts and backoff for overload. No unrestricted full-radius query is sent. Rate limits, outages and dense areas can leave coverage incomplete. See [Overpass public-instance guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html).

## Pass 3 — Bound device storage and the rendering working set

Packages are gzip-compressed where supported and installed with their metadata in a single IndexedDB transaction. The manifest persists completed coverage and retry state. A Web Lock gives one tab download/eviction ownership; other tabs can read installed data. Browsers without coordination/storage support retain the existing scene.

Limits: 128 MiB of stored package payloads; 4 MiB per network response; 16 MiB per decoded package; 60,000 parsed segments per package; at most 2,400 nearby segments delivered to the renderer. Metadata, transient parsing copies, browser overhead and GPU allocations are additional: these numbers are not a total heap or physical-disk guarantee. One package at a time is decoded in the worker. Quota failure pauses downloads and preserves installed in-range packages. Seven-day-old data is eligible for refresh; a usable old parent remains until all replacement subareas finish.

Offline reload reads the installed cache even when downloading is paused. Clear removes the app-managed road stores. Network requests use no-store; browser garbage collection and physical disk reclamation remain browser-controlled. Raw sensor samples stay in memory; derived coverage centers are stored locally. The requested OSM areas are visible to Overpass. The app-shell/bundled demo cache is separate and is not subject to road-region eviction.

## Pass 4 — Recenter and evict through a journey

The target radius is 25 miles (40,233.6 m); the replan threshold is 12.5 miles (20,116.8 m) from its last center. Demo uses the virtual location; GPS uses accepted fixes. A saved GPS region is preserved on startup until GPS is enabled or the user explicitly chooses a new area. The nearest pending areas download first.

At halfway movement, reuse overlapping completed areas, preserve previous adaptive subdivisions and cancel obsolete requests. Generation checks prevent superseded downloads from restoring old data. Downloaded geometry is clipped to the package and current radius. Location updates are coalesced at approximately 25 m; maintenance checks evict out-of-range packages from IndexedDB and the active road set. An in-flight request can delay the next maintenance checkpoint by its bounded timeout.

Boundary eviction is conservative: if a package's retained bounds extend outside the moving radius, the whole package is removed. This can discard some still-in-range edge roads and marks coverage partial until a replan/retry. It avoids retaining outside-radius payloads and repeated boundary download churn. “25-mile target” is not a claim that every point inside the moving circle is always downloaded. Newly covered areas still require successful network requests. High-latitude support is limited to 84 degrees north/south.

## Pass 5 — Verify behavior and state remaining limits

44 unit tests pass, including the reported West 2nd Street match, geographic clipping/dateline handling, exact halfway threshold, adaptive overlap reuse, corrupt payloads, cancellation, size bounds, splitting, retry backoff, budget preservation and a simulated journey of roughly 62 miles with eviction assertions.

The production-browser cache test uses real IndexedDB and controlled OSM responses. It verifies startup installation, compression, pause, offline reload, a second tab, clear, seven draw calls and phone-width layout. Existing browser, street-label and GPS free-look checks cover the ordinary interactions separately. Raw results and screenshots are written to ignored test-results/.

A real public OSM query for a small Los Angeles area returned 1,065,117 bytes and 6,228 parsed segments with road names in one 1.592-second probe. This validates one source response, not full-radius completion or a transfer-time promise. Full 25-mile download size/time, physical-phone memory pressure and offline walking remain unmeasured. Public Overpass cannot guarantee complete coverage at startup. The app exposes actual completed-area counts, stored bytes and partial/error states instead of claiming completion prematurely.

## Reviewed primary source

Organic Maps revision cad96543961dd544cc9d5a559c97a47747e95ea8:

- [Country file metadata](https://github.com/organicmaps/organicmaps/blob/cad96543961dd544cc9d5a559c97a47747e95ea8/libs/platform/country_file.hpp): region identity, remote size and integrity hash.
- [Storage lifecycle](https://github.com/organicmaps/organicmaps/blob/cad96543961dd544cc9d5a559c97a47747e95ea8/libs/storage/storage.cpp): SaveDownloadQueue/RestoreDownloadQueue, OnDownloadFinished, RegisterDownloadedFiles, version cleanup and deletion.
- [HTTP download implementation](https://github.com/organicmaps/organicmaps/blob/cad96543961dd544cc9d5a559c97a47747e95ea8/libs/platform/http_request.cpp): byte-range chunks, resumable files, range validation and completed-file promotion.
- [Map downloader](https://github.com/organicmaps/organicmaps/blob/cad96543961dd544cc9d5a559c97a47747e95ea8/libs/storage/map_files_downloader.cpp): server configuration and download queue.

This review borrows architectural ideas; no Organic Maps code or binary map files were copied.

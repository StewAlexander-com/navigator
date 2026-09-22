# Organic Maps ideas used for the chevron

Historical design note: Prototype C supersedes the travel-bearing presentation below. The current chevron consumes the camera’s resolved heading at 1.65 m eye height, tilted 30° for readability. GPS course and manual displacement remain separate observations; sun/camera correction is still deferred. The automated occlusion check now also exercises real bundled OSM geometry through the production MapLibre custom layer.

Reviewed [Organic Maps](https://github.com/organicmaps/organicmaps) at revision `780ed4f059ed3ac01f38df788c6e781e05500487`.

- [`libs/drape_frontend/arrow3d.cpp`](https://github.com/organicmaps/organicmaps/blob/780ed4f059ed3ac01f38df788c6e781e05500487/libs/drape_frontend/arrow3d.cpp) separates arrow mesh, outline, shadow, position and azimuth. Navigator similarly creates reusable body, edge, glow and shadow geometry once, then updates its transform. No Organic Maps source code, meshes or map files were copied.
- [`libs/drape_frontend/my_position_controller.cpp`](https://github.com/organicmaps/organicmaps/blob/780ed4f059ed3ac01f38df788c6e781e05500487/libs/drape_frontend/my_position_controller.cpp) distinguishes movement-bearing and compass inputs and animates arrow position and angle. The applicable idea here is to keep travel bearing separate from view heading. Navigator currently derives travel bearing from actual manual displacement; GPS and compass fusion are still absent.

## Navigator behavior

The chevron hovers 0.9 m above the flat road, 4.5 m ahead of the current view. Its tip points along the most recent actual displacement, including strafing and reverse movement. Looking around does not change that bearing. Before the first movement, or after Recenter, it previews the view heading. The guide stays in front of the view for readability; its placement does not claim a route waypoint or destination.

All four components test against the scene depth buffer. A nearer building hides the body, edges, glow and shadow. It is not a screen overlay. The fixed hovering height avoids running an idle bobbing animation. There are four additional draw calls, for a total scene budget of seven. The main beveled mesh contains 132 vertices.

## Validation

Unit tests cover north/east/south/west displacement, no-motion bearing retention, view-relative placement and depth-test configuration. The browser checks include actual forward/sideways/reverse controls and look-only bearing retention. An isolated GPU fixture (`tests/chevron.html`, served with Vite dev) measures cyan pixels before and after adding a nearer opaque wall; the blocked result must be zero. The fixture is not included in the deployed site.

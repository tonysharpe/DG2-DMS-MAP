# Modular routing app JavaScript

The original JavaScript has been split into ES modules:

- `main.js` — startup and event wiring
- `map.js` — MapLibre map creation
- `location.js` — live user location
- `mapLayers.js` — GeoJSON boundaries, communities, and road layers
- `routing.js` — routing API and destination selection
- `routeDisplay.js` — route drawing, bounds, endpoint marker, and clearing
- `ui.js` — status messages and route summary

## Integrate into your existing project

1. Copy these JavaScript files into the same directory as your current JavaScript entry file (or update the import paths if you place them elsewhere).
2. Keep your existing `data/` directory and its GeoJSON files in the same relative location.
3. In your HTML, replace the old script reference with a module script:

   ```html
   <script type="module" src="./main.js"></script>
   ```

4. Ensure MapLibre GL JS and Turf are loaded before `main.js`, and that they expose `maplibregl` and `turf` globally. For example, keep their existing CDN script tags before the module script.
5. Serve the page through a local web server or your normal hosting environment. ES modules generally should not be opened directly using a `file://` URL.

## Notes

- The HTML element IDs and GeoJSON paths used by the original script are preserved.
- `endMarker` was declared but never used in the original script; the modular version keeps marker state private to the route-display module.
- This is a structural refactor based on the supplied JavaScript. It has not been integration-tested against the live API, the HTML, or the GeoJSON files because those project files were not supplied.


## Deploy as a single Render service

The Render Blueprint in `render.yaml` defines one Python web service named `DG2-DMS-MAP`. FastAPI serves both the application frontend (`/`, `/style.css`, `/js/*`, and `/data/*`) and the routing API (`/health`, `/destinations`, `/route`, and `/network-info`). The browser uses same-origin API URLs, so the application no longer depends on cross-origin CORS between separate Render hosts.

After merging, apply the updated Blueprint in Render and verify that the single service deploys successfully. If the old frontend and routing services were created separately in Render, retire those old services manually after confirming the new `DG2-DMS-MAP` service is working; changing `render.yaml` does not guarantee deletion of already-existing services.

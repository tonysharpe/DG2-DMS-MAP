# DG2-DMS-Map

Static MapLibre GL JS frontend for the temporary-road routing API.

## Deploy as a Render Static Site
1. Upload `index.html`, `style.css`, `app.js`, and `README.md` to the `DG2-DMS-Map` GitHub repository (repository root).
2. In Render choose **New + → Static Site** and connect this repository.
3. Set **Publish Directory** to `.` (a single dot). There is no build step.
4. Create the static site.

The frontend calls `https://dg2-dms-mapping.onrender.com/health`, `/destinations`, and `POST /route`.

Map tiles are loaded from OpenStreetMap and require internet access. The endpoint markers represent the first and last coordinates of the returned road geometries, not necessarily the exact gate and destination locations.

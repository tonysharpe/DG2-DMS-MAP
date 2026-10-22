SITE NAVIGATION PROTOTYPE
1. Extract this ZIP to a folder. Keep index.html, app.js, style.css and all JSON files together.
2. Open a terminal in the extracted folder.
3. Run: python -m http.server 8000 --bind 127.0.0.1
   On Windows you can also try: py -m http.server 8000 --bind 127.0.0.1
4. Open http://localhost:8000 in your browser. Do not double-click index.html.
5. Test every gate-to-destination route and review snapped destination positions.
6. After project approval, deploy these assets to an approved static host. Public hosting exposes the network files.

No QGIS, Docker or database is needed by the browser application.
Internet access is required for Leaflet and proj4 from CDNs. No external basemap tiles are used.
The blank background is deliberate: only site roads and locations are displayed.
Routing uses explicit node IDs and supplied lengths/speeds. Off-road offsets and delays are excluded.
Locations are attached to their nearest road; a 25 m limit is enforced. Review access suitability.
MultiLineString roads must have exactly one part. Road endpoints must match junctions within 1 m.
This is a prototype, not GPS/turn-by-turn navigation. Closures and vehicle restrictions are not implemented.
For offline use or stricter security policies, vendor the libraries locally and update index.html.

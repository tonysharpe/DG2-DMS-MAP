SITE NAVIGATION PROTOTYPE

Project layout:
- index.html and style.css remain in the repository root.
- Browser JavaScript is stored in script/.
- Active GeoJSON and related data files are stored in data/.
- Unused, legacy and diagnostic GeoJSON files are retained in data/archive/.

To run locally, open a terminal in the repository root and run:
  python -m http.server 8000 --bind 127.0.0.1
Then open http://localhost:8000 in your browser. Do not double-click index.html.

Internet access is required for Leaflet and proj4 from CDNs. No external basemap tiles are used.
The blank background is deliberate: only site roads and locations are displayed.
Routing uses explicit node IDs and supplied lengths/speeds. Off-road offsets and delays are excluded.
Locations are attached to their nearest road; a 25 m limit is enforced. Review access suitability.
MultiLineString roads must have exactly one part. Road endpoints must match junctions within 1 m.
This is a prototype, not GPS/turn-by-turn navigation. Closures and vehicle restrictions are not implemented.
For offline use or stricter security policies, vendor the libraries locally and update index.html.

# Temporary Road Routing Engine

File-based routing engine for the temporary road network.

## Data directory

Routing data is stored in the repository-level `data/` directory, shared with the map application. Required routing files:

- `data/roads.geojson`
- `data/junctions.geojson`
- `data/gates.geojson`
- `data/destinations.geojson`
- `data/destination_areas.geojson`
- `data/destinations_gates_lookup.csv`

The same directory also contains the map layers used by the frontend. Keep these routing files alongside the map data; do not create a separate `routing/data/` directory.

## Routing

Road links are split into graph edges at shape points that are within 0.1 metres of another link's shape point, plus gate/destination snap positions. Only vertex-to-vertex proximity creates road-to-road connections: segment-interior crossings and a vertex near the middle of another segment do not connect roads. The source GeoJSON geometry is not rewritten; the graph uses virtual cuts and route output contains only the traversed sections. Gates and destinations snap to the closest point (projection/intercept) on the nearest road geometry, rather than snapping only to a road vertex.

Supported link directions:

- `both`: start to end and end to start
- `forward` (and other non-reverse, non-bidirectional values): start to end
- `reverse`: end to start

Routing cost is proportional to the traversed section's length and uses travel time:

`section_length_m / 1000 / speed_kmh * 3600`

The engine uses Dijkstra's algorithm. Gate and destination positions are snapped to the closest point on the nearest link. Road connectivity uses a 0.1 m shape-point tolerance in the projected metric CRS. Shapely performs planar x/y geometry analysis and ignores Z values; grade-separated links whose shape points fall within tolerance need explicit network metadata or preprocessing if they must not connect.

## Run from the repository root

```bash
python -m venv .venv
# Windows:
.venv\\Scripts\\activate
# Linux/macOS:
source .venv/bin/activate

pip install -r routing/requirements.txt
uvicorn routing.app:app --reload
```

## API

- `GET /health`
- `GET /destinations`
- `POST /route`

Example request:

```json
{
  "destination_id": "D001"
}
```


## Cached routing network and performance

The routing engine builds the directed road graph and its 0.1 m shape-point junctions once when the service starts. Route requests reuse this cached topology and split only the directed edges containing the selected gate and destination's closest-point snaps. Dijkstra then searches that request-specific graph; the shared cached graph is not mutated by individual requests.

The engine fingerprints `data/roads.geojson` with SHA-256. At the start of each route request it checks that fingerprint; if the file has changed in place, it reloads the road data and rebuilds the cached graph. A normal Render deployment also rebuilds the cache when the new service process starts after a roads-file commit.

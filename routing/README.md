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

Road links are split into graph edges at shared endpoints, geometric intersections, and gate/destination snap positions. This allows the router to enter or leave a link at an intermediate shape point rather than requiring every connection to be a feature endpoint. The source GeoJSON geometry is not rewritten; the graph uses virtual cuts and route output contains only the traversed sections.

Supported link directions:

- `both`: start to end and end to start
- `forward` (and other non-reverse, non-bidirectional values): start to end
- `reverse`: end to start

Routing cost is proportional to the traversed section's length and uses travel time:

`section_length_m / 1000 / speed_kmh * 3600`

The engine uses Dijkstra's algorithm. Gate and destination positions are snapped to the nearest link, and all link intersections are used as graph junctions. Shapely performs planar x/y geometry analysis and ignores Z values; grade-separated crossings therefore need explicit network metadata or preprocessing if they must not connect.

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

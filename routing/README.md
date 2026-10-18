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

Roads are graph connections:

- `both`: start to end and end to start
- `forward`: start to end
- `reverse`: end to start

Routing cost is travel time:

`length_m / 1000 / speed_kmh * 3600`

The engine uses Dijkstra's algorithm. Gate and destination junctions are calculated dynamically by finding the nearest junction.

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

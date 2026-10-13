# Temporary Road Routing Engine

File-based routing engine for a temporary road network.

## Data directory

Place these files in `data/`:

- `roads.geojson`
- `junctions.geojson`
- `gates.geojson`
- `destinations.geojson`
- `destinations_gates_lookup.csv`

Expected fields:

### roads.geojson

`road_id, start_node, end_node, name, direction, length, speed, type`

### junctions.geojson

`name`

### gates.geojson

`name`

### destinations.geojson

`name`

### destinations_gates_lookup.csv

`destination_id, gate_id`

Gate and destination junctions are calculated dynamically by finding the nearest junction.

## Routing

Roads are graph connections.

- `both`: start -> end and end -> start
- `forward`: start -> end
- `reverse`: end -> start

Routing cost is travel time:

`length_m / 1000 / speed_kmh * 3600`

The engine uses Dijkstra's algorithm.

## Run

```bash
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

pip install -r requirements.txt
uvicorn app:app --reload
```

## API

Health:

`GET /health`

Destinations:

`GET /destinations`

Route:

`POST /route`

Body:

```json
{
  "destination_id": "D001"
}
```

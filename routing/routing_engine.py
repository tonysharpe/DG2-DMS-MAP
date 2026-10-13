from __future__ import annotations

import csv
import heapq
import json
import math
from pathlib import Path
from typing import Any

from shapely.geometry import shape, Point, LineString, MultiLineString
from shapely.ops import transform
from pyproj import CRS, Transformer


class RoutingEngine:
    """
    File-based routing engine.

    Permanent network:
      - junctions.geojson: point features with property `name`
      - roads.geojson: MultiLineString features with
        road_id, start_node, end_node, name, direction, length, speed, type
      - gates.geojson: point features with property `name`
      - destinations.geojson: point features with property `name`
      - destinations_gates_lookup.csv:
        destination_id,gate_id

    Gate and destination junctions are NOT stored in the files.
    They are calculated dynamically as the nearest junction.
    """

    def __init__(self, data_dir: str | Path):
        self.data_dir = Path(data_dir)

        self.roads = self._load_geojson("roads.geojson")
        self.junctions = self._load_geojson("junctions.geojson")
        self.gates = self._load_geojson("gates.geojson")
        self.destinations = self._load_geojson("destinations.geojson")
        self.destination_areas = self._load_geojson("destination_areas.geojson")
        self.lookup = self._load_lookup()

        self._validate()
        self._prepare_junctions()
        self._prepare_graph()

    # ---------- loading ----------

    def _load_geojson(self, filename: str) -> dict[str, Any]:
        path = self.data_dir / filename
        if not path.exists():
            raise FileNotFoundError(f"Missing required file: {path}")

        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)

        if data.get("type") != "FeatureCollection":
            raise ValueError(f"{filename} must be a GeoJSON FeatureCollection")

        return data

    def _load_lookup(self) -> list[dict[str, str]]:
        path = self.data_dir / "destinations_gates_lookup.csv"
        if not path.exists():
            raise FileNotFoundError(f"Missing required file: {path}")

        with path.open("r", encoding="utf-8-sig", newline="") as f:
            rows = list(csv.DictReader(f))

        required = {"destination_id", "gate_id"}
        if not required.issubset(rows[0].keys() if rows else set()):
            raise ValueError(
                "destinations_gates_lookup.csv must contain "
                "destination_id, gate_id"
            )
        return rows

    # ---------- validation ----------

    @staticmethod
    def _features_by_name(data: dict[str, Any], filename: str) -> dict[str, dict]:
        result = {}
        for feature in data["features"]:
            name = feature.get("properties", {}).get("name")
            if name is None or str(name).strip() == "":
                raise ValueError(f"{filename} contains a feature without `name`")
            name = str(name)
            if name in result:
                raise ValueError(f"{filename} contains duplicate name: {name}")
            result[name] = feature
        return result

    def _validate(self):
        self.junction_by_name = self._features_by_name(
            self.junctions, "junctions.geojson"
        )
        self.gate_by_name = self._features_by_name(
            self.gates, "gates.geojson"
        )
        self.destination_by_name = self._features_by_name(
            self.destinations, "destinations.geojson"
        )
        self.destination_area_by_name = self._features_by_name(
            self.destination_areas, "destination_areas.geojson"
        )
        required_road_fields = {
            "road_id", "start_node", "end_node", "name",
            "direction", "length", "speed", "type"
        }

        road_ids = set()
        for feature in self.roads["features"]:
            p = feature.get("properties", {})
            missing = required_road_fields - set(p)
            if missing:
                raise ValueError(
                    f"Road is missing fields: {sorted(missing)}"
                )

            road_id = str(p["road_id"])
            if road_id in road_ids:
                raise ValueError(f"Duplicate road_id: {road_id}")
            road_ids.add(road_id)

            start = p["start_node"]
            end = p["end_node"]
            if start not in self.junction_by_name:
                raise ValueError(
                    f"Road {road_id}: start_node {start!r} is not a junction"
                )
            if end not in self.junction_by_name:
                raise ValueError(
                    f"Road {road_id}: end_node {end!r} is not a junction"
                )

            try:
                length = float(p["length"])
                speed = float(p["speed"])
            except (TypeError, ValueError):
                raise ValueError(
                    f"Road {road_id}: length and speed must be numeric"
                )

            if length < 0:
                raise ValueError(f"Road {road_id}: length cannot be negative")
            if speed <= 0:
                raise ValueError(f"Road {road_id}: speed must be > 0")

        self.road_by_id = {
            str(f["properties"]["road_id"]): f
            for f in self.roads["features"]
        }

        for row in self.lookup:
            d = row["destination_id"]
            g = row["gate_id"]
            if d not in self.destination_by_name:
                raise ValueError(
                    f"Lookup destination_id {d!r} not found in destinations.geojson"
                )
            if g not in self.gate_by_name:
                raise ValueError(
                    f"Lookup gate_id {g!r} not found in gates.geojson"
                )

    # ---------- geometry / nearest junction ----------

    def _prepare_junctions(self):
        self.junction_points = {}
        for name, feature in self.junction_by_name.items():
            self.junction_points[name] = shape(feature["geometry"])

        self._network_crs = self._geojson_crs(self.junctions)
        if self._network_crs is None:
            self._network_crs = self._geojson_crs(self.roads)

        # Nearest-junction calculation requires a projected CRS in metres.
        # The supplied example is EPSG:32638.
        if self._network_crs is None:
            raise ValueError(
                "GeoJSON CRS is required for nearest-junction calculation."
            )

        crs = CRS.from_user_input(self._network_crs)
        if crs.is_geographic:
            # Use Web Mercator only as a fallback for geographic source data.
            # For production accuracy, provide a suitable projected CRS.
            metric_crs = CRS.from_epsg(3857)
        else:
            metric_crs = crs

        self._to_metric = Transformer.from_crs(
            crs, metric_crs, always_xy=True
        ).transform

        self._junction_points_metric = {
            name: transform(self._to_metric, point)
            for name, point in self.junction_points.items()
        }

    @staticmethod
    def _geojson_crs(data: dict[str, Any]):
        crs = data.get("crs")
        if not crs:
            return None

        props = crs.get("properties", {})
        name = props.get("name") or props.get("href")
        if not name:
            return None

        # Common GeoJSON form:
        # urn:ogc:def:crs:EPSG::32638
        if "EPSG::" in name:
            return "EPSG:" + name.split("EPSG::", 1)[1]
        if name.startswith("EPSG:"):
            return name
        return name

    def _nearest_junction(self, feature: dict) -> tuple[str, float]:
        point = shape(feature["geometry"])
        metric_point = transform(self._to_metric, point)

        nearest_name = None
        nearest_distance = math.inf

        for name, junction_point in self._junction_points_metric.items():
            distance = metric_point.distance(junction_point)
            if distance < nearest_distance:
                nearest_name = name
                nearest_distance = distance

        return nearest_name, nearest_distance

    # ---------- graph ----------

    @staticmethod
    def _normalise_direction(value: Any) -> str:
        if value is None:
            return "both"

        s = str(value).strip().lower().replace("_", "-").replace(" ", "-")

        aliases = {
            "both": "both",
            "two-way": "both",
            "twoway": "both",
            "bidirectional": "both",
            "bi-directional": "both",

            "forward": "forward",
            "one-way": "forward",
            "oneway": "forward",
            "start-to-end": "forward",
            "start-end": "forward",

            "reverse": "reverse",
            "backward": "reverse",
            "end-to-start": "reverse",
            "reverse-one-way": "reverse",
        }

        if s not in aliases:
            raise ValueError(
                f"Unsupported road direction {value!r}. "
                f"Use both, forward, or reverse."
            )

        return aliases[s]

    @staticmethod
    def _travel_time_seconds(length: Any, speed: Any) -> float:
        length_m = float(length)
        speed_kmh = float(speed)
        return (length_m / 1000.0) / speed_kmh * 3600.0

    def _prepare_graph(self):
        # adjacency[node] = list of traversable road records
        self.graph = {name: [] for name in self.junction_by_name}

        for feature in self.roads["features"]:
            p = feature["properties"]
            road_id = str(p["road_id"])
            start = str(p["start_node"])
            end = str(p["end_node"])
            direction = self._normalise_direction(p["direction"])
            cost = self._travel_time_seconds(p["length"], p["speed"])

            if direction in ("both", "forward"):
                self.graph[start].append({
                    "to": end,
                    "road_id": road_id,
                    "cost": cost,
                })

            if direction in ("both", "reverse"):
                self.graph[end].append({
                    "to": start,
                    "road_id": road_id,
                    "cost": cost,
                })

    # ---------- route ----------

    def destination_ids(self) -> list[str]:
        return sorted(self.destination_by_name.keys())

    def _gate_for_destination(self, destination_id: str) -> str:
        matches = [
            row["gate_id"]
            for row in self.lookup
            if row["destination_id"] == destination_id
        ]

        if not matches:
            raise ValueError(
                f"No gate is configured for destination {destination_id!r}"
            )
        if len(matches) > 1:
            raise ValueError(
                f"Destination {destination_id!r} has multiple gates configured"
            )
        return matches[0]

    def _dijkstra(self, start: str, target: str):
        queue = [(0.0, start)]
        distance = {start: 0.0}
        previous: dict[str, tuple[str, str]] = {}

        while queue:
            current_cost, node = heapq.heappop(queue)

            if current_cost != distance.get(node):
                continue

            if node == target:
                break

            for connection in self.graph[node]:
                next_node = connection["to"]
                new_cost = current_cost + connection["cost"]

                if new_cost < distance.get(next_node, math.inf):
                    distance[next_node] = new_cost
                    previous[next_node] = (node, connection["road_id"])
                    heapq.heappush(queue, (new_cost, next_node))

        if target not in distance:
            return None

        nodes = []
        roads = []
        node = target

        while node != start:
            previous_node, road_id = previous[node]
            nodes.append(node)
            roads.append(road_id)
            node = previous_node

        nodes.append(start)
        nodes.reverse()
        roads.reverse()

        return {
            "nodes": nodes,
            "road_ids": roads,
            "travel_time_seconds": distance[target],
        }

    def route(self, destination_id: str) -> dict:
        if destination_id not in self.destination_by_name:
            raise ValueError(
                f"Unknown destination_id: {destination_id!r}"
            )

        gate_id = self._gate_for_destination(destination_id)

        gate_feature = self.gate_by_name[gate_id]
        destination_feature = self.destination_by_name[destination_id]
        destination_area_feature = self.destination_area_by_name.get(destination_id)

        start_junction, gate_distance = self._nearest_junction(gate_feature)
        end_junction, destination_distance = self._nearest_junction(
            destination_feature
        )

        result = self._dijkstra(start_junction, end_junction)

        if result is None:
            return {
                "status": "no_route",
                "message": (
                    "No route is available between the selected gate "
                    "and destination."
                ),
                "destination_id": destination_id,
                "gate_id": gate_id,
                "start_junction": start_junction,
                "end_junction": end_junction,
            }

        route_features = [
            self.road_by_id[road_id]
            for road_id in result["road_ids"]
        ]

        return {
            "status": "ok",
            "destination_id": destination_id,
            "destination_area": destination_area_feature["geometry"] if destination_area_feature else None,
            "gate_id": gate_id,
            "gate_coordinates": gate_feature["geometry"]["coordinates"],
            "destination_coordinates": destination_feature["geometry"]["coordinates"],            
            "start_junction": start_junction,
            "end_junction": end_junction,
            "gate_to_junction_distance_m": gate_distance,
            "destination_to_junction_distance_m": destination_distance,
            "travel_time_seconds": result["travel_time_seconds"],
            "road_ids": result["road_ids"],
            "junction_ids": result["nodes"],
            "route": {
                "type": "FeatureCollection",
                "features": route_features,
            },
        }

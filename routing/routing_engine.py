from __future__ import annotations

import csv
import hashlib
import heapq
import json
import math
from pathlib import Path
from typing import Any

from pyproj import CRS, Transformer
from shapely.geometry import LineString, MultiLineString, Point, shape
from shapely.ops import transform


class RoutingEngine:
    """Route over directed links from the shared roads.geojson network."""

    def __init__(self, data_dir: str | Path):
        self.data_dir = Path(data_dir)
        roads_path = self.data_dir / "roads.geojson"
        roads_bytes = roads_path.read_bytes() if roads_path.exists() else b""
        self.network_info = {
            "file": "roads.geojson",
            "path": str(roads_path.resolve()),
            "sha256": hashlib.sha256(roads_bytes).hexdigest(),
            "file_bytes": len(roads_bytes),
        }
        self.roads = self._load_geojson("roads.geojson")
        self.network_info["feature_count"] = len(self.roads.get("features", []))
        self.gates = self._load_geojson("gates.geojson")
        self.destinations = self._load_geojson("destinations.geojson")
        self.destination_areas = self._load_geojson("destination_areas.geojson")
        self.lookup = self._load_lookup()
        self.gate_by_name = self._features_by_name(self.gates, "gates.geojson")
        self.destination_by_name = self._features_by_name(
            self.destinations, "destinations.geojson"
        )
        self.destination_area_by_name = self._features_by_name(
            self.destination_areas, "destination_areas.geojson"
        )
        self._prepare_projection()
        self.links = self._prepare_links()
        self._validate_lookup()

        # Build the road topology once per process from the exact roads.geojson
        # fingerprint above. A deployment with updated roads rebuilds this graph.
        self._junction_cuts = self._network_junction_cuts()
        self._base_graph = self._build_graph_with_cuts(None, None, self._junction_cuts)
        self.network_info["graph_nodes"] = len(self._base_graph)
        self.network_info["graph_arcs"] = sum(len(edges) for edges in self._base_graph.values())

    def _load_geojson(self, filename: str) -> dict[str, Any]:
        path = self.data_dir / filename
        if not path.exists():
            raise FileNotFoundError(f"Missing required file: {path}")
        with path.open("r", encoding="utf-8") as source:
            data = json.load(source)
        if data.get("type") != "FeatureCollection":
            raise ValueError(f"{filename} must be a GeoJSON FeatureCollection")
        return data

    def _load_lookup(self) -> list[dict[str, str]]:
        path = self.data_dir / "destinations_gates_lookup.csv"
        if not path.exists():
            raise FileNotFoundError(f"Missing required file: {path}")
        with path.open("r", encoding="utf-8-sig", newline="") as source:
            rows = list(csv.DictReader(source))
        if not {"destination_id", "gate_id"}.issubset(
            rows[0].keys() if rows else set()
        ):
            raise ValueError(
                "destinations_gates_lookup.csv must contain destination_id, gate_id"
            )
        return rows

    @staticmethod
    def _features_by_name(data: dict[str, Any], filename: str) -> dict[str, dict]:
        result = {}
        for feature in data.get("features", []):
            name = feature.get("properties", {}).get("name")
            if name is None or not str(name).strip():
                raise ValueError(f"{filename} contains a feature without 'name'")
            name = str(name)
            if name in result:
                raise ValueError(f"{filename} contains duplicate name: {name}")
            result[name] = feature
        return result

    def _prepare_projection(self):
        # roads.geojson uses CRS84 longitude/latitude coordinates in Riyadh.
        # UTM zone 38N provides metric distances for snapping and travel costs.
        self._to_metric = Transformer.from_crs(
            CRS.from_epsg(4326), CRS.from_epsg(32638), always_xy=True
        ).transform
        self._to_geo = Transformer.from_crs(
            CRS.from_epsg(32638), CRS.from_epsg(4326), always_xy=True
        ).transform
        meta_path = self.data_dir / "meta.json"
        default_speed = 30.0
        if meta_path.exists():
            with meta_path.open("r", encoding="utf-8") as source:
                meta = json.load(source)
            default_speed = float(
                meta.get("routing", {}).get("default_speed_kmh", default_speed)
            )
        self.default_speed_kmh = default_speed

    def _prepare_links(self) -> list[dict[str, Any]]:
        links = []
        for feature_index, feature in enumerate(self.roads.get("features", [])):
            properties = feature.get("properties", {})
            geometry = shape(feature.get("geometry"))
            if isinstance(geometry, LineString):
                parts = [geometry]
            elif isinstance(geometry, MultiLineString):
                parts = list(geometry.geoms)
            else:
                continue

            direction = str(properties.get("direction", "one")).strip().lower()
            bidirectional = direction == "both"
            speed_value = properties.get("speed")
            try:
                speed_kmh = float(speed_value) if speed_value not in (None, "") else self.default_speed_kmh
            except (TypeError, ValueError):
                speed_kmh = self.default_speed_kmh
            if speed_kmh <= 0:
                raise ValueError(f"Road feature {feature_index} has a non-positive speed")

            for part_index, part in enumerate(parts):
                if len(part.coords) < 2 or part.length == 0:
                    continue
                metric_line = transform(self._to_metric, part)
                if metric_line.length == 0:
                    continue
                try:
                    road_length_m = float(properties.get("length", metric_line.length))
                except (TypeError, ValueError):
                    road_length_m = metric_line.length
                if road_length_m <= 0:
                    road_length_m = metric_line.length
                links.append({
                    "id": f"road_{feature_index + 1:05d}_{part_index + 1:02d}",
                    "feature_index": feature_index,
                    "part_index": part_index,
                    "properties": properties,
                    "line": metric_line,
                    "direction": str(properties.get("direction", "one")),
                    "bidirectional": bidirectional,
                    "speed_kmh": speed_kmh,
                    "length_m": road_length_m,
                    "geometry_length_m": metric_line.length,
                })
        if not links:
            raise ValueError("roads.geojson contains no usable LineString links")
        return links

    def _validate_lookup(self):
        for row in self.lookup:
            destination_id, gate_id = row["destination_id"], row["gate_id"]
            if destination_id not in self.destination_by_name:
                raise ValueError(
                    f"Lookup destination_id {destination_id!r} not found in destinations.geojson"
                )
            if gate_id not in self.gate_by_name:
                raise ValueError(
                    f"Lookup gate_id {gate_id!r} not found in gates.geojson"
                )

    @staticmethod
    def _node_for_endpoint(point: Point) -> str:
        # Keep node identity finer than the 0.1 m connectivity tolerance.
        return f"n:{point.x:.3f}:{point.y:.3f}"

    def _snap_to_link(self, feature: dict) -> dict[str, Any]:
        point = transform(self._to_metric, shape(feature["geometry"]))
        nearest = None
        nearest_distance = math.inf
        for link in self.links:
            distance = link["line"].distance(point)
            if distance < nearest_distance:
                nearest, nearest_distance = link, distance
        if nearest is None:
            raise ValueError("No usable road links are available for snapping")
        line = nearest["line"]
        measure = line.project(point)
        snapped_point = line.interpolate(measure)
        # Use the actual closest point on the link. Only exact (or numerical
        # precision-level) endpoint projections reuse an endpoint graph node.
        endpoint_epsilon = 1e-6
        if measure <= endpoint_epsilon:
            node_id = self._node_for_endpoint(Point(line.coords[0]))
            measure = 0.0
        elif line.length - measure <= endpoint_epsilon:
            node_id = self._node_for_endpoint(Point(line.coords[-1]))
            measure = line.length
        else:
            node_id = f"snap:{nearest['id']}:{measure:.3f}"
        return {
            "link": nearest,
            "measure": measure,
            "point": snapped_point,
            "node": node_id,
            "snap_distance_m": nearest_distance,
        }

    @staticmethod
    def _coordinate_at_distance(line: LineString, distance: float) -> tuple[float, float]:
        distance = max(0.0, min(float(distance), line.length))
        coords = list(line.coords)
        walked = 0.0
        for start, end in zip(coords, coords[1:]):
            segment_length = math.dist(start[:2], end[:2])
            if walked + segment_length >= distance:
                if segment_length == 0:
                    return (float(start[0]), float(start[1]))
                ratio = (distance - walked) / segment_length
                return (
                    float(start[0] + (end[0] - start[0]) * ratio),
                    float(start[1] + (end[1] - start[1]) * ratio),
                )
            walked += segment_length
        return (float(coords[-1][0]), float(coords[-1][1]))

    def _segment_coordinates(self, line: LineString, start: float, end: float):
        coords = list(line.coords)
        if end < start:
            return list(reversed(self._segment_coordinates(line, end, start)))
        result = [self._coordinate_at_distance(line, start)]
        walked = 0.0
        for coord_a, coord_b in zip(coords, coords[1:]):
            walked += math.dist(coord_a[:2], coord_b[:2])
            if start < walked < end:
                result.append((float(coord_b[0]), float(coord_b[1])))
        result.append(self._coordinate_at_distance(line, end))
        # Avoid duplicate consecutive coordinates that can create invalid lines.
        clean = []
        for coord in result:
            if not clean or math.dist(coord, clean[-1]) > 1e-6:
                clean.append(coord)
        return clean if len(clean) >= 2 else [result[0], result[0]]

    def _network_junction_cuts(self):
        """Connect shape points within 0.1 m using a spatial grid.

        The grid avoids comparing every vertex against every vertex on nearby
        links. Only points in the same or adjacent 0.1 m cells are candidates.
        """
        tolerance_m = 0.1
        cell_size = tolerance_m
        records = []
        grid = {}
        parent = []
        rank = []
        linked = set()

        def find(index):
            while parent[index] != index:
                parent[index] = parent[parent[index]]
                index = parent[index]
            return index

        def union(left, right):
            root_left, root_right = find(left), find(right)
            if root_left == root_right:
                return
            if rank[root_left] < rank[root_right]:
                root_left, root_right = root_right, root_left
            parent[root_right] = root_left
            if rank[root_left] == rank[root_right]:
                rank[root_left] += 1
            linked.add(left)
            linked.add(right)

        for link in self.links:
            line = link["line"]
            coordinates = list(line.coords)
            measure = 0.0
            for coordinate_index, coordinate in enumerate(coordinates):
                point = Point(coordinate[:2])
                record_index = len(records)
                records.append({
                    "link": link,
                    "point": point,
                    "measure": measure,
                })
                parent.append(record_index)
                rank.append(0)
                cell_x = math.floor(point.x / cell_size)
                cell_y = math.floor(point.y / cell_size)

                # Compare only with previously inserted points in the 3x3
                # neighborhood. Requiring different links prevents a link from
                # creating a junction with itself.
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        for other_index in grid.get((cell_x + dx, cell_y + dy), ()):
                            other = records[other_index]
                            if other["link"]["id"] == link["id"]:
                                continue
                            if point.distance(other["point"]) <= tolerance_m:
                                union(record_index, other_index)

                grid.setdefault((cell_x, cell_y), []).append(record_index)
                if coordinate_index + 1 < len(coordinates):
                    measure += math.dist(coordinate[:2], coordinates[coordinate_index + 1][:2])

        components = {}
        for index in linked:
            components.setdefault(find(index), []).append(index)

        cuts = {link["id"]: [] for link in self.links}
        for members in components.values():
            link_ids = {records[index]["link"]["id"] for index in members}
            if len(link_ids) < 2:
                continue
            # Stable representative gives every connected shape point the same
            # graph node, even when several links meet within the tolerance.
            representative = min(
                members,
                key=lambda index: (
                    records[index]["link"]["id"],
                    records[index]["measure"],
                    records[index]["point"].x,
                    records[index]["point"].y,
                ),
            )
            node = self._node_for_endpoint(records[representative]["point"])
            for index in members:
                record = records[index]
                cuts[record["link"]["id"]].append(
                    (record["measure"], node, "junction")
                )
        return cuts

    def _build_graph_with_cuts(self, gate_snap, destination_snap, junction_cuts):
        graph: dict[str, list[dict[str, Any]]] = {}
        snap_by_link: dict[str, list[tuple[float, str, str]]] = {}
        snaps = {
            label: snap for label, snap in
            (("gate", gate_snap), ("destination", destination_snap))
            if snap is not None
        }
        for label, snap in snaps.items():
            snap_by_link.setdefault(snap["link"]["id"], []).append(
                (snap["measure"], snap["node"], label)
            )

        def add_arc(start_node, end_node, link, start_measure, end_measure, reverse=False):
            if start_node == end_node or abs(end_measure - start_measure) < 1e-6:
                return
            low, high = sorted((start_measure, end_measure))
            coords = self._segment_coordinates(link["line"], low, high)
            if reverse:
                coords.reverse()
            segment_geom_length = high - low
            segment_road_length = (
                link["length_m"] * segment_geom_length / link["geometry_length_m"]
            )
            cost = (segment_road_length / 1000.0) / link["speed_kmh"] * 3600.0
            route_coords = [transform(self._to_geo, Point(x, y)).coords[0] for x, y in coords]
            edge = {
                "to": end_node,
                "link": link,
                "cost": cost,
                "coordinates": [(float(x), float(y)) for x, y in route_coords],
                "reverse": reverse,
                "length_m": segment_road_length,
                "start_measure": start_measure,
                "end_measure": end_measure,
            }
            graph.setdefault(start_node, []).append(edge)
            graph.setdefault(end_node, [])

        for link in self.links:
            line = link["line"]
            start_node = self._node_for_endpoint(Point(line.coords[0]))
            end_node = self._node_for_endpoint(Point(line.coords[-1]))
            cuts = [(0.0, start_node, "junction"), (line.length, end_node, "junction")]
            cuts.extend(junction_cuts.get(link["id"], []))
            cuts.extend(
                (measure, node_id, label)
                for measure, node_id, label in snap_by_link.get(link["id"], [])
            )
            cuts.sort(key=lambda item: item[0])
            deduped = []
            for measure, node_id, kind in cuts:
                if deduped and abs(measure - deduped[-1][0]) <= 0.1:
                    previous_measure, previous_node, previous_kind = deduped[-1]
                    # Prefer the shared network node over a gate/destination's
                    # private snap node when they land within the snap tolerance.
                    if previous_kind != "junction" and kind == "junction":
                        deduped[-1] = (previous_measure, node_id, kind)
                        for label, snap in snaps.items():
                            if snap["link"]["id"] == link["id"] and abs(snap["measure"] - measure) <= 0.25:
                                snap["node"] = node_id
                                snap["measure"] = measure
                                snap["point"] = line.interpolate(measure)
                    elif kind != "junction" and previous_kind == "junction":
                        for label, snap in snaps.items():
                            if label == kind and snap["link"]["id"] == link["id"] and abs(snap["measure"] - previous_measure) <= 0.25:
                                snap["node"] = previous_node
                                snap["measure"] = previous_measure
                                snap["point"] = line.interpolate(previous_measure)
                    continue
                deduped.append((measure, node_id, kind))
            for (m0, n0, _), (m1, n1, _) in zip(deduped, deduped[1:]):
                direction = link["direction"].strip().lower()
                if direction == "both":
                    add_arc(n0, n1, link, m0, m1)
                    add_arc(n1, n0, link, m1, m0, reverse=True)
                elif direction == "reverse":
                    add_arc(n1, n0, link, m1, m0, reverse=True)
                else:
                    add_arc(n0, n1, link, m0, m1)

        return graph

    def _make_split_edge(self, link, start_measure, end_measure, end_node, reverse):
        low, high = sorted((start_measure, end_measure))
        coordinates = self._segment_coordinates(link["line"], low, high)
        if reverse:
            coordinates.reverse()
        length_m = link["length_m"] * abs(end_measure - start_measure) / link["geometry_length_m"]
        cost = (length_m / 1000.0) / link["speed_kmh"] * 3600.0
        geo_coordinates = [
            transform(self._to_geo, Point(x, y)).coords[0]
            for x, y in coordinates
        ]
        return {
            "to": end_node,
            "link": link,
            "cost": cost,
            "coordinates": [(float(x), float(y)) for x, y in geo_coordinates],
            "reverse": reverse,
            "length_m": length_m,
            "start_measure": start_measure,
            "end_measure": end_measure,
        }

    def _insert_snap_into_graph(self, graph, snap):
        link = snap["link"]
        measure = snap["measure"]
        tolerance = 0.1
        boundary = None
        candidates = []

        for from_node, edges in graph.items():
            for edge in edges:
                if edge["link"]["id"] != link["id"]:
                    continue
                start_m, end_m = edge["start_measure"], edge["end_measure"]
                if abs(measure - start_m) <= tolerance:
                    boundary = (from_node, start_m)
                    break
                if abs(measure - end_m) <= tolerance:
                    boundary = (edge["to"], end_m)
                    break
                if min(start_m, end_m) < measure < max(start_m, end_m):
                    candidates.append((from_node, edge))
            if boundary is not None:
                break

        if boundary is not None:
            snap["node"], snap["measure"] = boundary
            snap["point"] = link["line"].interpolate(snap["measure"])
            return

        if not candidates:
            raise ValueError(f"Snap point could not be inserted into cached link {link['id']}")

        snap_node = snap["node"]
        replacements = {}
        from_snap = []
        for from_node, edge in candidates:
            start_m, end_m = edge["start_measure"], edge["end_measure"]
            replacements.setdefault(from_node, {})[id(edge)] = self._make_split_edge(
                link, start_m, measure, snap_node, edge["reverse"]
            )
            from_snap.append(self._make_split_edge(
                link, measure, end_m, edge["to"], edge["reverse"]
            ))

        for from_node, edges in list(graph.items()):
            replace_by_id = replacements.get(from_node)
            if replace_by_id:
                graph[from_node] = [replace_by_id.get(id(edge), edge) for edge in edges]
        graph.setdefault(snap_node, []).extend(from_snap)

    def _build_route_graph(self, gate_snap, destination_snap):
        # Test fixtures may construct the engine without running __init__.
        if not hasattr(self, "_base_graph"):
            return self._build_graph_with_cuts(
                gate_snap, destination_snap, self._network_junction_cuts()
            )
        # Reuse the prebuilt topology; clone its adjacency lists and split only
        # the one or two links containing the current gate/destination snaps.
        graph = {
            node: [edge.copy() for edge in edges]
            for node, edges in self._base_graph.items()
        }
        self._insert_snap_into_graph(graph, gate_snap)
        if destination_snap["node"] != gate_snap["node"]:
            self._insert_snap_into_graph(graph, destination_snap)
        return graph

    @staticmethod
    def _reachable_nodes(graph, start: str) -> set[str]:
        visited = set()
        stack = [start]
        while stack:
            node = stack.pop()
            if node in visited:
                continue
            visited.add(node)
            stack.extend(edge["to"] for edge in graph.get(node, []) if edge["to"] not in visited)
        return visited

    def route(self, destination_id: str) -> dict:
        # Also detect in-place data updates; normal Render deployments rebuild
        # the graph on process start, while this covers mounted/replaced files.
        roads_path = self.data_dir / "roads.geojson"
        current_hash = hashlib.sha256(roads_path.read_bytes()).hexdigest()
        if current_hash != self.network_info["sha256"]:
            self.__init__(self.data_dir)

        if destination_id not in self.destination_by_name:
            raise ValueError(f"Unknown destination_id: {destination_id!r}")
        gate_id = self._gate_for_destination(destination_id)
        gate_feature = self.gate_by_name[gate_id]
        destination_feature = self.destination_by_name[destination_id]
        gate_snap = self._snap_to_link(gate_feature)
        destination_snap = self._snap_to_link(destination_feature)
        # If both points snap to effectively the same position on one link,
        # share a graph node so duplicate cut points cannot disconnect the route.
        if (
            gate_snap["link"]["id"] == destination_snap["link"]["id"]
            and abs(gate_snap["measure"] - destination_snap["measure"]) <= 0.25
        ):
            destination_snap["node"] = gate_snap["node"]
            destination_snap["measure"] = gate_snap["measure"]
            destination_snap["point"] = gate_snap["point"]
        graph = self._build_route_graph(gate_snap, destination_snap)
        result = self._dijkstra(graph, gate_snap["node"], destination_snap["node"])
        if result is None:
            return {
                "network_info": self.network_info,
                "status": "no_route",
                "message": (
                    "No directionally valid route exists between the selected gate "
                    "and destination on roads.geojson."
                ),
                "destination_id": destination_id,
                "gate_id": gate_id,
                "gate_snap_distance_m": gate_snap["snap_distance_m"],
                "destination_snap_distance_m": destination_snap["snap_distance_m"],
            }

        route_edges, travel_time_seconds = result
        route_features = []
        road_ids = []
        for edge in route_edges:
            link = edge["link"]
            road_ids.append(link["id"])
            route_features.append({
                "type": "Feature",
                "properties": {
                    **link["properties"],
                    "road_id": link["id"],
                    "route_direction": "reverse" if edge["reverse"] else "forward",
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": edge["coordinates"],
                },
            })

        area = self.destination_area_by_name.get(destination_id)
        return {
            "status": "ok",
            "network_info": self.network_info,
            "destination_id": destination_id,
            "destination_area": area["geometry"] if area else None,
            "gate_id": gate_id,
            "gate_coordinates": gate_feature["geometry"]["coordinates"],
            "destination_coordinates": destination_feature["geometry"]["coordinates"],
            "gate_snap_coordinates": list(transform(self._to_geo, gate_snap["point"]).coords[0]),
            "destination_snap_coordinates": list(transform(self._to_geo, destination_snap["point"]).coords[0]),
            "gate_snap_distance_m": gate_snap["snap_distance_m"],
            "destination_snap_distance_m": destination_snap["snap_distance_m"],
            "travel_time_seconds": travel_time_seconds,
            "road_ids": road_ids,
            "junction_ids": [gate_snap["node"], destination_snap["node"]],
            "route": {"type": "FeatureCollection", "features": route_features},
        }

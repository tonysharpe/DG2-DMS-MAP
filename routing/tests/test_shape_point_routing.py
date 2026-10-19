import unittest

from shapely.geometry import LineString

from routing.routing_engine import RoutingEngine


def make_link(link_id, coordinates, direction="both"):
    line = LineString(coordinates)
    return {
        "id": link_id,
        "line": line,
        "direction": direction,
        "bidirectional": direction == "both",
        "properties": {},
        "speed_kmh": 30.0,
        "length_m": line.length,
        "geometry_length_m": line.length,
    }


class ShapePointRoutingTests(unittest.TestCase):
    def setUp(self):
        self.engine = RoutingEngine.__new__(RoutingEngine)
        # Synthetic tests use the same coordinates for metric and output space.
        self.engine._to_geo = lambda x, y, z=None: (x, y)

    def test_endpoint_connects_to_another_link_at_shape_point(self):
        road = make_link("road", [(0, 0), (5, 0), (10, 0)])
        branch = make_link("branch", [(5, 0), (5, 5)])
        self.engine.links = [road, branch]

        gate = {
            "link": road, "measure": 0.0, "node": "n:0:0",
            "point": road["line"].interpolate(0),
        }
        destination = {
            "link": branch, "measure": branch["line"].length,
            "node": "n:5:5", "point": branch["line"].interpolate(branch["line"].length),
        }
        graph = self.engine._build_route_graph(gate, destination)

        junction = "n:5:0"
        outgoing_links = {edge["link"]["id"] for edge in graph[junction]}
        self.assertEqual(outgoing_links, {"road", "branch"})

    def test_geometric_intersection_splits_both_links(self):
        road = make_link("road", [(0, 0), (10, 0)])
        crossing = make_link("crossing", [(5, -5), (5, 5)])
        self.engine.links = [road, crossing]
        cuts = self.engine._network_junction_cuts()

        road_nodes = {node for _, node, _ in cuts["road"]}
        crossing_nodes = {node for _, node, _ in cuts["crossing"]}
        self.assertIn("n:5:0", road_nodes)
        self.assertIn("n:5:0", crossing_nodes)

    def test_nearby_vertex_splits_target_link_with_shared_node(self):
        # The branch endpoint is within the 1 m topology-repair tolerance of
        # the middle of the main road, but does not exactly intersect it.
        road = make_link("road", [(0, 0), (10, 0)])
        branch = make_link("branch", [(5, 0.5), (5, 5)])
        self.engine.links = [road, branch]

        cuts = self.engine._network_junction_cuts()
        road_nodes = {node for _, node, _ in cuts["road"]}
        branch_nodes = {node for _, node, _ in cuts["branch"]}
        self.assertIn("n:5:0", road_nodes)
        self.assertIn("n:5:0", branch_nodes)

    def test_reverse_direction_arcs_follow_link_direction(self):
        road = make_link("reverse-road", [(0, 0), (10, 0)], direction="reverse")
        self.engine.links = [road]
        gate = {
            "link": road, "measure": 0.0, "node": "n:0:0",
            "point": road["line"].interpolate(0),
        }
        destination = {
            "link": road, "measure": road["line"].length,
            "node": "n:10:0", "point": road["line"].interpolate(road["line"].length),
        }
        graph = self.engine._build_route_graph(gate, destination)
        self.assertEqual(graph["n:10:0"][0]["to"], "n:0:0")
        self.assertTrue(graph["n:10:0"][0]["reverse"])
        self.assertEqual(graph["n:0:0"], [])


if __name__ == "__main__":
    unittest.main()

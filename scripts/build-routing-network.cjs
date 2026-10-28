"use strict";

const fs = require("node:fs");
const path = require("node:path");
const proj4 = require("proj4");

const ROOT = path.resolve(__dirname, "..");
const INPUT_ROADS = path.join(ROOT, "data/roads.geojson");
const OUTPUT = path.join(ROOT, "data/routing-network.json");
const NODES_GEOJSON_OUTPUT = path.join(ROOT, "data/routing-network-nodes.geojson");
const LINKS_GEOJSON_OUTPUT = path.join(ROOT, "data/routing-network-links.geojson");
const CHECK_NODES_GEOJSON_OUTPUT = path.join(ROOT, "data/routing-network-check-nodes.geojson");
const UTM = "+proj=utm +zone=38 +datum=WGS84 +units=m +no_defs";
const toLonLat = coordinates => proj4(UTM, "EPSG:4326", coordinates);
const SHAPE_POINT_CONNECT_TOLERANCE = 0.1;
const CHECK_NODE_MAX_DISTANCE = 5.0;
const VEHICLES = ["car", "suv", "pickup", "minibus", "bus", "truck"];
const SUPPORTED_TYPES = new Set(["major", "minor", "local", "public", "haul", "main"]);

const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const field = (properties, name) => {
  const key = Object.keys(properties || {}).find(k => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? "" : String(properties[key] ?? "").trim().toLowerCase();
};
const xy = coordinates => {
  const result = proj4("EPSG:4326", UTM, coordinates);
  if (!result.every(Number.isFinite)) throw new Error("Invalid coordinate: " + coordinates);
  return result;
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const features = data => Array.isArray(data.features) ? data.features : [];
const nameOf = (properties, fallback) => {
  const name = properties?.Name ?? properties?.name ?? properties?.id;
  if (name === undefined || name === null || String(name).trim() === "") throw new Error("Missing name for " + fallback);
  return String(name).trim();
};
const pointOf = (feature, fallback) => {
  const g = feature.geometry;
  if (!g) throw new Error("Missing geometry for " + fallback);
  if (g.type === "Point") return g.coordinates;
  if (g.type === "MultiPoint" && Array.isArray(g.coordinates?.[0])) return g.coordinates[0];
  throw new Error("Expected point geometry for " + fallback);
};
const roundabout = p => /\broundabout\b/i.test(field(p, "name")) || /\br[\s_-]*\d+\b/i.test(field(p, "name"));

const roadsData = readJson(INPUT_ROADS);
const nodes = new Map();
const generatedEndpointIds = new Set();
const links = [];
const linkIds = new Set();
let skippedParts = 0;
const roadFeatures = features(roadsData);
let nextNodeNumber = 1;

function addShapeNode(point, linkId, vertexIndex) {
  const id = "N_" + String(nextNodeNumber++).padStart(7, "0");
  nodes.set(id, [...point]);
  generatedEndpointIds.add(id);
  return { id, point: [...point], linkId, vertexIndex };
}

const shapeVertices = [];
for (let featureIndex = 0; featureIndex < roadFeatures.length; featureIndex++) {
  const feature = roadFeatures[featureIndex];
  const properties = feature.properties || {};
  const geometry = feature.geometry;
  const rawId = properties.road_id ?? properties.id;
  const baseId = rawId !== undefined && rawId !== null && String(rawId).trim() !== ""
    ? String(rawId).trim()
    : "R_" + String(featureIndex + 1).padStart(4, "0");
  let coordinateParts;
  if (geometry?.type === "LineString") coordinateParts = [geometry.coordinates];
  else if (geometry?.type === "MultiLineString") coordinateParts = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  else { skippedParts++; continue; }

  const usableParts = coordinateParts
    .map((part, sourcePartIndex) => ({ part, sourcePartIndex }))
    .filter(item => Array.isArray(item.part) && item.part.length >= 2)
    .map(({ part, sourcePartIndex }) => ({
      sourcePartIndex,
      points: part.map(coordinate => xy(coordinate))
    }))
    .map(part => {
      let geometryLength = 0;
      for (let i = 1; i < part.points.length; i++) geometryLength += dist(part.points[i - 1], part.points[i]);
      return { ...part, geometryLength };
    })
    .filter(part => Number.isFinite(part.geometryLength) && part.geometryLength > 0);

  if (!usableParts.length) { skippedParts++; continue; }

  for (let partIndex = 0; partIndex < usableParts.length; partIndex++) {
    const part = usableParts[partIndex];
    const id = usableParts.length > 1 ? baseId + "_P" + (partIndex + 1) : baseId;
    if (linkIds.has(id)) throw new Error("Duplicate road link id: " + id);
    linkIds.add(id);

    const points = part.points.map(point => [...point]);
    const measures = [0];
    for (let i = 1; i < points.length; i++) measures.push(measures[i - 1] + dist(points[i - 1], points[i]));
    const geometryLength = measures[measures.length - 1];
    if (!(geometryLength > 0)) { skippedParts++; continue; }

    const vertexNodes = points.map((point, vertexIndex) => {
      // A repeated coordinate within a single source line is the same graph node.
      if (vertexIndex > 0 && dist(points[vertexIndex - 1], point) <= 0.0001) {
        return shapeVertices.find(v => v.linkId === id && v.vertexIndex === vertexIndex - 1) ||
          addShapeNode(point, id, vertexIndex);
      }
      const vertex = addShapeNode(point, id, vertexIndex);
      shapeVertices.push(vertex);
      return vertex;
    });
    // Ensure every vertex is registered, including repeated-coordinate vertices.
    for (const vertex of vertexNodes) {
      if (!shapeVertices.some(v => v.id === vertex.id)) shapeVertices.push(vertex);
    }

    const type = field(properties, "type");
    const access = Object.fromEntries(VEHICLES.map(vehicle => [
      vehicle,
      SUPPORTED_TYPES.has(type) && field(properties, vehicle) === "yes" ? "yes" : "no"
    ]));
    // Shape vertices describe the source geometry, not routing junctions.
    // Initially split only at road-part endpoints. Internal vertices become
    // cuts only when a shape point on another road connects at that location.
    const cuts = [
      { m: measures[0], node: vertexNodes[0].id },
      { m: measures[measures.length - 1], node: vertexNodes[vertexNodes.length - 1].id }
    ];
    links.push({
      id,
      sourceFeatureIndex: featureIndex,
      sourcePartIndex: part.sourcePartIndex,
      startNode: vertexNodes[0].id,
      endNode: vertexNodes[vertexNodes.length - 1].id,
      points,
      measures,
      geometryLength,
      type,
      access,
      cuts
    });
  }
}

// Only source shape points can connect. No junction data, projected-on-line
// cuts, or inferred intersections are used. Nearby points on different links
// are connected only when their measured separation is <= 0.1 m.
const cellSize = CHECK_NODE_MAX_DISTANCE;
const cellKey = (x, y) => Math.floor(x / cellSize) + ":" + Math.floor(y / cellSize);
const vertexGrid = new Map();
for (const vertex of shapeVertices) {
  const point = vertex.point;
  const key = cellKey(point[0], point[1]);
  let bucket = vertexGrid.get(key);
  if (!bucket) vertexGrid.set(key, bucket = []);
  bucket.push(vertex);
}
const topologyConnections = [];
const checkNodePairs = new Map();
const seenConnectedPairs = new Set();
for (const vertex of shapeVertices) {
  const [x, y] = vertex.point;
  const cx = Math.floor(x / cellSize), cy = Math.floor(y / cellSize);
  const candidates = [];
  for (let gx = cx - 1; gx <= cx + 1; gx++) {
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      candidates.push(...(vertexGrid.get(gx + ":" + gy) || []));
    }
  }
  const nearestByLink = new Map();
  for (const other of candidates) {
    if (other.id === vertex.id || other.linkId === vertex.linkId) continue;
    const distance = dist(vertex.point, other.point);
    if (distance > CHECK_NODE_MAX_DISTANCE) continue;
    const previous = nearestByLink.get(other.linkId);
    if (!previous || distance < previous.distance) nearestByLink.set(other.linkId, { other, distance });
  }
  for (const { other, distance } of nearestByLink.values()) {
    const pairKey = [vertex.id, other.id].sort().join("|");
    if (distance <= SHAPE_POINT_CONNECT_TOLERANCE) {
      if (seenConnectedPairs.has(pairKey)) continue;
      seenConnectedPairs.add(pairKey);
      topologyConnections.push({
        road_id: vertex.linkId,
        node: vertex.id,
        connected_node: other.id,
        offset_m: Number(distance.toFixed(4)),
        shared_position: true
      });
    } else {
      const key = [vertex.id, other.id].sort().join("|");
      if (!checkNodePairs.has(key)) {
        checkNodePairs.set(key, {
          a: vertex,
          b: other,
          distance
        });
      }
    }
  }
}

// Promote only cross-road shape-point connections to internal link cuts.
const vertexById = new Map(shapeVertices.map(vertex => [vertex.id, vertex]));
const linkById = new Map(links.map(link => [link.id, link]));
for (const connection of topologyConnections) {
  for (const nodeId of [connection.node, connection.connected_node]) {
    const vertex = vertexById.get(nodeId);
    if (!vertex) continue;
    const link = linkById.get(vertex.linkId);
    if (!link) continue;
    const measure = link.measures[vertex.vertexIndex];
    if (!link.cuts.some(cut => Math.abs(cut.m - measure) <= 0.0001)) {
      link.cuts.push({ m: measure, node: vertex.id });
    }
  }
}
for (const link of links) link.cuts.sort((a, b) => a.m - b.m);

const nodeEntries = [...nodes]
  .filter(([id]) => links.some(link => link.cuts.some(cut => cut.node === id)))
  .map(([id, point]) => ({ id, xy: point, generated: true }));
const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: {
    roadsSha256: require("node:crypto").createHash("sha256").update(fs.readFileSync(INPUT_ROADS)).digest("hex")
  },
  vehicles: VEHICLES,
  nodes: nodeEntries,
  links: links.map(({ points, measures, geometryLength, ...link }) => link),
  connections: topologyConnections,
  statistics: {
    topologyConnections: topologyConnections.length,
    sharedPositionConnections: topologyConnections.length,
    shapePointNodes: nodeEntries.length,
    links: links.length,
    linksByVehicle: Object.fromEntries(VEHICLES.map(vehicle => [
      vehicle, links.filter(link => link.access[vehicle] === "yes").length
    ])),
    checkNodePairs: checkNodePairs.size,
    skippedParts
  }
};
fs.writeFileSync(OUTPUT, JSON.stringify(output));

// Export a WGS84 point layer containing every junction and generated endpoint
// node, suitable for direct inspection in QGIS.
const nodesGeoJson = {
  type: "FeatureCollection",
  name: "routing_network_nodes",
  metadata: { generatedAt: output.generatedAt, sourceRoadsSha256: output.source.roadsSha256 },
  crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
  features: output.nodes.map(node => ({
    type: "Feature",
    properties: {
      node_id: node.id,
      node_kind: "shape_point",
      generated: node.generated
    },
    geometry: { type: "Point", coordinates: toLonLat(node.xy) }
  }))
};
fs.writeFileSync(NODES_GEOJSON_OUTPUT, JSON.stringify(nodesGeoJson));

// Export each actual routing edge (the portion between consecutive cuts), not
// merely the unsplit source road. This lets QGIS show the graph the router uses.
function pointAt(link, measure) {
  if (measure <= 0) return [...link.points[0]];
  if (measure >= link.geometryLength) return [...link.points[link.points.length - 1]];
  let i = 1;
  while (i < link.measures.length && link.measures[i] < measure) i++;
  const startM = link.measures[i - 1], endM = link.measures[i];
  const fraction = endM === startM ? 0 : (measure - startM) / (endM - startM);
  return [
    link.points[i - 1][0] + fraction * (link.points[i][0] - link.points[i - 1][0]),
    link.points[i - 1][1] + fraction * (link.points[i][1] - link.points[i - 1][1])
  ];
}
function sectionPoints(link, fromM, toM) {
  const result = [pointAt(link, fromM)];
  for (let i = 1; i < link.measures.length - 1; i++) {
    if (link.measures[i] > fromM && link.measures[i] < toM) result.push([...link.points[i]]);
  }
  result.push(pointAt(link, toM));
  return result;
}
const linkFeatures = [];
for (const link of links) {
  const cuts = [...link.cuts].sort((a, b) => a.m - b.m);
  for (let i = 0; i < cuts.length - 1; i++) {
    const from = cuts[i], to = cuts[i + 1];
    if (!(to.m > from.m)) continue;
    const coordinates = sectionPoints(link, from.m, to.m).map(toLonLat);
    linkFeatures.push({
      type: "Feature",
      properties: {
        road_id: link.id,
        source_feature: link.sourceFeatureIndex,
        source_part: link.sourcePartIndex,
        segment_index: i,
        from_node: from.node,
        to_node: to.node,
        road_type: link.type,
        length_m: Number((to.m - from.m).toFixed(3)),
        access_car: link.access.car,
        access_suv: link.access.suv,
        access_pickup: link.access.pickup,
        access_minibus: link.access.minibus,
        access_bus: link.access.bus,
        access_truck: link.access.truck
      },
      geometry: { type: "LineString", coordinates }
    });
  }
}
const linksGeoJson = {
  type: "FeatureCollection",
  name: "routing_network_links",
  metadata: { generatedAt: output.generatedAt, sourceRoadsSha256: output.source.roadsSha256 },
  crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
  features: linkFeatures
};
fs.writeFileSync(LINKS_GEOJSON_OUTPUT, JSON.stringify(linksGeoJson));
console.log("Generated", OUTPUT, JSON.stringify(output.statistics));
console.log("Generated", NODES_GEOJSON_OUTPUT, nodesGeoJson.features.length, "nodes");
console.log("Generated", LINKS_GEOJSON_OUTPUT, linkFeatures.length, "routing edges");


const checkNodeFeatures = [...checkNodePairs.values()].map((pair, index) => {
  const midpoint = [
    (pair.a.point[0] + pair.b.point[0]) / 2,
    (pair.a.point[1] + pair.b.point[1]) / 2
  ];
  return {
    type: "Feature",
    properties: {
      check_id: "CHECK_" + String(index + 1).padStart(5, "0"),
      road_a: pair.a.linkId,
      node_a: pair.a.id,
      vertex_a: pair.a.vertexIndex,
      road_b: pair.b.linkId,
      node_b: pair.b.id,
      vertex_b: pair.b.vertexIndex,
      distance_m: Number(pair.distance.toFixed(3)),
      status: "manual_review"
    },
    geometry: { type: "Point", coordinates: toLonLat(midpoint) }
  };
});
const checkNodesGeoJson = {
  type: "FeatureCollection",
  name: "routing_network_check_nodes",
  crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
  features: checkNodeFeatures
};
fs.writeFileSync(CHECK_NODES_GEOJSON_OUTPUT, JSON.stringify(checkNodesGeoJson));
console.log("Generated", CHECK_NODES_GEOJSON_OUTPUT, checkNodeFeatures.length, "manual-review shape-point pairs");
console.log("Generated", CHECK_NODES_GEOJSON_OUTPUT, checkNodeFeatures.length, "manual-review shape-point pairs");

// Export connections whose distinct source shape points were snapped together
// using the configured 0.1 m topology tolerance. Distances below 0.001 m are
// excluded from this QA layer as requested; the routing network itself retains
// every valid connection at or below the configured tolerance.
const snapCheckFeatures = topologyConnections
  .filter(connection => connection.offset_m >= 0.001 && connection.offset_m <= SHAPE_POINT_CONNECT_TOLERANCE)
  .map((connection, index) => {
    const a = nodes.get(connection.node);
    const b = nodes.get(connection.connected_node);
    const midpoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return {
      type: "Feature",
      properties: {
        check_id: "SNAP_" + String(index + 1).padStart(5, "0"),
        road_id: connection.road_id,
        node_id: connection.node,
        connected_node_id: connection.connected_node,
        offset_m: connection.offset_m,
        tolerance_m: SHAPE_POINT_CONNECT_TOLERANCE,
        status: "snapped"
      },
      geometry: { type: "Point", coordinates: toLonLat(midpoint) }
    };
  });
const snapCheckGeoJson = {
  type: "FeatureCollection",
  name: "snap_check",
  metadata: {
    description: "Routing-network shape-point connections snapped within 0.001 m to 0.1 m inclusive.",
    status: "generated_from_routing_network_build",
    coordinate_reference_system: "OGC:CRS84 (WGS 84 longitude, latitude)",
    source: "data/roads.geojson",
    algorithm: "Uses the actual cross-link topology connections created by the routing-network builder. Includes connections with offset_m >= 0.001 and <= 0.1.",
    min_distance_m: 0.001,
    max_distance_m: SHAPE_POINT_CONNECT_TOLERANCE,
    snapped_connection_count: snapCheckFeatures.length
  },
  crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
  features: snapCheckFeatures
};
fs.writeFileSync(path.join(ROOT, "data/snap_check.geojson"), JSON.stringify(snapCheckGeoJson));
console.log("Generated data/snap_check.geojson", snapCheckFeatures.length, "snapped connections in requested distance range");


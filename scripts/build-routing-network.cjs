"use strict";

const fs = require("node:fs");
const path = require("node:path");
const proj4 = require("proj4");

const ROOT = path.resolve(__dirname, "..");
const INPUT_ROADS = path.join(ROOT, "data/roads.geojson");
const INPUT_JUNCTIONS = path.join(ROOT, "data/junctions.geojson");
const OUTPUT = path.join(ROOT, "data/routing-network.json");
const NODES_GEOJSON_OUTPUT = path.join(ROOT, "data/routing-network-nodes.geojson");
const LINKS_GEOJSON_OUTPUT = path.join(ROOT, "data/routing-network-links.geojson");
const UTM = "+proj=utm +zone=38 +datum=WGS84 +units=m +no_defs";
const toLonLat = coordinates => proj4(UTM, "EPSG:4326", coordinates);
const ENDPOINT_TOLERANCE = 0.01;
const AUTO_NODE_MERGE_TOLERANCE = 0.01;
const JUNCTION_TO_LINK_TOLERANCE = 1.0;
const GENERATED_NODE_TO_LINK_TOLERANCE = 0.05;
const ROAD_CUT_TOLERANCE = 0.01;
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

const junctionData = readJson(INPUT_JUNCTIONS);
const roadsData = readJson(INPUT_ROADS);
const nodes = new Map();
const junctionNodes = new Map();
const generatedEndpointIds = new Set();

for (const feature of features(junctionData)) {
  const id = nameOf(feature.properties, "junction");
  if (junctionNodes.has(id)) throw new Error("Duplicate junction: " + id);
  const point = xy(pointOf(feature, "Junction " + id));
  nodes.set(id, point);
  junctionNodes.set(id, point);
}

function nearestJunction(point) {
  let first = null, second = null;
  for (const [id, junctionPoint] of junctionNodes) {
    if (generatedEndpointIds.has(id)) continue;
    const candidate = { id, distance: dist(point, junctionPoint) };
    if (!first || candidate.distance < first.distance) {
      second = first; first = candidate;
    } else if (!second || candidate.distance < second.distance) second = candidate;
  }
  if (first && first.distance <= ENDPOINT_TOLERANCE) {
    return {
      ...first,
      ambiguous: second !== null &&
        second.distance <= ENDPOINT_TOLERANCE &&
        Math.abs(second.distance - first.distance) <= ENDPOINT_TOLERANCE,
      generated: false
    };
  }
  let shared = null;
  for (const id of generatedEndpointIds) {
    const offset = dist(point, junctionNodes.get(id));
    if (offset <= AUTO_NODE_MERGE_TOLERANCE && (!shared || offset < shared.distance)) {
      shared = { id, distance: offset };
    }
  }
  if (shared) return { ...shared, ambiguous: false, generated: true };
  let number = generatedEndpointIds.size;
  let id = "__auto_endpoint_" + number;
  while (nodes.has(id) || junctionNodes.has(id)) {
    number += 1; id = "__auto_endpoint_" + number;
  }
  const endpoint = [...point];
  nodes.set(id, endpoint);
  junctionNodes.set(id, endpoint);
  generatedEndpointIds.add(id);
  return { id, distance: 0, ambiguous: false, generated: true };
}

const links = [];
const linkIds = new Set();
let skippedParts = 0;
const roadFeatures = features(roadsData);

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
    const start = nearestJunction(points[0]);
    const end = nearestJunction(points[points.length - 1]);
    if (start.ambiguous || end.ambiguous) throw new Error(id + ": ambiguous endpoint junction.");
    if (start.id === end.id && dist(points[0], points[points.length - 1]) > 0.01) {
      throw new Error(id + ": distinct endpoints collapse to the same node.");
    }
    points[0] = [...junctionNodes.get(start.id)];
    points[points.length - 1] = [...junctionNodes.get(end.id)];
    const measures = [0];
    for (let i = 1; i < points.length; i++) measures.push(measures[i - 1] + dist(points[i - 1], points[i]));
    const geometryLength = measures[measures.length - 1];
    const type = field(properties, "type");
    const access = Object.fromEntries(VEHICLES.map(vehicle => [
      vehicle,
      SUPPORTED_TYPES.has(type) && field(properties, vehicle) === "yes" ? "yes" : "no"
    ]));
    links.push({
      id,
      sourceFeatureIndex: featureIndex,
      sourcePartIndex: part.sourcePartIndex,
      startNode: start.id,
      endNode: end.id,
      points,
      measures,
      geometryLength,
      type,
      access,
      cuts: [{ m: 0, node: start.id }, { m: geometryLength, node: end.id }]
    });
  }
}

// Spatially index every link segment once, then calculate junction-to-link cuts
// against the complete vehicle-independent network.
const cellSize = 10;
const cellKey = (x, y) => Math.floor(x / cellSize) + ":" + Math.floor(y / cellSize);
const segmentGrid = new Map();
const addSegment = (x, y, segment) => {
  const key = cellKey(x, y);
  let bucket = segmentGrid.get(key);
  if (!bucket) segmentGrid.set(key, bucket = []);
  bucket.push(segment);
};
for (const link of links) {
  for (let i = 0; i < link.points.length - 1; i++) {
    const a = link.points[i], b = link.points[i + 1];
    const length = link.measures[i + 1] - link.measures[i];
    if (!length) continue;
    const segment = { link, a, b, startM: link.measures[i], length };
    const minX = Math.floor((Math.min(a[0], b[0]) - JUNCTION_TO_LINK_TOLERANCE) / cellSize);
    const maxX = Math.floor((Math.max(a[0], b[0]) + JUNCTION_TO_LINK_TOLERANCE) / cellSize);
    const minY = Math.floor((Math.min(a[1], b[1]) - JUNCTION_TO_LINK_TOLERANCE) / cellSize);
    const maxY = Math.floor((Math.max(a[1], b[1]) + JUNCTION_TO_LINK_TOLERANCE) / cellSize);
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) addSegment(x, y, segment);
  }
}
const matchesByLink = new Map();
const topologyConnections = [];
for (const [nodeId, point] of junctionNodes) {
  const bucket = segmentGrid.get(cellKey(point[0], point[1])) || [];
  const bestByLink = new Map();
  for (const segment of bucket) {
    const link = segment.link;
    if (nodeId === link.startNode || nodeId === link.endNode) continue;
    const dx = segment.b[0] - segment.a[0], dy = segment.b[1] - segment.a[1];
    const fraction = Math.max(0, Math.min(1,
      ((point[0] - segment.a[0]) * dx + (point[1] - segment.a[1]) * dy) /
      (segment.length * segment.length)
    ));
    const q = [segment.a[0] + fraction * dx, segment.a[1] + fraction * dy];
    const offset = dist(point, q);
    const match = { offset, m: segment.startM + fraction * segment.length };
    const previous = bestByLink.get(link.id);
    if (!previous || match.offset < previous.offset) bestByLink.set(link.id, match);
  }
  for (const [linkId, match] of bestByLink) {
    let matches = matchesByLink.get(linkId);
    if (!matches) matchesByLink.set(linkId, matches = new Map());
    matches.set(nodeId, match);
  }
}
for (const link of links) {
  const matches = matchesByLink.get(link.id) || new Map();
  for (const [nodeId, match] of matches) {
    const tolerance = generatedEndpointIds.has(nodeId)
      ? GENERATED_NODE_TO_LINK_TOLERANCE
      : JUNCTION_TO_LINK_TOLERANCE;
    if (!Number.isFinite(match.offset) || match.offset > tolerance) continue;
    const existing = link.cuts.find(cut => Math.abs(cut.m - match.m) <= ROAD_CUT_TOLERANCE);
    if (existing) {
      // Preserve the zero-distance connection when a junction is effectively
      // at a road endpoint but has a different node ID. Dropping this edge
      // disconnects the graph even though the geometries meet.
      if (existing.node !== nodeId) {
        topologyConnections.push({
          road_id: link.id,
          node: nodeId,
          connected_node: existing.node,
          offset_m: Number(match.offset.toFixed(3)),
          shared_position: true
        });
      }
      continue;
    }
    if (match.m <= ROAD_CUT_TOLERANCE ||
        link.geometryLength - match.m <= ROAD_CUT_TOLERANCE) continue;
    link.cuts.push({ m: match.m, node: nodeId });
    topologyConnections.push({
      road_id: link.id,
      node: nodeId,
      offset_m: Number(match.offset.toFixed(3))
    });
  }
  link.cuts.sort((a, b) => a.m - b.m);
}

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: {
    roadsSha256: require("node:crypto").createHash("sha256").update(fs.readFileSync(INPUT_ROADS)).digest("hex"),
    junctionsSha256: require("node:crypto").createHash("sha256").update(fs.readFileSync(INPUT_JUNCTIONS)).digest("hex")
  },
  vehicles: VEHICLES,
  nodes: [...junctionNodes].map(([id, point]) => ({ id, xy: point, generated: generatedEndpointIds.has(id) })),
  links: links.map(({ points, measures, geometryLength, ...link }) => link),
  connections: topologyConnections,
  statistics: {
    topologyConnections: topologyConnections.length,
    sharedPositionConnections: topologyConnections.filter(connection => connection.shared_position).length,
    junctionNodes: junctionNodes.size,
    generatedEndpointNodes: generatedEndpointIds.size,
    links: links.length,
    linksByVehicle: Object.fromEntries(VEHICLES.map(vehicle => [
      vehicle, links.filter(link => link.access[vehicle] === "yes").length
    ])),
    skippedParts
  }
};
fs.writeFileSync(OUTPUT, JSON.stringify(output));

// Export a WGS84 point layer containing every junction and generated endpoint
// node, suitable for direct inspection in QGIS.
const nodesGeoJson = {
  type: "FeatureCollection",
  name: "routing_network_nodes",
  crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
  features: output.nodes.map(node => ({
    type: "Feature",
    properties: {
      node_id: node.id,
      node_kind: node.generated ? "generated_endpoint" : "junction",
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
  crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
  features: linkFeatures
};
fs.writeFileSync(LINKS_GEOJSON_OUTPUT, JSON.stringify(linksGeoJson));
console.log("Generated", OUTPUT, JSON.stringify(output.statistics));
console.log("Generated", NODES_GEOJSON_OUTPUT, nodesGeoJson.features.length, "nodes");
console.log("Generated", LINKS_GEOJSON_OUTPUT, linkFeatures.length, "routing edges");

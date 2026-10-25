"use strict";

function themeColor(property) {
  return getComputedStyle(document.documentElement).getPropertyValue(property).trim();
}
function themeNumber(property) {
  return Number(themeColor(property));
}

/*
 * LAAR NAVIGATION
 *
 * Required scripts:
 *   Leaflet, Proj4, app.js, live-location.js, backgrounds.js
 *
 * Required GeoJSON:
 *   roads, junctions, gates, destinations, destination_areas
 *
 * Naming:
 *   Reads Name first, then name.
 *   Destination/polygon matching remains exact.
 *
 * Duplicate destinations:
 *   First centroid retained.
 *
 * Metadata:
 *   meta.json is optional.
 *   network_reviewed_at is displayed without inventing a date.
 */


/* SETTINGS */

const MAX_SNAP = 200;
const MAX_GATE_CONNECTOR_DISTANCE = 10;

const ROADS_FILE = "data/roads.geojson";
const ENDPOINT_SNAP_DISTANCE = 10;
const INITIAL_SCALE_BAR_METRES = 800;
const SCALE_BAR_MAX_WIDTH = 100;
let vehicleMode = "truck";
let networkInputs = null;
let displayedRoadLayer = null;

function setMapClickHitAreaEnabled(enabled) {
  if (!map) return;
  map.getContainer().classList.toggle("map-click-selectable", Boolean(enabled));
  setMapClickHoverCursor(null);
}

function setMapClickHoverCursor(_latlng) {
  if (!map) return;
  const container = map.getContainer();
  // Map-click mode accepts clicks anywhere; snapping and route eligibility
  // are resolved after the click rather than by the cursor hit-test.
  const cursor = $("startMode")?.value === "map" ? "crosshair" : "";
  container.style.cursor = cursor;
  container.querySelectorAll(".leaflet-pane canvas, .leaflet-pane path.leaflet-interactive")
    .forEach(element => { element.style.cursor = cursor; });
}

function roadField(properties, field) {
  const key = Object.keys(properties || {}).find(k => k.toLowerCase() === field);
  return key === undefined ? "" : String(properties[key] ?? "").trim().toLowerCase();
}

function isRoundaboutLink(properties) {
  const name = roadField(properties, "name");
  return /\broundabout\b/i.test(name) || /\br[\s_-]*\d+\b/i.test(name);
}

function roadAccess(properties, vehicle = vehicleMode) {
  const type = roadField(properties, "type");
  const car = roadField(properties, "car");
  const truck = roadField(properties, "truck");
  const supportedTypes = ["major", "minor", "local", "public", "haul", "main"];
  if (!supportedTypes.includes(type)) return false;
  if (vehicle === "truck") return truck === "yes";
  // The road data currently provides truck/car access flags, not separate
  // flags for bus, mini bus, pick-up or SUV. Use car access for those classes.
  if (["bus", "minibus", "pickup", "suv", "car"].includes(vehicle)) {
    if (type === "haul") return false;
    return car ? car === "yes" : ["minor", "local", "public", "main"].includes(type);
  }
  return false;
}

function roadStyle(feature) {
  const type = roadField(feature?.properties || {}, "type");
  const palette = {
    major: { color: "--map-major-road", outline: "--map-major-road-outline", width: "--map-road-width", casing: 6 },
    main: { color: "--map-major-road", outline: "--map-major-road-outline", width: "--map-road-width", casing: 6 },
    minor: { color: "--map-public-road", outline: "--map-road-outline", width: "--map-road-width", casing: 5.5 },
    local: { color: "--map-public-road", outline: "--map-road-outline", width: "--map-road-width", casing: 5.5 },
    public: { color: "--map-public-road", outline: "--map-road-outline", width: "--map-road-width", casing: 5.5 },
    haul: { color: "--map-haul-road", outline: "--map-road-outline", width: "--map-road-width", casing: 5.5 }
  };
  const style = palette[type];
  return {
    color: themeColor(style?.color || "--map-unknown-road"),
    weight: themeNumber(style?.width || "--map-road-width") || 4,
    opacity: 1,
    dashArray: null,
    lineCap: "round",
    lineJoin: "round"
  };
}

function roadCasingStyle(feature) {
  const type = roadField(feature?.properties || {}, "type");
  const palette = {
    major: { color: "--map-major-road-outline", casing: 6 },
    main: { color: "--map-major-road-outline", casing: 6 },
    minor: { color: "--map-road-outline", casing: 5.5 },
    local: { color: "--map-road-outline", casing: 5.5 },
    public: { color: "--map-road-outline", casing: 5.5 },
    haul: { color: "--map-road-outline", casing: 5.5 }
  };
  const style = palette[type];
  return {
    color: themeColor(style?.color || "--map-road-outline"),
    weight: style?.casing || 5.5,
    opacity: 1,
    lineCap: "round",
    lineJoin: "round"
  };
}

function bindRoadPopup(feature, layer) {
  layer.bindPopup(() => {
    const p = feature.properties || {};
    const box = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = p.Name || p.name || p.road_id || "Road";
    const details = document.createElement("div");
    details.style.whiteSpace = "pre-line";
    details.textContent = "Type: " + (roadField(p, "type") || "missing") +
      "\nTruck: " + (roadField(p, "truck") || "missing") +
      "\nVehicle: " + vehicleMode +
      "\nAccess: " + (roadAccess(p) ? "permitted by road attributes" : "not permitted") +
      (isRoundaboutLink(p) ? "\nRoundabout: first-to-last coordinate direction" : "");
    box.append(title, details);
    return box;
  });

  // Replace Leaflet's automatic popup click handler so map-origin mode can
  // consume road clicks without opening a popup. In other modes, retain it.
  layer.off("click", layer._openPopup, layer);
  layer.on("click", event => {
    if ($("startMode")?.value === "map") {
      // Let the map-level click handler process the click exactly once.
      // Stopping propagation here can prevent origin selection on some renderers.
      map.closePopup();
      return;
    }
    layer.openPopup(event.latlng);
  });
}

function reportAccessData(data) {
  const roadFeatures = features(data, ROADS_FILE);
  const invalid = roadFeatures.filter(feature => {
    const p = feature.properties || {};
    const type = roadField(p, "type");
    const car = roadField(p, "car");
    const truck = roadField(p, "truck");
    return !["major", "minor", "local", "public", "haul", "main"].includes(type) ||
      !["yes", "no"].includes(truck) ||
      (car !== "" && !["yes", "no"].includes(car));
  });
  const invalidGeometry = roadFeatures.filter(feature => {
    const geometry = feature.geometry;
    const parts = geometry?.type === "LineString" ? [geometry.coordinates] :
      geometry?.type === "MultiLineString" ? geometry.coordinates : [];
    return !parts.some(part => Array.isArray(part) && part.length >= 2);
  });
  if (invalid.length) console.warn("Roads with unsupported type/access fields", invalid.map(f => f.properties));
  if (invalidGeometry.length) console.warn("Roads skipped because they have no usable line geometry:", invalidGeometry.length);
  return invalid.length + invalidGeometry.length;
}

function refreshVehicleRoads() {
  if (!displayedRoadLayer) return;
  displayedRoadLayer.setStyle(roadStyle);
  displayedRoadLayer.eachLayer(layer => { if (layer.isPopupOpen()) layer.closePopup(); });
}

function changeVehicle() {
  clearRoute();
  if ($("startMode")?.value === "map" && typeof removeMapClickOrigin === "function") {
    removeMapClickOrigin();
    locationStatus("Vehicle changed. Click the map again within 10 m of a permitted road.");
  }
  vehicleMode = $("vehicleType").value;
  const previousName = selectedDestination()?.name;
  try {
    const { j, r, g, d, metadata } = networkInputs;
    build(j, r, g, d, metadata);
    destinationOptions = locations.flatMap((location, index) => location.kind === "destination" ? [{
      index, name: location.name, type: location.type, valid: location.valid,
      hasPolygon: destinationAreas.has(location.name)
    }] : []);
    $("end").value = "";
    renderDestinationOptions();
    if (previousName) {
      const selected = destinationOptions.find(item => item.name === previousName);
      if (selected) {
        $("destinationSearch").value = "";
        renderDestinationOptions();
        // Keep the previous destination only if it survived the active
        // vehicle's reachability filter in the rendered selector.
        const remainsSelectable = Array.from($("end").options).some(option =>
          option.value === String(selected.index)
        );
        if (remainsSelectable) $("end").value = String(selected.index);
        else $("end").value = "";
      }
    }
    updateGateHighlights();
    $("start").selectedIndex = -1;
    refreshVehicleRoads();
    refreshShareControls();
    if (selectedDestination()) calculate();
    else status(vehicleMode + ": " + roads.length + " eligible roads. Select a destination.");
  } catch (error) {
    roads = [];
    adjacency = new Map();
    locations.forEach(location => { location.valid = false; });
    refreshVehicleRoads();
    status("Vehicle network error: " + error.message);
    console.error(error);
  }
}

/* Endpoint-first origin/destination attachment; coordinates are projected metres. */
function snapToNetwork(point, eligibleRoads = roads) {
  let endpointMatch = null;
  for (const road of eligibleRoads) {
    const endpoints = [
      { q: road.pts[0], m: 0, node: road.startNode },
      { q: road.pts[road.pts.length - 1], m: road.ms[road.ms.length - 1], node: road.endNode }
    ];
    for (const endpoint of endpoints) {
      const offset = dist(point, endpoint.q);
      if (offset <= ENDPOINT_SNAP_DISTANCE && (!endpointMatch || offset < endpointMatch.offset)) {
        endpointMatch = { road, ...endpoint, offset, snapType: "endpoint" };
      }
    }
  }
  if (endpointMatch) return endpointMatch;
  let roadMatch = null;
  for (const road of eligibleRoads) {
    const candidate = nearest(point, road.pts);
    if (!Number.isFinite(candidate.offset)) continue;
    if (!roadMatch || candidate.offset < roadMatch.offset) {
      roadMatch = { road, q: candidate.q, m: candidate.m, node: null,
        offset: candidate.offset, snapType: "road" };
    }
  }
  return roadMatch;
}


const ENDPOINT_TOLERANCE = 0.01;
const AUTO_NODE_MERGE_TOLERANCE = 0.01;
const JUNCTION_TO_LINK_TOLERANCE = 1.0;
const GENERATED_NODE_TO_LINK_TOLERANCE = 0.05;
const ROAD_CUT_TOLERANCE = 0.01;
const JUNCTION_AMBIGUITY_TOLERANCE = 0.01;

const UTM =
  "+proj=utm +zone=38 +datum=WGS84 +units=m +no_defs";


/* SHARED GLOBALS */

const $ = id => document.getElementById(id);

const status = text => {
  if ($("status")) $("status").textContent = text;
};

let map;
let siteBounds;

let routeLayer = null;
let routeOutlineLayer = null;
let startConnectorLayer = null;
let routeDebugLayer = null;
let routeDebugRoadIds = new Set();

function clearRouteDebugHighlight() {
  if (routeDebugLayer && map) map.removeLayer(routeDebugLayer);
  routeDebugLayer = null;
  routeDebugRoadIds = new Set();
}

function highlightRouteSearchLinks() {
  if (!map || !routeDebugRoadIds.size) return 0;
  const layers = [];
  for (const road of roads) {
    if (!routeDebugRoadIds.has(road.id) ||
        !Array.isArray(road.pts) || road.pts.length < 2) continue;
    const line = L.polyline(road.pts.map(ll), {
      color: "#ff2d55",
      weight: 7,
      opacity: 0.95,
      lineCap: "round",
      lineJoin: "round",
      pane: "routePane",
      interactive: true
    });
    line.bindTooltip("Route search examined: " + (road.name || road.id));
    layers.push(line);
  }
  if (!layers.length) return 0;
  routeDebugLayer = L.layerGroup(layers).addTo(map);
  return layers.length;
}

function clearRouteFailureBanner() {
  const existing = document.getElementById("routeFailureBanner");
  if (existing) existing.remove();
}

function showRouteFailureBanner(message) {
  clearRouteFailureBanner();
  const container = document.getElementById("map");
  if (!container) return;
  if (getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }

  const banner = document.createElement("div");
  banner.id = "routeFailureBanner";
  banner.setAttribute("role", "alert");
  banner.style.cssText = [
    "position:absolute",
    "top:12px",
    "left:50%",
    "transform:translateX(-50%)",
    "z-index:2000",
    "display:flex",
    "align-items:center",
    "gap:8px",
    "width:fit-content",
    "max-width:calc(100% - 24px)",
    "box-sizing:border-box",
    "padding:12px 14px",
    "border:1px solid #b3261e",
    "border-radius:8px",
    "background:#fce8e6",
    "color:#7f1d1d",
    "box-shadow:0 3px 12px rgba(0,0,0,.22)",
    "font:600 13px/1.35 system-ui,sans-serif",
    "pointer-events:auto"
  ].join(";");

  const text = document.createElement("span");
  text.textContent = message;
  text.style.cssText = "min-width:0;text-align:center;overflow-wrap:anywhere";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Dismiss route error");
  close.title = "Dismiss";
  close.style.cssText = [
    "flex:0 0 auto",
    "margin:-5px -5px 0 0",
    "padding:0 3px",
    "border:0",
    "background:transparent",
    "color:inherit",
    "font:700 24px/1 system-ui,sans-serif",
    "cursor:pointer"
  ].join(";");
  close.addEventListener("click", () => banner.remove());
  banner.append(text, close);
  container.appendChild(banner);
}

let selectedAreaLayer = null;

let locations = [];
let roads = [];
let allRoadCandidates = [];

let nodes = new Map();
let junctionNodes = new Map();
let adjacency = new Map();

let generatedEndpointIds = new Set();

let roadConnections = [];
let interiorConnections = [];

let destinationAreas = new Map();
let ignoredDestinationNames = [];

let destinationOptions = [];
let gateMarkers = new Map();
let gateMarkerLayer = null;

let costMode = "distance";
const routeEstimateSpeedKmh = 30;


/* DATA LOADING */

async function read(filename, optional = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(filename, {
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      if (optional && response.status === 404) {
        return {};
      }

      throw new Error(
        "Cannot load " + filename + ": HTTP " + response.status
      );
    }

    const text = await response.text();

    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(
        filename + " is not valid JSON: " + error.message
      );
    }

  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        "Loading " + filename + " exceeded 60 seconds."
      );
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
}


function features(data, filename) {
  if (
    !data ||
    data.type !== "FeatureCollection" ||
    !Array.isArray(data.features)
  ) {
    throw new Error(
      filename + " must contain a GeoJSON FeatureCollection."
    );
  }

  return data.features;
}


function nameOf(properties, label) {
  const value = properties?.Name ?? properties?.name;

  if (
    value === undefined ||
    value === null ||
    String(value).trim() === ""
  ) {
    throw new Error(
      label + " is missing Name/name. Available fields: " +
      (Object.keys(properties || {}).join(", ") || "none")
    );
  }

  return String(value);
}


/* COORDINATES */

function validatePosition(coordinates, label) {
  if (
    !Array.isArray(coordinates) ||
    coordinates.length < 2 ||
    !Number.isFinite(coordinates[0]) ||
    !Number.isFinite(coordinates[1])
  ) {
    throw new Error(label + " has invalid coordinates.");
  }

  if (
    Math.abs(coordinates[0]) > 180 ||
    Math.abs(coordinates[1]) > 90
  ) {
    throw new Error(
      label + " must use EPSG:4326 longitude/latitude."
    );
  }

  return [coordinates[0], coordinates[1]];
}


function pointOf(feature, label) {
  const geometry = feature.geometry;

  if (geometry?.type === "Point") {
    return validatePosition(geometry.coordinates, label);
  }

  if (
    geometry?.type === "MultiPoint" &&
    geometry.coordinates?.length === 1
  ) {
    return validatePosition(geometry.coordinates[0], label);
  }

  throw new Error(
    label + " must be a Point or single-point MultiPoint."
  );
}


function xy(coordinates) {
  const point = proj4("EPSG:4326", UTM, coordinates);

  if (!point.every(Number.isFinite)) {
    throw new Error("Unable to transform coordinates.");
  }

  return point;
}


function ll(point) {
  const coordinates = proj4(UTM, "EPSG:4326", point);
  return [coordinates[1], coordinates[0]];
}

/* Length-weighted centre of the haul-road network only. */
function roadNetworkCenter() {
  let weightedX = 0;
  let weightedY = 0;
  let totalLength = 0;

  for (const road of allRoadCandidates) {
    if (roadField(road.properties || {}, "type") !== "haul") continue;

    for (let i = 0; i < road.pts.length - 1; i++) {
      const a = road.pts[i];
      const b = road.pts[i + 1];
      const length = dist(a, b);
      if (!Number.isFinite(length) || length <= 0) continue;

      weightedX += ((a[0] + b[0]) / 2) * length;
      weightedY += ((a[1] + b[1]) / 2) * length;
      totalLength += length;
    }
  }

  if (!totalLength) return siteBounds.getCenter();
  return L.latLng(ll([weightedX / totalLength, weightedY / totalLength]));
}


function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}


/* POLYGON LOOKUP */

function loadDestinationAreas(data) {
  destinationAreas = new Map();

  for (
    const feature of features(data, "data/destination_areas.geojson")
  ) {
    const name = nameOf(feature.properties, "LAAR polygon");
    const geometry = feature.geometry;

    if (
      !geometry ||
      !["Polygon", "MultiPolygon"].includes(geometry.type)
    ) {
      throw new Error(
        "LAAR " + name + " must be Polygon or MultiPolygon."
      );
    }

    const polygons = geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.coordinates;

    if (!Array.isArray(polygons) || !polygons.length) {
      throw new Error("LAAR " + name + " has empty geometry.");
    }

    for (const polygon of polygons) {
      if (!Array.isArray(polygon) || !polygon.length) {
        throw new Error("LAAR " + name + " has no rings.");
      }

      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 4) {
          throw new Error("Invalid polygon ring: " + name);
        }

        ring.forEach(coordinate => {
          validatePosition(coordinate, "LAAR " + name);
        });

        const first = ring[0];
        const last = ring[ring.length - 1];

        if (first[0] !== last[0] || first[1] !== last[1]) {
          throw new Error("Unclosed polygon ring: " + name);
        }
      }
    }

    if (!destinationAreas.has(name)) {
      destinationAreas.set(name, []);
    }

    destinationAreas.get(name).push(feature);
  }
}


function nearest(point, points) {
  let best = { offset: Infinity };
  let walked = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const length = dist(a, b);

    if (!length) continue;

    const fraction = Math.max(
      0,
      Math.min(
        1,
        (
          (point[0] - a[0]) * (b[0] - a[0]) +
          (point[1] - a[1]) * (b[1] - a[1])
        ) / (length * length)
      )
    );

    const q = [
      a[0] + fraction * (b[0] - a[0]),
      a[1] + fraction * (b[1] - a[1])
    ];

    const offset = dist(point, q);

    if (offset < best.offset) {
      best = {
        offset,
        m: walked + fraction * length,
        q
      };
    }

    walked += length;
  }

  return best;
}


function at(road, position) {
  for (let i = 0; i < road.pts.length - 1; i++) {
    if (position <= road.ms[i + 1]) {
      const span = road.ms[i + 1] - road.ms[i];
      const fraction = span
        ? (position - road.ms[i]) / span
        : 0;

      const a = road.pts[i];
      const b = road.pts[i + 1];

      return [
        a[0] + fraction * (b[0] - a[0]),
        a[1] + fraction * (b[1] - a[1])
      ];
    }
  }

  return road.pts[road.pts.length - 1];
}


function section(road, startPosition, endPosition) {
  return [
    at(road, startPosition),

    ...road.pts.filter((point, i) => {
      return (
        road.ms[i] > startPosition &&
        road.ms[i] < endPosition
      );
    }),

    at(road, endPosition)
  ];
}


/* ROAD ENDPOINTS */

function nearestJunction(point) {
  let first = null;
  let second = null;

  for (const [id, junctionPoint] of junctionNodes) {
    if (generatedEndpointIds.has(id)) continue;

    const candidate = {
      id,
      distance: dist(point, junctionPoint)
    };

    if (!first || candidate.distance < first.distance) {
      second = first;
      first = candidate;
    } else if (!second || candidate.distance < second.distance) {
      second = candidate;
    }
  }

  if (first && first.distance <= ENDPOINT_TOLERANCE) {
    return {
      ...first,

      ambiguous:
        second !== null &&
        second.distance <= ENDPOINT_TOLERANCE &&
        Math.abs(second.distance - first.distance) <=
          JUNCTION_AMBIGUITY_TOLERANCE,

      generated: false
    };
  }

  let shared = null;

  for (const id of generatedEndpointIds) {
    const offset = dist(point, junctionNodes.get(id));

    if (
      offset <= AUTO_NODE_MERGE_TOLERANCE &&
      (!shared || offset < shared.distance)
    ) {
      shared = { id, distance: offset };
    }
  }

  if (shared) {
    return {
      ...shared,
      ambiguous: false,
      generated: true
    };
  }

  let number = generatedEndpointIds.size;
  let id = "__auto_endpoint_" + number;

  while (nodes.has(id) || junctionNodes.has(id)) {
    number += 1;
    id = "__auto_endpoint_" + number;
  }

  const endpoint = [...point];

  nodes.set(id, endpoint);
  junctionNodes.set(id, endpoint);
  generatedEndpointIds.add(id);

  return {
    id,
    distance: 0,
    ambiguous: false,
    generated: true
  };
}


function connectJunctionsToRoadLinks() {
  const connections = [];

  for (const road of roads) {
    const roadLength = road.ms[road.ms.length - 1];

    for (const [nodeId, point] of junctionNodes) {
      if (
        nodeId === road.startNode ||
        nodeId === road.endNode
      ) continue;

      const match = nearest(point, road.pts);
      const generated = generatedEndpointIds.has(nodeId);

      const tolerance = generated
        ? GENERATED_NODE_TO_LINK_TOLERANCE
        : JUNCTION_TO_LINK_TOLERANCE;

      if (
        !Number.isFinite(match.offset) ||
        match.offset > tolerance
      ) continue;

      const existing = road.cuts.find(cut => {
        return Math.abs(cut.m - match.m) <= ROAD_CUT_TOLERANCE;
      });

      if (existing) {
        if (existing.node !== nodeId) {
          connections.push({
            road_id: road.id, node: nodeId, connected_node: existing.node,
            offset_m: Number(match.offset.toFixed(3)), shared_position: true
          });
        }
        continue;
      }

      if (
        match.m <= ROAD_CUT_TOLERANCE ||
        roadLength - match.m <= ROAD_CUT_TOLERANCE
      ) continue;

      road.cuts.push({ m: match.m, node: nodeId });

      connections.push({
        road_id: road.id,
        node: nodeId,
        offset_m: Number(match.offset.toFixed(3))
      });
    }

    road.cuts.sort((a, b) => a.m - b.m);
  }

  console.table(connections);
  return connections;
}


/* BUILD BASE GRAPH */

function build(
  junctionData,
  roadData,
  gateData,
  destinationData,
  metadata
) {
  nodes = new Map();
  junctionNodes = new Map();
  adjacency = new Map();
  generatedEndpointIds = new Set();

  roads = [];
  allRoadCandidates = [];
  locations = [];
  roadConnections = [];
  interiorConnections = [];
  ignoredDestinationNames = [];

  // Use each road's GeoJSON speed (km/h). The fallback is only for older
  // road features that do not provide a valid positive speed.

  status("Building network: junctions and roads…");

  for (
    const feature of features(junctionData, "data/junctions.geojson")
  ) {
    const id = nameOf(feature.properties, "Junction");

    if (junctionNodes.has(id)) {
      throw new Error("Duplicate junction: " + id);
    }

    const point = xy(pointOf(feature, "Junction " + id));

    nodes.set(id, point);
    junctionNodes.set(id, point);
  }

  const roadIds = new Set();
  const endpointErrors = [];
  let skippedRoadParts = 0;
  const roadFeatures = features(roadData, "data/roads.geojson");

  for (let featureIndex = 0; featureIndex < roadFeatures.length; featureIndex++) {
    const feature = roadFeatures[featureIndex];
    const p = feature.properties || {};
    const geometry = feature.geometry;
    const rawId = p.road_id ?? p.id;
    const baseId = rawId !== undefined && rawId !== null && String(rawId).trim() !== ""
      ? String(rawId).trim()
      : "R_" + String(featureIndex + 1).padStart(4, "0");

    let coordinateParts;
    if (geometry?.type === "LineString") coordinateParts = [geometry.coordinates];
    else if (geometry?.type === "MultiLineString") {
      coordinateParts = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
    } else {
      skippedRoadParts++;
      continue;
    }

    const usableParts = coordinateParts
      .filter(part => Array.isArray(part) && part.length >= 2)
      .map(part => ({
        points: part.map(coordinate => xy(validatePosition(coordinate, "Road " + baseId)))
      }))
      .map(part => {
        let geometryLength = 0;
        for (let i = 1; i < part.points.length; i++) {
          geometryLength += dist(part.points[i - 1], part.points[i]);
        }
        return { ...part, geometryLength };
      })
      .filter(part => Number.isFinite(part.geometryLength) && part.geometryLength > 0);

    if (!usableParts.length) {
      skippedRoadParts++;
      continue;
    }
    const totalGeometryLength = usableParts.reduce((sum, part) => sum + part.geometryLength, 0);

    for (let partIndex = 0; partIndex < usableParts.length; partIndex++) {
      const part = usableParts[partIndex];
      const id = usableParts.length > 1 ? baseId + "_P" + (partIndex + 1) : baseId;
      if (roadIds.has(id)) throw new Error("Duplicate road: " + id);
      roadIds.add(id);

      const points = part.points;
      allRoadCandidates.push({ id, properties: p, pts: points });
      if (!roadAccess(p)) continue;

      const separation = dist(points[0], points[points.length - 1]);
      const start = nearestJunction(points[0]);
      const end = nearestJunction(points[points.length - 1]);
      if (start.ambiguous || end.ambiguous) {
        endpointErrors.push(id + ": ambiguous endpoint.");
        continue;
      }
      if (start.id === end.id && separation > 0.01) {
        endpointErrors.push(id + ": distinct endpoints collapse.");
        continue;
      }

      points[0] = junctionNodes.get(start.id);
      points[points.length - 1] = junctionNodes.get(end.id);
      const measures = [0];
      for (let i = 1; i < points.length; i++) {
        measures.push(measures[i - 1] + dist(points[i - 1], points[i]));
      }

      const geometryLength = measures[measures.length - 1];
      const sourceLength = Number(p.length);
      const length = Number.isFinite(sourceLength) && sourceLength > 0
        ? sourceLength * (part.geometryLength / totalGeometryLength)
        : geometryLength;
      const rawSpeed = Number(p.speed);
      const speedKmh = p.speed !== undefined && p.speed !== null &&
        String(p.speed).trim() !== "" && Number.isFinite(rawSpeed) && rawSpeed > 0
        ? rawSpeed
        : routeEstimateSpeedKmh;
      let direction = String(p.direction || "both").trim().toLowerCase();
      const roundabout = isRoundaboutLink(p);
      if (direction === "one") direction = "forward";
      if (["two-way", "twoway", "bidirectional"].includes(direction)) direction = "both";
      if (roundabout) direction = "forward";

      if (!Number.isFinite(length) || length <= 0 || geometryLength <= 0) {
        throw new Error("Invalid road length: " + id);
      }
      if (!["both", "forward", "reverse"].includes(direction)) {
        throw new Error("Invalid road direction: " + id + " (" + direction + ")");
      }

      roads.push({
        id, name: p.Name || p.name || id,
        startNode: start.id, endNode: end.id,
        pts: points, ms: measures, length, direction, roundabout,
        speedKmh, properties: p,
        type: roadField(p, "type"), truck: roadField(p, "truck"),
        cuts: [
          { m: 0, node: start.id },
          { m: geometryLength, node: end.id }
        ]
      });
      roadConnections.push({ road_id: id, start_node: start.id, end_node: end.id });
    }
  }

  if (skippedRoadParts) {
    console.warn("Skipped road features/parts with unsupported or empty geometry:", skippedRoadParts);
  }

  if (endpointErrors.length) {
    throw new Error(endpointErrors.slice(0, 5).join("\n"));
  }

  // Empty vehicle networks remain switchable but cannot produce routes.

  interiorConnections = connectJunctionsToRoadLinks();

  status("Building network: attaching destinations and gates…");

  const datasets = [
    ["gate", gateData, "data/gates.geojson"],
    ["destination", destinationData, "data/destinations.geojson"]
  ];

  for (const [kind, data, filename] of datasets) {
    const usedNames = new Set();

    for (const feature of features(data, filename)) {
      const name = nameOf(feature.properties, filename);
      const destinationType = kind === "destination"
        ? String(feature.properties?.type ?? "").trim()
        : "";

      if (kind === "destination" && !["WAN", "LAAR", "Office"].includes(destinationType)) {
        throw new Error(
          "Destination " + name + " has invalid type '" + destinationType +
          "'. Expected WAN, LAAR, or Office."
        );
      }

      if (usedNames.has(name)) {
        if (kind === "destination") {
          ignoredDestinationNames.push(name);
          console.warn("Ignoring duplicate destination:", name);
          continue;
        }

        throw new Error("Duplicate gate name: " + name);
      }

      usedNames.add(name);

      const point = xy(pointOf(feature, kind + " " + name));
      let match;
      // Identify the nearest mapped road across all road classes first.
      // Never bypass a closer haul/public road that this vehicle cannot use.
      let nearestMappedRoad = null;
      for (const candidate of allRoadCandidates) {
        const projection = nearest(point, candidate.pts);
        if (Number.isFinite(projection.offset) &&
            (!nearestMappedRoad || projection.offset < nearestMappedRoad.offset)) {
          nearestMappedRoad = { candidate, ...projection };
        }
      }
      const permittedRoad = nearestMappedRoad
        ? roads.find(candidate => candidate.id === nearestMappedRoad.candidate.id)
        : null;

      if (kind === "destination") {
        // Keep endpoint-first snapping, but only on the nearest mapped road
        // when that road belongs to this vehicle's permitted network.
        match = permittedRoad
          ? snapToNetwork(point, [permittedRoad])
          : null;
      } else {
        // Origins retain their coordinates and need a close, permitted
        // connection to the nearest mapped road.
        if (permittedRoad && nearestMappedRoad.offset <= MAX_GATE_CONNECTOR_DISTANCE) {
          const projection = nearest(point, permittedRoad.pts);
          match = { road: permittedRoad, ...projection, snapType: "origin-connector" };
        } else {
          match = null;
        }
      }
      const best = match || { offset: Infinity };
      const road = match?.road || null;

      if (!road || !Number.isFinite(best.offset)) {
        locations.push({
          name, kind, type: destinationType, point, node: null, offset: Infinity, valid: false,
          snapType: "unavailable",
          nearestRoadType: nearestMappedRoad
            ? roadField(nearestMappedRoad.candidate.properties, "type")
            : "",
          nearestRoadTruck: nearestMappedRoad
            ? roadField(nearestMappedRoad.candidate.properties, "truck")
            : "",
          nearestRoadOffset: nearestMappedRoad?.offset ?? Infinity,
          operatingHours: feature.properties?.operating_hours,
          permittedVehicleTypes: feature.properties?.permitted_vehicle_types
        });
        continue;
      }

      let cut = best.snapType === "endpoint"
        ? { m: best.m, node: best.node }
        : road.cuts.find(item => Math.abs(item.m - best.m) <= ROAD_CUT_TOLERANCE);

      if (!cut) {
        let id = "__location_" + locations.length;
        while (nodes.has(id)) id += "_";

        cut = { m: best.m, node: id };
        road.cuts.push(cut);
        nodes.set(id, best.q);
      }

      locations.push({
        name,
        kind,
        type: destinationType,
        point,
        node: cut.node,
        offset: best.offset,
        valid: kind === "gate"
          ? best.offset <= MAX_GATE_CONNECTOR_DISTANCE
          : best.offset <= MAX_SNAP,
        snapType: best.snapType,
        attachedRoadId: road.id,
        nearestRoadType: nearestMappedRoad
          ? roadField(nearestMappedRoad.candidate.properties, "type")
          : "",
        nearestRoadTruck: nearestMappedRoad
          ? roadField(nearestMappedRoad.candidate.properties, "truck")
          : "",
        nearestRoadOffset: nearestMappedRoad?.offset ?? Infinity,
        operatingHours: feature.properties?.operating_hours,
        permittedVehicleTypes: feature.properties?.permitted_vehicle_types
      });
    }
  }

  for (const id of nodes.keys()) adjacency.set(id, []);

  // Intentional shared-position IDs join without duplicating road distance.
  const roadLookup = new Map(roads.map(road => [road.id, road]));
  for (const connection of interiorConnections) {
    if (!connection.shared_position) continue;
    const a = connection.node;
    const b = connection.connected_node;
    const road = roadLookup.get(connection.road_id);
    if (!road || !adjacency.has(a) || !adjacency.has(b) || a === b) continue;
    for (const [from, to] of [[a, b], [b, a]]) {
      const edges = adjacency.get(from);
      if (edges.some(edge => edge.to === to && edge.topologyConnection)) continue;
      edges.push({ to, length: 0, seconds: 0, weight: 0, pts: [],
        name: road.name, roadId: road.id, topologyConnection: true });
    }
  }


  for (const road of roads) {
    road.cuts.sort((a, b) => a.m - b.m);

    for (let i = 0; i < road.cuts.length - 1; i++) {
      const a = road.cuts[i];
      const b = road.cuts[i + 1];

      if (b.m <= a.m) continue;

      const length =
        road.length * (b.m - a.m) /
        road.ms[road.ms.length - 1];

      const seconds = length / (road.speedKmh / 3.6);
      const points = section(road, a.m, b.m);

      if (road.direction !== "reverse") {
        adjacency.get(a.node).push({
          to: b.node,
          length,
          seconds,
          weight: length,
          pts: points,
          name: road.name,
          roadId: road.id
        });
      }

      if (road.direction !== "forward") {
        adjacency.get(b.node).push({
          to: a.node,
          length,
          seconds,
          weight: length,
          pts: [...points].reverse(),
          name: road.name,
          roadId: road.id
        });
      }
    }
  }
}


/* SECURITY GUARD GATE ICON */

/* Shared by map markers and the map legend. */
function gateSvg() {
  return `
    <svg class="security-guard-symbol" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
      <path class="security-guard-symbol__body" d="M3.5 41c.6-12.8 6.8-20 18.5-20s17.9 7.2 18.5 20z"/>
      <circle class="security-guard-symbol__head" cx="22" cy="14.5" r="6"/>
      <path class="security-guard-symbol__cap" d="M13.5 13a8.5 8.5 0 0 1 17 0v1.5h-17z"/>
      <path class="security-guard-symbol__badge" d="M22 25l3 3-3 3-3-3z"/>
    </svg>
  `;
}

function createGateIcon(selected = false) {
  return L.divIcon({
    className: "laar-gate-icon",

    html: `
      <div class="laar-gate-marker${selected ? " is-selected" : ""}">
        ${gateSvg()}
      </div>
    `,

    iconSize: [33, 33],
    iconAnchor: [16.5, 16.5],
    popupAnchor: [0, -16.5],
    tooltipAnchor: [0, -16.5]
  });
}

function createGatePopup(location, selected = false) {
  function el(tag, cls, text) {
    const e = document.createElement(tag); e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function row(label, value) {
    const r = el("div", "laar-gate-card__metric");
    const text = Array.isArray(value) ? value.join(", ") : String(value ?? "").trim();
    const v = el("span", "laar-gate-card__metric-value", text || "Not provided");
    Object.assign(v.style, {whiteSpace:"normal", overflowWrap:"anywhere", fontSize:"12px", textAlign:"right", maxWidth:"60%"});
    r.append(el("span", "laar-gate-card__metric-label", label), v);
    return r;
  }
  const card = el("div", "laar-gate-card");
  const header = el("div", "laar-gate-card__header");
  header.append(el("div", "laar-gate-card__eyebrow", selected ? "SELECTED STARTING GATE" : "SITE ACCESS"), el("h2", "laar-gate-card__title", location.name));
  const body = el("div", "laar-gate-card__body");
  body.append(row("Operating hours", location.operatingHours), row("Permitted vehicles", location.permittedVehicleTypes),
    el("p", "laar-gate-card__note", "Confirm current gate arrangements and access permission before travelling."));
  card.append(header, body);
  return card;
}


function updateGateHighlights(selectedIndex = null) {
  for (const [index, marker] of gateMarkers) {
    const selected = index === selectedIndex;

    marker.setIcon(createGateIcon(selected));
    marker.setZIndexOffset(selected ? 1000 : 0);
    marker.setPopupContent(
      createGatePopup(locations[index], selected)
    );
  }
}


/* MAP LEGEND */

function addMapLegend() {
  const legend = L.control({ position: "bottomright" });

  legend.onAdd = () => {
    const container = L.DomUtil.create("div", "map-legend");

    container.innerHTML = `
      <div class="map-legend__title">Map key</div>
      <div class="map-legend__row"><span class="map-key-major-road"><span></span></span><span>Main Road</span></div>
      <div class="map-legend__row"><span style="display:inline-block;width:30px;border-top:7px solid var(--map-public-road)"></span><span>Local Roads</span></div>
      <div class="map-legend__row"><span style="display:inline-block;width:30px;border-top:7px solid var(--map-haul-road)"></span><span>Haul road</span></div>
      <div class="map-legend__row">
        <span class="legend-gate">${gateSvg()}</span>
        <span>Site gate</span>
      </div>
      <div class="map-legend__row">
        <span class="legend-gate legend-gate--selected">${gateSvg()}</span>
        <span>Selected starting gate</span>
      </div>
      <div class="map-legend__row">
        <span class="legend-location"></span>
        <span>Live location</span>
      </div>
      <div class="map-legend__row">
        <span class="legend-area"></span>
        <span>Destination</span>
      </div>
      <div class="map-legend__row">
        <span class="legend-route"></span>
        <span>Road-network route</span>
      </div>
    `;

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    return container;
  };

  legend.addTo(map);
}


/* SEARCHABLE DESTINATION SELECTOR */

function searchKey(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}


function destinationCategory(item) {
  const type = String(item?.type || "").trim();
  return ["WAN", "LAAR", "Office"].includes(type) ? type : "Other";
}

function renderDestinationOptions() {
  const previous = $("end").value;
  const query = searchKey($("destinationSearch").value);
  const category = document.querySelector('input[name="destinationType"]:checked')?.value || "LAAR";
  const matching = destinationOptions.filter(item => destinationCategory(item) === category && searchKey(item.name).includes(query));
  const selected = destinationOptions.find(item => String(item.index) === previous && destinationCategory(item) === category);
  const visible = [...matching];
  const retained = selected && !visible.some(item => item.index === selected.index);
  if (retained) visible.push(selected);
  visible.sort((a, b) => {
    const left = searchKey(a.name);
    const right = searchKey(b.name);
    const rank = value => !query ? 0 : value === query ? 0 : value.startsWith(query) ? 1 : 2;
    return rank(left) - rank(right) || a.name.localeCompare(b.name, undefined, { numeric: true });
  });
  $("end").replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = matching.length ? "Select " + category + "…" : "No " + category + " matches";
  $("end").appendChild(placeholder);
  for (const item of visible) {
    const option = document.createElement("option");
    option.value = String(item.index);
    option.textContent = item.name + (!item.hasPolygon ? " — polygon missing" : "") + (!item.valid ? " — outside snap limit" : "");
    $("end").appendChild(option);
  }
  $("end").value = selected ? previous : "";
  $("searchStatus").textContent = matching.length + " matching " + category + " destination(s)" + (retained ? ". Current selection retained." : ".");
}


/* URL AND SHARING */

function updateDestinationUrl(destinationName = null) {
  try {
    const url = new URL(window.location.href);

    if (destinationName === null) {
      url.searchParams.delete("destination");
    } else {
      url.searchParams.set("destination", destinationName);
    }

    window.history.replaceState(
      window.history.state,
      "",
      url.href
    );

  } catch (error) {
    console.warn("Could not update destination URL:", error);
  }
}


function selectedDestination() {
  if ($("end").value === "") return null;

  const location = locations[Number($("end").value)];

  return location?.kind === "destination" ? location : null;
}


function refreshShareControls() {
  const destination = selectedDestination();

  $("copyLink").disabled = !destination;
  $("shareFallback").hidden = true;

  $("shareStatus").textContent = destination
    ? "Copy a link to " + destination.name + "."
    : "Select a destination to create a link.";
}


async function copyDestinationLink() {
  const destination = selectedDestination();
  if (!destination) return;

  const url = new URL(window.location.href);
  url.searchParams.set("destination", destination.name);

  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard access unavailable.");
    }

    await navigator.clipboard.writeText(url.href);

    $("shareFallback").hidden = true;
    $("shareStatus").textContent =
      "Link copied for " + destination.name + ".";

  } catch (error) {
    $("shareFallback").hidden = false;
    $("shareLink").value = url.href;
    $("shareLink").focus();
    $("shareLink").select();

    $("shareStatus").textContent =
      "Automatic copy was unavailable. " +
      "Copy the selected link below manually.";
  }
}


function loadDestinationFromUrl() {
  const requested = new URLSearchParams(
    window.location.search
  ).get("destination");

  if (requested === null) return;

  const index = locations.findIndex(location => {
    return (
      location.kind === "destination" &&
      location.name === requested
    );
  });

  if (index === -1) {
    status(
      "Shared destination not found: " + requested +
      "\nCheck its exact Name value or select a LAAR manually."
    );
    return;
  }

  $("destinationSearch").value = "";
  renderDestinationOptions();

  $("startMode").value = "gate";
  $("end").value = String(index);

  // The destination selector may be filtered to destinations reachable
  // from a valid gate for the active vehicle. Do not attempt to calculate
  // when the requested shared destination was excluded from that selector.
  if ($("end").value !== String(index)) {
    status(
      "Shared destination is not available for the current vehicle/start. " +
      "Select a reachable LAAR manually."
    );
    refreshShareControls();
    return;
  }

  refreshShareControls();
  clearRoute();
  $("start").selectedIndex = -1;
  status("Shared destination loaded. Press Show / update LAAR route to calculate it.");
}


/* ROUTE SUMMARY */

function calculate(collapseMobilePanelOnSuccess = false) {
  clearRoute();
  clearRouteDebugHighlight();
  clearRouteFailureBanner();
  $("start").selectedIndex = -1;

  const baseGraph = adjacency;

  try {
    if (!roads.length) throw new Error("No eligible roads for " + vehicleMode + ".");
    const destination = selectedDestination();

    if (!destination) {
      throw new Error("Select a LAAR destination.");
    }

    updateDestinationUrl(destination.name);
    refreshShareControls();

    showDestinationArea(destination);

    if (!destination.valid) {
      if (!Number.isFinite(destination.offset)) {
        if (destination.nearestRoadType) {
          const roadType = destination.nearestRoadType === "haul"
            ? "haul road" : destination.nearestRoadType === "public"
              ? "public road" : "mapped road";
          throw new Error(
            "Nearest road is a " + roadType + " not permitted for " +
            vehicleMode + "."
          );
        }
        throw new Error("No mapped road attachment for this LAAR.");
      }
      throw new Error(
        "LAAR is " + destination.offset.toFixed(0) +
        " m from its nearest permitted road; limit " + MAX_SNAP + " m."
      );
    }

    const liveMode = $("startMode").value === "live";
    const prepared = prepareRoutingStart();

    const allowedRoadIds = new Set(roads.map(road => road.id));
    adjacency = new Map([...prepared.graph].map(([id, edges]) => [
      id, edges.filter(edge => allowedRoadIds.has(edge.roadId))
    ]));

    const best = new Map();
    const previous = new Map();
    const source = new Map();
    const visited = new Set();

    for (const start of prepared.sources) {
      const id = start.location.node;

      if (!best.has(id)) {
        best.set(id, 0);
        source.set(id, start);
      }
    }

    const end = destination.node;

    while (true) {
      let current = null;
      let distance = Infinity;

      for (const [id, value] of best) {
        if (!visited.has(id) && value < distance) {
          current = id;
          distance = value;
        }
      }

      if (current === null || current === end) break;

      visited.add(current);

      for (const edge of adjacency.get(current) || []) {
        if (edge.roadId !== undefined && edge.roadId !== null) {
          routeDebugRoadIds.add(edge.roadId);
        }
        if (visited.has(edge.to)) continue;

        // Dijkstra minimizes travel time using the speed of each road link.
        const candidate = distance + edge.seconds;

        if (candidate < (best.get(edge.to) ?? Infinity)) {
          best.set(edge.to, candidate);

          previous.set(edge.to, {
            from: current,
            edge
          });

          source.set(edge.to, source.get(current));
        }
      }
    }

    if (!best.has(end)) {
      throw new Error(
        liveMode
          ? "No connected road route from your attached position."
          : $("startMode").value === "map"
            ? "No connected route from this map click to the selected LAAR. Try a nearby click or check the road network connections."
            : "No valid gate has a connected route to this LAAR."
      );
    }

    const start = source.get(end);
    if (!start) throw new Error("Starting point unavailable.");

    if (start.index !== null) {
      $("start").value = String(start.index);
      updateGateHighlights(start.index);
    }

    const edges = [];
    let id = end;

    while (id !== start.location.node) {
      const step = previous.get(id);
      if (!step) throw new Error("Cannot reconstruct route.");

      edges.push(step.edge);
      id = step.from;
    }

    edges.reverse();

    const networkMetres = edges.reduce(
      (sum, edge) => sum + edge.length, 0
    );
    const originOffset = Number(start.location.offset) || 0;
    const metres = networkMetres + originOffset;
    const seconds = edges.reduce(
      (sum, edge) => sum + edge.seconds, 0
    ) + originOffset / (routeEstimateSpeedKmh / 3.6);

    if (edges.length) {
      const points = [];

      // The solid route starts at the road attachment point. The off-road
      // gap from the selected origin is shown separately as a light dashed line.
      if (start.location.snapPoint) points.push(start.location.snapPoint);
      for (const edge of edges) {
        for (const point of edge.pts) {
          if (
            !points.length ||
            dist(points[points.length - 1], point) > 0.000001
          ) {
            points.push(point);
          }
        }
      }

      if (start.location.point && start.location.snapPoint &&
          dist(start.location.point, start.location.snapPoint) > 0.000001) {
        startConnectorLayer = L.polyline([
          ll(start.location.point),
          ll(start.location.snapPoint)
        ], {
          color: themeColor("--map-origin-connector"),
          weight: 3,
          opacity: 0.95,
          dashArray: "5 7",
          lineCap: "round",
          pane: "routePane"
        }).addTo(map);
      }
      if (points.length >= 2) {
        // Draw a slim white casing first so the blue route remains distinct
        // where it overlaps or runs close to other mapped lines.
        routeOutlineLayer = L.polyline(points.map(ll), {
          color: themeColor("--map-location-outline"),
          weight: 10,
          opacity: 1,
          lineCap: "round",
          lineJoin: "round",
          pane: "routePane",
          interactive: false
        }).addTo(map);
        routeLayer = L.polyline(points.map(ll), {
          color: themeColor("--map-route"),
          weight: themeNumber("--map-route-width"),
          opacity: 1,
          lineCap: "round",
          lineJoin: "round",
          pane: "routePane"
        }).addTo(map);
      }
    }

    const roadNames = [];

    for (const edge of edges) {
      if (edge.topologyConnection) continue;
      if (roadNames[roadNames.length - 1] !== edge.name) {
        roadNames.push(edge.name);
      }
    }

    showRouteSummary(
      destination, start, metres, seconds, roadNames, liveMode
    );
    // Showing a live route is a preview only. Activate camera-following only
    // after the user presses Start route; keep it active during a real reroute.
    liveNavigationActive = liveMode && journeyStartConfirmed;

    status(
      "Route ready for " + destination.name + ".\n" +
      (liveMode
        ? "Live navigation follows your position and checks for route deviations."
        : $("startMode").value === "map"
          ? "Route starts at the selected map point."
          : "The selected starting gate is highlighted in teal.")
    );

    if (!liveNavigationActive) fitSelectedResult();
    if (collapseMobilePanelOnSuccess) {
      document.dispatchEvent(new CustomEvent("laar-route-ready"));
    }

  } catch (error) {
    console.error(error);
    const routeFailure = /No connected road route|No connected route|No valid gate|Cannot reconstruct route|Starting point unavailable|Cannot attach|Cannot identify the road segment/i.test(error.message || "");
    if (!routeFailure && !liveNavigationActive) fitSelectedResult();
    if (routeFailure) {
      const highlightedCount = highlightRouteSearchLinks();
      showRouteFailureBanner(
        error.message || "No route could be found."
      );
      status(
        "Routing error: " + error.message +
        (highlightedCount
          ? "\nDebug: highlighted " + highlightedCount + " road links examined during the search in red."
          : "\nDebug: no road links were recorded as examined.")
      );
    } else {
      status("Routing error: " + error.message);
    }
    liveNavigationActive = false;

  } finally {
    adjacency = baseGraph;
  }
}


function hideMapLoadingDialog() {
  const dialog = document.getElementById("mapLoadingDialog");
  if (dialog) dialog.classList.add("is-hidden");
}


/* INITIALISE */

async function init() {
  try {
    const required = [
      "vehicleType", "map", "status", "start", "end", "route", "clear", "fit",
      "startMode", "locate", "stopLocation", "locationStatus",
      "destinationSearch", "searchStatus", "copyLink",
      "shareStatus", "shareFallback", "shareLink",
      "routeSummary", "summaryDestination", "summaryStart",
      "summaryDistance", "summaryTime", "routeDetails", "networkDate"
    ];

    for (const id of required) {
      if (!$(id)) {
        throw new Error("index.html is missing id='" + id + "'.");
      }
    }

    const controlIds = [
      "vehicleType", "start", "end", "route", "clear", "fit", "startMode",
      "locate", "stopLocation", "destinationSearch", "copyLink"
    ];

    controlIds.forEach(id => $(id).disabled = true);

    if (typeof L === "undefined" || typeof proj4 === "undefined") {
      throw new Error("Leaflet or Proj4 did not load.");
    }

    map = L.map("map", {
      maxBoundsViscosity: 1,
      scrollWheelZoom: true,
      preferCanvas: true,
      renderer: L.canvas({ padding: 0.5 })
    });

    map.on("mousemove", event => setMapClickHoverCursor(event.latlng));
    map.on("mouseout", () => setMapClickHoverCursor(null));
    map.on("click", event => {
      if ($("startMode")?.value !== "map") return;
      if (typeof setMapClickOrigin !== "function") {
        const message = "Map click received, but origin-selection code is unavailable.";
        if (typeof locationStatus === "function") locationStatus(message);
        status(message);
        console.error(message);
        return;
      }

      try {
        status("Map click received. Finding the nearest permitted road…");
        setMapClickOrigin(event.latlng);
      } catch (error) {
        const message = "Map click failed: " + (error?.message || String(error));
        if (typeof locationStatus === "function") locationStatus(message);
        status(message);
        console.error(error);
      }
    });

    document.addEventListener("laar-mobile-layout-settled", () => {
      if (!window.matchMedia("(max-width: 760px)").matches) return;
      map.invalidateSize({ pan: false, animate: false });
      fitSelectedResult();
    });

    map.createPane("roadCasingPane");
    map.getPane("roadCasingPane").style.zIndex = "390";

    map.createPane("selectedLaarPane");
    map.getPane("selectedLaarPane").style.zIndex = "410";

    map.createPane("routePane");
    map.getPane("routePane").style.zIndex = "450";

    map.createPane("gateMarkerPane");
    map.getPane("gateMarkerPane").style.zIndex = "670";

    L.control.scale({ imperial: false }).addTo(map);

    const pending = new Set([
      ROADS_FILE, "data/junctions.geojson", "data/gates.geojson",
      "data/destinations.geojson", "data/meta.json", "data/destination_areas.geojson",
      "data/boundary.geojson"
    ]);

    let failed = false;

    async function load(filename, optional = false) {
      try {
        const data = await read(filename, optional);
        pending.delete(filename);

        if (!failed) {
          status(
            pending.size
              ? "Loading:\n" + [...pending].join("\n")
              : "Files loaded. Preparing network…"
          );
        }

        return data;

      } catch (error) {
        failed = true;
        throw error;
      }
    }

    status("Loading network files…");

    // Load and render the visible map geometry first. Routing inputs are fetched
    // afterwards so graph construction cannot delay the first useful map frame.
    const [r, areas, boundary] = await Promise.all([
      load(ROADS_FILE),
      load("data/destination_areas.geojson"),
      load("data/boundary.geojson")
    ]);

    loadDestinationAreas(areas);

    L.geoJSON(boundary, {
      interactive: false,
      style: {
        color: "#F8E0DE",
        weight: 1,
        opacity: 1,
        fillColor: "#F8E0DE",
        fillOpacity: 1
      }
    }).addTo(map);

    const roadTypeOrder = { local: 0, minor: 1, major: 2, main: 2, public: 3, haul: 4 };
    const orderedRoadData = {
      ...r,
      features: [...(r.features || [])].sort((a, b) => {
        const typeA = String(a.properties?.type || "").trim().toLowerCase();
        const typeB = String(b.properties?.type || "").trim().toLowerCase();
        return (roadTypeOrder[typeA] ?? -1) - (roadTypeOrder[typeB] ?? -1);
      })
    };

    L.geoJSON(orderedRoadData, {
      pane: "roadCasingPane",
      smoothFactor: 1.5,
      interactive: false,
      style: roadCasingStyle
    }).addTo(map);

    let roadLayer = L.geoJSON(orderedRoadData, {
      smoothFactor: 1.5,
      style: roadStyle,
      onEachFeature: bindRoadPopup
    }).addTo(map);
    displayedRoadLayer = roadLayer;

    siteBounds = roadLayer.getBounds();
    if (!siteBounds.isValid()) throw new Error("Invalid map extent.");
    if (destinationAreas.size) {
      const areaBounds = L.geoJSON({
        type: "FeatureCollection",
        features: [...destinationAreas.values()].flat()
      }).getBounds();
      if (areaBounds.isValid()) siteBounds.extend(areaBounds);
    }

    map.invalidateSize({ pan: false, animate: false });
    map.fitBounds(siteBounds, { padding: [20, 20], animate: false });

    // Let the browser paint the map before fetching/building the routing graph.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const [j, g, d, metadata] = await Promise.all([
      load("data/junctions.geojson"),
      load("data/gates.geojson"),
      load("data/destinations.geojson"),
      load("data/meta.json", true)
    ]);

    if (
      typeof prepareRoutingStart !== "function" ||
      typeof initialiseLocationControls !== "function"
    ) {
      throw new Error(
        "live-location.js did not load. Check script order."
      );
    }

    await new Promise(resolve => setTimeout(resolve, 0));

    networkInputs = { j, r, g, d, metadata };
    vehicleMode = $("vehicleType").value;
    const invalidAccessCount = reportAccessData(r);
    build(j, r, g, d, metadata);

    const reviewed =
      metadata?.network_reviewed_at ??
      metadata?.routing?.network_reviewed_at;

    $("networkDate").textContent =
      reviewed === undefined ||
      reviewed === null ||
      String(reviewed).trim() === ""
        ? "Not recorded"
        : String(reviewed);

    // Road geometry is already visible; map clicks are handled by Leaflet's map-level event.
       const movementBounds = siteBounds.pad(1.0);
    map.setMaxBounds(movementBounds);
    map.setMinZoom(Math.max(0, map.getBoundsZoom(movementBounds) - 1));
    map.invalidateSize({ pan: false, animate: false });
    const initialCenter = roadNetworkCenter();
    const initialZoom = Math.log2(
      156543.03392804097 * Math.cos(initialCenter.lat * Math.PI / 180) *
      SCALE_BAR_MAX_WIDTH / INITIAL_SCALE_BAR_METRES
    );
    map.setView(initialCenter, initialZoom, { animate: false });
    const sidebarWidth = document.querySelector("body > aside")?.getBoundingClientRect().width || 0;
    const horizontalOffset = window.matchMedia("(max-width: 760px)").matches
      ? 0
      : sidebarWidth / 2;
    if (horizontalOffset) map.panBy([horizontalOffset, 0], { animate: false });

    gateMarkers = new Map();
    gateMarkerLayer = L.layerGroup().addTo(map);
    if (window.laarLayerControl) {
      window.laarLayerControl.addOverlay(gateMarkerLayer, "Gates");
    }
    destinationOptions = [];

    $("start").replaceChildren();

    const missingPolygons = [];

    locations.forEach((location, index) => {
      if (location.kind === "gate") {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = location.name;
        $("start").appendChild(option);

        const marker = L.marker(ll(location.point), {
          icon: createGateIcon(),
          pane: "gateMarkerPane",
          title: location.name,
          alt: "Site gate: " + location.name,
          keyboard: true,
          riseOnHover: true
        }).addTo(gateMarkerLayer);

        const label = document.createElement("span");
        label.textContent = location.name;

        marker.bindTooltip(label, {
          permanent: true,
          direction: "top",
          offset: [0, 0],
          className: "laar-gate-label"
        });

        marker.bindPopup(createGatePopup(location), {
          className: "laar-gate-popup",
          minWidth: 240,
          maxWidth: 290,
          autoPanPadding: [20, 20]
        });

        gateMarkers.set(index, marker);

      } else {
        const hasPolygon = destinationAreas.has(location.name);

        if (!hasPolygon) missingPolygons.push(location.name);

        destinationOptions.push({
          index,
          name: location.name,
          type: location.type,
          valid: location.valid,
          hasPolygon
        });
      }
    });

    if (!destinationOptions.length) {
      throw new Error("No destination points.");
    }

    $("start").selectedIndex = -1;
    $("start").disabled = true;
    $("startMode").value = "gate";

    $("vehicleType").disabled = false;
    $("vehicleType").onchange = changeVehicle;
    document.querySelectorAll('input[name="vehicleTypeChoice"]').forEach(radio => {
      radio.checked = radio.value === $("vehicleType").value;
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        $("vehicleType").value = radio.value;
        $("vehicleType").dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
    document.querySelectorAll('input[name="destinationType"]').forEach(radio => {
      radio.addEventListener("change", () => {
        $("end").value = "";
        $("destinationSearch").value = "";
        clearRoute();
        renderDestinationOptions();
        refreshShareControls();
        status("Select a " + radio.value + " destination.");
      });
    });
    document.querySelectorAll('input[name="startModeChoice"]').forEach(radio => {
      radio.checked = radio.value === $("startMode").value;
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        $("startMode").value = radio.value;
        $("startMode").dispatchEvent(new Event("change", { bubbles: true }));
      });
    });

    $("destinationSearch").disabled = false;
    $("end").disabled = false;
    $("route").disabled = false;
    $("clear").disabled = false;
    $("fit").disabled = false;

    $("destinationSearch").oninput = renderDestinationOptions;

    $("destinationSearch").onkeydown = event => {
      if (event.key !== "Enter") return;

      const query = searchKey($("destinationSearch").value);
      const category = document.querySelector('input[name="destinationType"]:checked')?.value || "LAAR";
      const matching = destinationOptions.filter(item =>
        destinationCategory(item) === category && searchKey(item.name).includes(query)
      );

      if (matching.length === 1) {
        event.preventDefault();
        $("end").value = String(matching[0].index);
        calculate();
      }
    };

    renderDestinationOptions();

    $("end").onchange = () => {
      if ($("end").value === "") {
        clearRoute();
        $("start").selectedIndex = -1;
        updateDestinationUrl();
        refreshShareControls();
        status("Select a destination.");
      } else {
        calculate();
      }
    };

    $("route").onclick = () => {
      // Show / update is an explicit request for the full route overview.
      // If navigation was actively following GPS, stop camera-following so
      // the overview remains visible instead of immediately snapping back.
      if (liveNavigationActive) {
        liveNavigationActive = false;
        journeyStartConfirmed = false;
        if ($("journeyStage")) $("journeyStage").textContent = "Route preview ready. Start when you are ready.";
        if ($("journeyGuidance")) $("journeyGuidance").hidden = true;
        if ($("startLiveRoute")) $("startLiveRoute").hidden = false;
        if ($("stopLiveRoute")) $("stopLiveRoute").hidden = true;
      }
      calculate(true);
      if (routeLayer) fitSelectedResult();
    };
    $("copyLink").onclick = copyDestinationLink;

    $("clear").onclick = () => {
      clearRoute();

      $("start").selectedIndex = -1;
      $("end").value = "";
      $("destinationSearch").value = "";

      renderDestinationOptions();
      updateDestinationUrl();
      refreshShareControls();

      status(
        "Selection cleared.\n" +
        ($("startMode").value === "live"
          ? "Location tracking is unchanged. Use Stop location to stop it."
          : "Select another LAAR.")
      );
    };

    $("fit").onclick = () => {
      map.fitBounds(siteBounds.pad(0.1));
    };

    initialiseLocationControls();
    refreshShareControls();
    addMapLegend();

    const gateCount = locations.filter(item => {
      return item.kind === "gate" && item.valid;
    }).length;
    const permittedRoadIds = new Set(roads.map(road => road.id));
    const reachableFromGates = new Set();
    const queue = locations
      .filter(item => item.kind === "gate" && item.valid && item.node !== null)
      .map(item => item.node);
    for (const node of queue) reachableFromGates.add(node);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const edge of adjacency.get(queue[cursor]) || []) {
        if (!permittedRoadIds.has(edge.roadId) || reachableFromGates.has(edge.to)) continue;
        reachableFromGates.add(edge.to);
        queue.push(edge.to);
      }
    }
    const health = {
      roads: features(r, ROADS_FILE).length,
      permittedRoads: roads.length,
      invalidAccessRoads: invalidAccessCount,
      validGates: gateCount,
      invalidGates: locations.filter(item => item.kind === "gate" && !item.valid).length,
      unavailableDestinations: locations.filter(item => item.kind === "destination" && !item.valid).length,
      disconnectedDestinations: locations.filter(item =>
        item.kind === "destination" && item.valid &&
        (item.node === null || !reachableFromGates.has(item.node))
      ).length,
      missingDestinationPolygons: missingPolygons.length,
      duplicateDestinations: ignoredDestinationNames.length
    };
    console.info("LAAR network health", health);

    status(
      "Vehicle: " + vehicleMode + ". " + roads.length + " eligible roads, " +
      destinationOptions.length + " unique destinations.\n" +
      "Valid gates: " + gateCount + ". " +
      "Snap limit: " + MAX_SNAP + " m.\n" +
      "Blocked roads with invalid access fields: " + invalidAccessCount + ".\n" +
      "Skipped duplicate centroids: " +
      ignoredDestinationNames.length + "." +
      (missingPolygons.length
        ? "\nMissing polygon matches: " + missingPolygons.join(", ")
        : "")
    );

    // Start in live-location mode so the user's current position is shown
    // automatically on launch. The browser may ask for location permission.
    // Shared-link destinations are not restored automatically on refresh.
    $("startMode").value = "live";
    $("start").selectedIndex = -1;
    $("end").value = "";
    $("destinationSearch").value = "";
    $("searchStatus").textContent = "";
    $("shareFallback").hidden = true;
    $("shareLink").value = "";
    updateDestinationUrl();
    clearRoute();
    refreshShareControls();
    locationStatus("Requesting your current location…");
    status(
      "Vehicle: " + vehicleMode + ". " + roads.length + " eligible roads. " +
      "Waiting for your current location."
    );
    $("locate").disabled = false;
    startLiveLocation();
    hideMapLoadingDialog();

  } catch (error) {
    for (const id of [
      "vehicleType", "start", "end", "route", "clear", "fit", "startMode",
      "locate", "stopLocation", "destinationSearch", "copyLink"
    ]) {
      if ($(id)) $(id).disabled = true;
    }

    status("Setup error: " + error.message);
    hideMapLoadingDialog();
    console.error(error);
  }
}


/* Initialisation is started by main.js after all modules load. */

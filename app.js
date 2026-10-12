const API_BASE = "https://dg2-dms-mapping.onrender.com";
const statusEl = document.getElementById("serviceStatus");
const destinationSelect = document.getElementById("destinationSelect");
const routeButton = document.getElementById("routeButton");
const messageEl = document.getElementById("message");
const summaryEl = document.getElementById("routeSummary");

const map = new maplibregl.Map({ 
  container: "map", style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json", 
  center: [46.603, 24.716], 
  zoom: 14
}); 
map.addControl(new maplibregl.NavigationControl(), "top-right");
let startMarker = null;
endMarker = null;

function getGeoJSONBounds(geometry) {
  const bounds = new maplibregl.LngLatBounds();

  function visitCoordinates(value) {
    if (
      Array.isArray(value) &&
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      bounds.extend([value[0], value[1]]);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(visitCoordinates);
    }
  }

  visitCoordinates(geometry.coordinates);

  return [
    bounds.getWest(),
    bounds.getSouth(),
    bounds.getEast(),
    bounds.getNorth()
  ];
}

async function loadSiteBoundary() {
  const response = await fetch("./data/site_boundary.geojson");

  if (!response.ok) {
    throw new Error("Failed to load site_boundary.geojson");
  }

  const geojson = await response.json();

  if (map.getSource("site_boundary")) {
    map.getSource("site_boundary").setData(geojson);
    return;
  }

  map.addSource("site_boundary", {
    type: "geojson",
    data: geojson
  });

  map.addLayer({
    id: "site_boundary-fill",
    type: "fill",
    source: "site_boundary",
    paint: {
      "fill-color": "#dfaf7e",
      "fill-opacity": 0.2
    }
  });


async function loadCommunities() {
  const response = await fetch("./data/communities.geojson");

  if (!response.ok) {
    throw new Error("Failed to load communities.geojson");
  }

  const geojson = await response.json();

  // Update existing community source if already loaded
  if (map.getSource("communities")) {
    map.getSource("communities").setData(geojson);
  } else {
    map.addSource("communities", {
      type: "geojson",
      data: geojson
    });

    // Community fill
    map.addLayer({
      id: "communities-fill",
      type: "fill",
      source: "communities",
      paint: {
        "fill-color": "#B9A5C9",
        "fill-opacity": 0.18
      }
    });

    // Community outlines
    map.addLayer({
      id: "communities-outline",
      type: "line",
      source: "communities",
      paint: {
        "line-color": "#9B85AF",
        "line-width": 1.2,
        "line-opacity": 0.35
      }
    });

    // Labels at the center of each feature
    map.addLayer({
      id: "communities-labels",
      type: "symbol",
      source: "communities",
      layout: {
        "text-field": ["coalesce", ["get", "name"], ""],
        "text-size": 12,
        "text-font": ["Open Sans Regular"],
        "text-anchor": "center",
        "text-allow-overlap": false
      },
      paint: {
        "text-color": "#75677F",
        "text-opacity": 0.55,
        "text-halo-color": "#F4EFE5",
        "text-halo-width": 1
      }
    });
  }
}
  
async function loadLocalRoads() {
  const response = await fetch("./data/local_roads.geojson");

  if (!response.ok) {
    throw new Error("Failed to load local_roads.geojson");
  }

  const geojson = await response.json();

  if (map.getSource("local_roads")) {
    map.getSource("local_roads").setData(geojson);
    return;
  }

  map.addSource("local_roads", {
    type: "geojson",
    data: geojson
  });

  // Outer road outline
  map.addLayer({
    id: "local_roads-outline",
    type: "line",
    source: "local_roads",
    layout: {
      "line-cap": "round",
      "line-join": "round"
    },
    paint: {
      "line-color": "#B8C9D8",
      "line-width": 2.5,
      "line-opacity": 1
    }
  });

  // Inner road surface
  map.addLayer({
    id: "local_roads-lines",
    type: "line",
    source: "local_roads",
    layout: {
      "line-cap": "round",
      "line-join": "round"
    },
    paint: {
      "line-color": "#CED8E1",
      "line-width": 1.5,
      "line-opacity": 1
    }
  });
}


async function loadMainRoads() {
  const response = await fetch("./data/main_roads.geojson");

  if (!response.ok) {
    throw new Error("Failed to load main_roads.geojson");
  }

  const geojson = await response.json();

  if (map.getSource("main_roads")) {
    map.getSource("main_roads").setData(geojson);
    return;
  }

  map.addSource("main_roads", {
    type: "geojson",
    data: geojson
  });

  // Outer road outline
  map.addLayer({
    id: "main_roads-outline",
    type: "line",
    source: "main_roads",
    layout: {
      "line-cap": "round",
      "line-join": "round"
    },
    paint: {
      "line-color": "#7189A8",
      "line-width": 6,
      "line-opacity": 1
    }
  });

  // Inner road surface
  map.addLayer({
    id: "main_roads-lines",
    type: "line",
    source: "main_roads",
    layout: {
      "line-cap": "round",
      "line-join": "round"
    },
    paint: {
      "line-color": "#92A9C6",
      "line-width": 4,
      "line-opacity": 1
    }
  });
}



async function loadPublicRoads() {
  const response = await fetch("./data/public_roads.geojson");

  if (!response.ok) {
    throw new Error("Failed to load public_roads.geojson");
  }

  const geojson = await response.json();

  if (map.getSource("public_roads")) {
    map.getSource("public_roads").setData(geojson);
    return;
  }

  map.addSource("public_roads", {
    type: "geojson",
    data: geojson
  });

  // Outer road outline
  map.addLayer({
    id: "public_roads-outline",
    type: "line",
    source: "public_roads",
    layout: {
      "line-cap": "round",
      "line-join": "round"
    },
    paint: {
      "line-color": "#B0C2D4",
      "line-width": 5,
      "line-opacity": 1
    }
  });

  // Inner road surface
  map.addLayer({
    id: "public_roads-lines",
    type: "line",
    source: "public_roads",
    layout: {
      "line-cap": "round",
      "line-join": "round"
    },
    paint: {
      "line-color": "#D9E1E8",
      "line-width": 3.5,
      "line-opacity": 1
    }
  });
}

async function loadHaulRoads() {
  const response = await fetch("./data/haul_roads.geojson");

  if (!response.ok) {
    throw new Error("Failed to load haul_roads.geojson");
  }

  const geojson = await response.json();

  if (map.getSource("haul_roads")) {
    map.getSource("haul_roads").setData(geojson);
    return;
  }

  map.addSource("haul_roads", {
    type: "geojson",
    data: geojson
  });

  // Outer haul road outline
  map.addLayer({
    id: "haul_roads-outline",
    type: "line",
    source: "haul_roads",
    layout: {
      "line-cap": "round",
      "line-join": "round"
    },
    paint: {
      "line-color": "#9C4525",
      "line-width": 5,
      "line-opacity": 1
    }
  });

  // Inner haul road surface
  map.addLayer({
    id: "haul_roads-lines",
    type: "line",
    source: "haul_roads",
    layout: {
      "line-cap": "round",
      "line-join": "round"
    },
    paint: {
      "line-color": "#D96B35",
      "line-width": 3.5,
      "line-opacity": 1
    }
  });
}

function setMessage(text, type = "") { messageEl.textContent = text; messageEl.className = `message ${type}`.trim(); }
function setServiceStatus(text, type = "") { statusEl.textContent = text; statusEl.className = `status ${type}`.trim(); }
function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const total = Math.round(seconds), mins = Math.floor(total / 60), secs = total % 60;
  return mins ? `${mins} min ${secs} sec` : `${secs} sec`;
}
function clearRoute() {
  if (map.getLayer("route-line")) map.removeLayer("route-line");
  if (map.getSource("route-source")) map.removeSource("route-source");
  if (startMarker) { startMarker.remove(); startMarker = null; }
  if (endMarker) { endMarker.remove(); endMarker = null; }
  summaryEl.hidden = true;
}
function getAllCoordinates(geojson) {
  const points = [];
  function visit(coords) {
    if (!Array.isArray(coords)) return;
    if (coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") { points.push(coords); return; }
    coords.forEach(visit);
  }
  (geojson.features || []).forEach(feature => { if (feature.geometry) visit(feature.geometry.coordinates); });
  return points;
}

function addEndpointMarker(coords, color, label) {
  const container = document.createElement("div");
  Object.assign(container.style, {
    position: "relative",
    width: "14px",
    height: "14px"
  });

  const node = document.createElement("div");
  Object.assign(node.style, {
    position: "absolute",
    left: "0",
    top: "0",
    width: "14px",
    height: "14px",
    boxSizing: "border-box",
    borderRadius: "50%",
    background: color,
    border: "2px solid white",
    boxShadow: "0 0 0 1px #344054"
  });

  const text = document.createElement("div");
  text.textContent = label;
  Object.assign(text.style, {
    position: "absolute",
    left: "22px",
    top: "50%",
    transform: "translateY(-50%)",
    color: "#000000",
    background: "#ffffff",
    border: "1px solid #d0d5dd",
    borderRadius: "3px",
    padding: "3px 6px",
    fontSize: "12px",
    fontWeight: "600",
    whiteSpace: "nowrap",
    boxShadow: "0 1px 3px rgba(0,0,0,0.2)"
  });

  container.appendChild(node);
  container.appendChild(text);

  return new maplibregl.Marker({
    element: container,
    anchor: "center"
  }).setLngLat(coords).addTo(map);
}

async function loadDestinations() {
  try {
    const health = await fetch(`${API_BASE}/health`);
    if (!health.ok) throw new Error(`Health check returned HTTP ${health.status}`);
    setServiceStatus("Routing service connected", "ok");
    const response = await fetch(`${API_BASE}/destinations`);
    if (!response.ok) throw new Error(`Destinations request returned HTTP ${response.status}`);
    const data = await response.json(), destinations = data.destinations || [];
    if (!destinations.length) throw new Error("The routing service returned no destinations.");
    destinationSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = ""; placeholder.textContent = "Select a destination…";
    destinationSelect.appendChild(placeholder);
    destinations.forEach(id => {
      const option = document.createElement("option");
      option.value = id; option.textContent = id;
      destinationSelect.appendChild(option);
    });
    destinationSelect.disabled = false; routeButton.disabled = false;
    setMessage(`${destinations.length} destinations loaded. Select one and calculate a route.`);
  } catch (error) {
    setServiceStatus("Routing service unavailable", "error");
    setMessage(`Could not load destinations: ${error.message}. Check the API service and network connection.`, "error");
  }
}
async function calculateRoute() {
  const destinationId = destinationSelect.value;
  if (!destinationId) { setMessage("Select a destination first.", "error"); return; }
  routeButton.disabled = true; routeButton.textContent = "Calculating…";
  setMessage(`Calculating route to ${destinationId}…`); clearRoute();
  try {
    const response = await fetch(`${API_BASE}/route`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destination_id: destinationId }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `Request failed with HTTP ${response.status}`);
    if (data.status === "no_route") throw new Error(data.message || "No route is available for this destination.");
    if (data.status !== "ok" || !data.route || !Array.isArray(data.route.features)) throw new Error("API response did not contain route geometry in the expected format.");

    map.addSource("route-source", { type: "geojson", data: data.route });
    map.addLayer({ id: "route-line", type: "line", source: "route-source", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#175cd3", "line-width": 6, "line-opacity": 0.92 } });

const coords = getAllCoordinates(data.route);
if (coords.length) {
const bounds = coords.reduce(
(b, c) => b.extend(c),
new maplibregl.LngLatBounds(coords[0], coords[0])
);

// Include the actual gate in the map bounds.
if (Array.isArray(data.gate_coordinates)) {
bounds.extend(data.gate_coordinates);
}

// Include the destination area in the map bounds.
if (data.destination_area) {
const areaFeature = {
type: "Feature",
properties: {
name: data.destination_id
},
geometry: data.destination_area
};


const areaBounds = getGeoJSONBounds(areaFeature.geometry);
bounds.extend([areaBounds[0], areaBounds[1]]);
bounds.extend([areaBounds[2], areaBounds[3]]);

if (map.getSource("destination-area")) {
  map.getSource("destination-area").setData(areaFeature);
} else {
  map.addSource("destination-area", {
    type: "geojson",
    data: areaFeature
  });

  map.addLayer({
    id: "destination-area-fill",
    type: "fill",
    source: "destination-area",
    paint: {
      "fill-color": "#3388ff",
      "fill-opacity": 0.25
    }
  });

  map.addLayer({
    id: "destination-area-outline",
    type: "line",
    source: "destination-area",
    paint: {
      "line-color": "#3388ff",
      "line-width": 2
    }
  });

  map.addLayer({
  id: "destination-area-label",
  type: "symbol",
  source: "destination-area",
  layout: {
  "symbol-placement": "point",
  "text-field": ["get", "name"],
  "text-font": ["Open Sans Regular"],
  "text-size": 13,
  "text-anchor": "center",
  "text-allow-overlap": true
  },
  paint: {
  "text-color": "#000000",
  "text-halo-color": "#ffffff",
  "text-halo-width": 5,
  "text-halo-blur": 0
  }
  });
  
}
}

map.fitBounds(bounds, {
padding: { top: 120, bottom: 120, left: 120, right: 120 },
maxZoom: 15,
duration: 700
});

if (Array.isArray(data.gate_coordinates)) {
startMarker = addEndpointMarker(
data.gate_coordinates, "#12b76a", `Gate ${data.gate_id}`
);
}
}

    document.getElementById("gateValue").textContent = data.gate_id ?? "—";
    document.getElementById("startValue").textContent = data.start_junction ?? "—";
    document.getElementById("endValue").textContent = data.end_junction ?? "—";
    document.getElementById("timeValue").textContent = formatDuration(data.travel_time_seconds);
    document.getElementById("roadsValue").textContent = (data.road_ids || []).length;
    document.getElementById("roadSequence").textContent = (data.road_ids || []).join(" → ") || "—";
    summaryEl.hidden = false; setMessage(`Route to ${destinationId} found.`, "success");
  } catch (error) { setMessage(`Route calculation failed: ${error.message}`, "error"); }
  finally { routeButton.disabled = false; routeButton.textContent = "Calculate route"; }
}
routeButton.addEventListener("click", calculateRoute);
destinationSelect.addEventListener("change", () => {
  clearRoute();
  if (destinationSelect.value) setMessage(`Destination ${destinationSelect.value} selected. Click Calculate route.`);
  else setMessage("Select a destination to begin.");
});

map.on("load", async () => {
  // Hide existing CARTO style layers
  for (const layer of map.getStyle().layers ?? []) {
    map.setLayoutProperty(layer.id, "visibility", "none");
  }

  try {
    await Promise.all([
      loadDestinations(),
      loadSiteBoundary(),
      //loadCommunities(),
      loadHaulRoads(),
      loadLocalRoads(),
      loadMainRoads(),
      loadPublicRoads()
    ]);
  } catch (error) {
    console.error("Failed to load application layers:", error);
  }
});

const API_BASE = "https://dg2-dms-mapping.onrender.com";
const statusEl = document.getElementById("serviceStatus");
const destinationSelect = document.getElementById("destinationSelect");
const routeButton = document.getElementById("routeButton");
const messageEl = document.getElementById("message");
const summaryEl = document.getElementById("routeSummary");

const map = new maplibregl.Map({
  container: "map",
  style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  center: [46.603, 24.716],
  zoom: 14
});
map.addControl(new maplibregl.NavigationControl(), "top-right");
let startMarker = null, endMarker = null;

const KMZ_LAYERS = [
  {
    file: "D2 Site Boundary.kmz",
    id: "d2-site-boundary",
    color: "#7b2cbf",
    width: 3
  },
  {
    file: "Haul Roads.kmz",
    id: "haul-roads",
    color: "#e63946",
    width: 3.5
  },
  {
    file: "Public Roads.kmz",
    id: "public-roads",
    color: "#f4a261",
    width: 2.5
  }
];


function getKmlStyle(xml, styleUrl) {
  if (!styleUrl) return null;

  const id = styleUrl.split("#").pop();
  const elements = [...xml.getElementsByTagName("*")];

  let style = elements.find(
    el => el.localName === "Style" &&
          el.getAttribute("id") === id
  );

  if (style) return style;

  const styleMap = elements.find(
    el => el.localName === "StyleMap" &&
          el.getAttribute("id") === id
  );

  if (!styleMap) return null;

  const pairs = [...styleMap.getElementsByTagName("*")].filter(
    el => el.localName === "Pair"
  );

  const normalPair = pairs.find(pair =>
    [...pair.children].some(
      child => child.localName === "key" &&
               child.textContent.trim() === "normal"
    )
  );

  const normalUrl = [...(normalPair?.children || [])].find(
    child => child.localName === "styleUrl"
  )?.textContent.trim();

  if (!normalUrl) return null;

  const normalId = normalUrl.split("#").pop();

  return elements.find(
    el => el.localName === "Style" &&
          el.getAttribute("id") === normalId
  ) || null;
}

function kmlColorToCss(value) {
  if (!value || !/^[0-9a-f]{8}$/i.test(value)) return null;

  const alpha = parseInt(value.slice(0, 2), 16) / 255;
  const blue = value.slice(2, 4);
  const green = value.slice(4, 6);
  const red = value.slice(6, 8);

  return {
    color: `#${red}${green}${blue}`,
    opacity: alpha
  };
}

function getKmlStyleValues(style) {
  if (!style) return null;

  const children = [...style.children];
  const lineStyle = children.find(el => el.localName === "LineStyle");
  const polyStyle = children.find(el => el.localName === "PolyStyle");

  function readColor(parent) {
    const el = [...(parent?.children || [])].find(
      child => child.localName === "color"
    );
    return kmlColorToCss(el?.textContent.trim());
  }

  const widthElement = [...(lineStyle?.children || [])].find(
    el => el.localName === "width"
  );

  const width = Number(widthElement?.textContent);

  return {
    line: readColor(lineStyle),
    fill: readColor(polyStyle),
    width: Number.isFinite(width) && width > 0 ? width : 2,
    fillEnabled: ![...(polyStyle?.children || [])].some(
      el => el.localName === "fill" &&
            el.textContent.trim() === "0"
    ),
    outlineEnabled: ![...(polyStyle?.children || [])].some(
      el => el.localName === "outline" &&
            el.textContent.trim() === "0"
    )
  };
}

async function loadKmzLayer(config) {
  const url = `maps/${encodeURIComponent(config.file)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${config.file}: HTTP ${response.status}`);
  }

  const archive = await JSZip.loadAsync(await response.arrayBuffer());

  const kmlFile = Object.values(archive.files).find(
    file => !file.dir && /\.kml$/i.test(file.name)
  );

  if (!kmlFile) {
    throw new Error(`${config.file}: no KML file found`);
  }

  const kmlText = await kmlFile.async("text");
  const xml = new DOMParser().parseFromString(
    kmlText,
    "application/xml"
  );

  if (xml.querySelector("parsererror")) {
    throw new Error(`${config.file}: invalid KML XML`);
  }

  const geojson = toGeoJSON.kml(xml);

  // Apply the original KML style to each GeoJSON feature.
  const defaultFillOpacity =
    config.id === "d2-site-boundary" ? 0.12 : 0.04;

  geojson.features.forEach(feature => {
    feature.properties = feature.properties || {};

    const style = getKmlStyle(
      xml,
      feature.properties.styleUrl
    );

    const values = getKmlStyleValues(style);

    feature.properties._lineColor =
      values?.line?.color || config.color;

    feature.properties._lineWidth =
      values?.line ? values.width : config.width;

    feature.properties._lineOpacity =
      values?.line
        ? values.line.opacity * (values.outlineEnabled ? 1 : 0)
        : 0.9;

    feature.properties._fillColor =
      values?.fill?.color || config.color;

    feature.properties._fillOpacity =
      values?.fill
        ? values.fill.opacity * (values.fillEnabled ? 1 : 0)
        : defaultFillOpacity;

    feature.properties._pointColor =
      values?.line?.color ||
      values?.fill?.color ||
      config.color;
  });

  const sourceId = `${config.id}-source`;

  map.addSource(sourceId, {
    type: "geojson",
    data: geojson
  });

  // Polygon fills use each feature's KML fill style.
  map.addLayer({
    id: `${config.id}-fill`,
    type: "fill",
    source: sourceId,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "fill-color": ["get", "_fillColor"],
      "fill-opacity": ["get", "_fillOpacity"]
    }
  });

  // Roads and polygon outlines use each feature's KML line style.
  map.addLayer({
    id: `${config.id}-line`,
    type: "line",
    source: sourceId,
    filter: [
      "in",
      ["geometry-type"],
      ["literal", ["LineString", "Polygon"]]
    ],
    paint: {
      "line-color": ["get", "_lineColor"],
      "line-width": ["get", "_lineWidth"],
      "line-opacity": ["get", "_lineOpacity"]
    },
    layout: {
      "line-cap": "round",
      "line-join": "round"
    }
  });

  // Point features use their KML style color where available.
  map.addLayer({
    id: `${config.id}-points`,
    type: "circle",
    source: sourceId,
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 5,
      "circle-color": ["get", "_pointColor"],
      "circle-opacity": ["get", "_lineOpacity"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5
    }
  });

  // Keep the calculated route above the KMZ layers.
  if (map.getLayer("route-line")) {
    map.moveLayer("route-line");
  }

  console.info(
    `Loaded ${config.file}: ${geojson.features.length} features`
  );
}

async function loadKmzLayers() {
  for (const config of KMZ_LAYERS) {
    try {
      await loadKmzLayer(config);
    } catch (error) {
      console.error(`Could not load ${config.file}:`, error);
    }
  }
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
  const node = document.createElement("div");
  Object.assign(node.style, { width: "14px", height: "14px", borderRadius: "50%", background: color, border: "2px solid white", boxShadow: "0 0 0 1px #344054" });
  node.title = label;
  return new maplibregl.Marker({ element: node }).setLngLat(coords).addTo(map);
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

  if (Array.isArray(data.gate_coordinates) && Array.isArray(data.destination_coordinates)) {
    bounds.extend(data.gate_coordinates);
    bounds.extend(data.destination_coordinates);
  }

  map.fitBounds(bounds, {
    padding: { top: 70, bottom: 80, left: 60, right: 60 },
    maxZoom: 17,
    duration: 700
  });

  if (Array.isArray(data.gate_coordinates)) {
    startMarker = addEndpointMarker(
      data.gate_coordinates, "#12b76a", `Gate ${data.gate_id}`
    );
  }

  if (Array.isArray(data.destination_coordinates)) {
    endMarker = addEndpointMarker(
      data.destination_coordinates, "#f04438", `Destination ${data.destination_id}`
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
map.on("load", () => {
  loadDestinations();
  loadKmzLayers();
});

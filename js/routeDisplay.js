import { getGeoJSONBounds } from "./mapLayers.js";
import { hideRouteSummary } from "./ui.js";

let startMarker = null;
let endMarker = null;

// Collects all coordinate points from a GeoJSON FeatureCollection.
export function getAllCoordinates(geojson) {
  const points = [];

  function visit(coords) {
    if (!Array.isArray(coords)) return;
    if (coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") {
      points.push(coords);
      return;
    }
    coords.forEach(visit);
  }

  (geojson.features || []).forEach(feature => {
    if (feature.geometry) visit(feature.geometry.coordinates);
  });
  return points;
}

// Creates a labeled endpoint marker.
export function addEndpointMarker(map, coords, color, label) {
  const container = document.createElement("div");
  Object.assign(container.style, { position: "relative", width: "14px", height: "14px" });

  const node = document.createElement("div");
  Object.assign(node.style, {
    position: "absolute", left: "0", top: "0", width: "14px", height: "14px",
    boxSizing: "border-box", borderRadius: "50%", background: color,
    border: "2px solid white", boxShadow: "0 0 0 1px #344054"
  });

  const text = document.createElement("div");
  text.textContent = label;
  Object.assign(text.style, {
    position: "absolute", left: "22px", top: "50%", transform: "translateY(-50%)",
    color: "#000000", background: "#ffffff", border: "1px solid #d0d5dd",
    borderRadius: "3px", padding: "3px 6px", fontSize: "12px", fontWeight: "600",
    whiteSpace: "nowrap", boxShadow: "0 1px 3px rgba(0,0,0,0.2)"
  });

  container.appendChild(node);
  container.appendChild(text);
  return new maplibregl.Marker({ element: container, anchor: "center" })
    .setLngLat(coords)
    .addTo(map);
}

export function clearRoute(map) {
  if (map.getLayer("route-line")) map.removeLayer("route-line");
  if (map.getSource("route-source")) map.removeSource("route-source");
  if (startMarker) { startMarker.remove(); startMarker = null; }
  if (endMarker) { endMarker.remove(); endMarker = null; }
  hideRouteSummary();
  const diagnosticsPanel = document.getElementById("routingDiagnostics");
  const diagnosticsList = document.getElementById("diagnosticSteps");
  if (diagnosticsPanel) diagnosticsPanel.hidden = true;
  if (diagnosticsList) diagnosticsList.replaceChildren();
}

export function displayRoute(map, data) {
  map.addSource("route-source", { type: "geojson", data: data.route });
  map.addLayer({
    id: "route-line",
    type: "line",
    source: "route-source",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#175cd3", "line-width": 6, "line-opacity": 0.92 }
  });

  const coords = getAllCoordinates(data.route);
  if (!coords.length) return;

  const bounds = coords.reduce(
    (currentBounds, coordinate) => currentBounds.extend(coordinate),
    new maplibregl.LngLatBounds(coords[0], coords[0])
  );

  // Include the actual gate in the map bounds.
  if (Array.isArray(data.gate_coordinates)) bounds.extend(data.gate_coordinates);

  // Include and display the destination area, when supplied by the API.
  if (data.destination_area) {
    const areaFeature = {
      type: "Feature",
      properties: { name: data.destination_id },
      geometry: data.destination_area
    };

    const areaBounds = getGeoJSONBounds(areaFeature.geometry);
    bounds.extend([areaBounds[0], areaBounds[1]]);
    bounds.extend([areaBounds[2], areaBounds[3]]);

    if (map.getSource("destination-area")) {
      map.getSource("destination-area").setData(areaFeature);
    } else {
      map.addSource("destination-area", { type: "geojson", data: areaFeature });
      map.addLayer({
        id: "destination-area-fill",
        type: "fill",
        source: "destination-area",
        paint: { "fill-color": "#3388ff", "fill-opacity": 0.25 }
      });
      map.addLayer({
        id: "destination-area-outline",
        type: "line",
        source: "destination-area",
        paint: { "line-color": "#3388ff", "line-width": 2 }
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
    startMarker = addEndpointMarker(map, data.gate_coordinates, "#12b76a", `Gate ${data.gate_id}`);
  }
}

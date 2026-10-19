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
  clearDiagnosticMap(map);
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

export function displayDiagnosticMap(map, data) {
  const geojson = data.diagnostic_map;
  if (!geojson || !Array.isArray(geojson.features)) return;
  clearDiagnosticMap(map);
  map.addSource("routing-diagnostic-source", { type: "geojson", data: geojson });
  map.addLayer({ id: "inspection-lines", type: "line", source: "routing-diagnostic-source",
    filter: ["==", ["geometry-type"], "LineString"],
    paint: { "line-color": ["match", ["get", "kind"], "reachable_arc", "#175cd3", "gate_snap_link", "#12b76a", "destination_snap_link", "#f04438", "gate_connector", "#12b76a", "destination_connector", "#f04438", "#667085"], "line-width": ["match", ["get", "kind"], "reachable_arc", 4, "road_link", 1.5, 3], "line-opacity": ["match", ["get", "kind"], "road_link", 0.4, 0.9] }
  });
  map.addLayer({ id: "inspection-points", type: "circle", source: "routing-diagnostic-source", filter: ["==", ["geometry-type"], "Point"],
    paint: { "circle-radius": 7, "circle-color": ["match", ["get", "kind"], "gate", "#12b76a", "gate_snap", "#12b76a", "destination", "#f04438", "destination_snap", "#f79009", "#175cd3"], "circle-stroke-color": "#fff", "circle-stroke-width": 2 }
  });
  const popupContent = properties => {
    const box = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = properties.name || properties.link_id || properties.kind || "Map feature";
    box.appendChild(title);
    const pre = document.createElement("pre");
    pre.style.cssText = "max-width:300px;max-height:260px;overflow:auto;white-space:pre-wrap;font-size:11px";
    pre.textContent = JSON.stringify(properties, null, 2);
    box.appendChild(pre);
    return box;
  };
  for (const layer of ["inspection-lines", "inspection-points"]) {
    map.on("click", layer, event => {
      const feature = event.features && event.features[0];
      if (!feature) return;
      if (map.__inspectionPopup) map.__inspectionPopup.remove();
      map.__inspectionPopup = new maplibregl.Popup({ maxWidth: "340px" }).setLngLat(event.lngLat).setDOMContent(popupContent(feature.properties || {})).addTo(map);
    });
    map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
  }
  const update = () => {
    const stages = [...document.querySelectorAll("[data-inspection-stage]:checked")].map(el => el.dataset.inspectionStage);
    for (const layer of ["inspection-lines", "inspection-points"]) {
      map.setFilter(layer, ["all", ["==", ["geometry-type"], layer === "inspection-lines" ? "LineString" : "Point"], ["in", ["get", "stage"], ["literal", stages]]]);
    }
  };
  document.querySelectorAll("[data-inspection-stage]").forEach(el => { el.onchange = update; });
  update();
  document.getElementById("mapInspection").hidden = false;
}

export function clearDiagnosticMap(map) {
  if (map.__inspectionPopup) { map.__inspectionPopup.remove(); delete map.__inspectionPopup; }
  for (const layer of ["inspection-lines", "inspection-points"]) if (map.getLayer(layer)) map.removeLayer(layer);
  if (map.getSource("routing-diagnostic-source")) map.removeSource("routing-diagnostic-source");
  const panel = document.getElementById("mapInspection");
  if (panel) panel.hidden = true;
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

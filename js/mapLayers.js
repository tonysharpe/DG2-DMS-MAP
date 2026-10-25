"use strict";

function themeColor(property) {
  return getComputedStyle(document.documentElement).getPropertyValue(property).trim();
}

(async function initialiseBackgroundLayers() {
  const definitions = [
    {
      label: "Boundary",
      file: "data/boundary.geojson",
      pane: "siteBaseLayers",
      visible: true,
      interactive: false,
      style: {
        color: "#7189A8",
        weight: 1.4,
        opacity: 0.85,
        fillColor: "#DADCE0",
        fillOpacity: 0.08
      }
    },
    {
      label: "Communities",
      file: "data/communities.geojson",
      pane: "siteBaseLayers",
      visible: true,
      interactive: false,
      style: {
        color: "#9B85AF",
        weight: 1.2,
        opacity: 0.45,
        fillColor: "#B9A5C9",
        fillOpacity: 0.08
      }
    },
    {
      label: "Masterplan",
      file: "data/masterplan.geojson",
      pane: "siteBackground",
      visible: true,
      boundary: true,
      style: {
        color: "#DADCE0",
        weight: 0.7,
        fillColor: themeColor("--map-masterplan-fill"),
        fillOpacity: 0.22
      }
    }
  ];

  const wait = milliseconds => {
    return new Promise(resolve => {
      setTimeout(resolve, milliseconds);
    });
  };

  function warning(message) {
    console.warn(message);

    const element = document.getElementById("status");

    if (element) {
      element.textContent += "\n" + message;
    }
  }

  function pane(name, zIndex) {
    if (!map.getPane(name)) {
      map.createPane(name);
    }

    map.getPane(name).style.zIndex = String(zIndex);
  }

  function findLabel(properties) {
    const candidates = [
      "name", "Name", "NAME",
      "Road_Name", "ROAD_NAME", "RoadName", "road_name",
      "ShortName",
      "Label", "LABEL", "label",
      "Text", "TEXT", "text",
      "Plot_No", "ID", "id"
    ];

    for (const field of candidates) {
      const value = properties[field];

      if (
        value !== undefined &&
        value !== null &&
        String(value).trim() !== "" &&
        String(value) !== "<Null>"
      ) {
        return String(value);
      }
    }

    return "";
  }

  function addPopup(feature, layer, definition) {
    const container = document.createElement("div");

    const heading = document.createElement("strong");
    heading.textContent = definition.label;
    container.appendChild(heading);

    let count = 0;

    for (
      const [key, value]
      of Object.entries(feature.properties || {})
    ) {
      if (
        value === null ||
        value === undefined ||
        value === "" ||
        key.toLowerCase() === "description" ||
        typeof value === "object"
      ) {
        continue;
      }

      const row = document.createElement("div");
      const text = String(value);

      row.textContent =
        key + ": " +
        (text.length > 300 ? text.slice(0, 300) + "…" : text);

      container.appendChild(row);

      count += 1;

      if (count >= 15) {
        break;
      }
    }

    if (!count) {
      const row = document.createElement("div");
      row.textContent = "No descriptive attributes.";
      container.appendChild(row);
    }

    layer.bindPopup(container);

    // In map-origin mode, a background road click selects the origin rather
    // than showing its metadata popup. Outside that mode, popups still work.
    layer.off("click", layer._openPopup, layer);
    layer.on("click", event => {
      if (document.getElementById("startMode")?.value === "map") {
        // Let the map-level handler receive the click and set the origin.
        map.closePopup();
        return;
      }
      layer.openPopup(event.latlng);
    });
  }

  async function fetchLayerData(definition) {
    const response = await fetch(definition.file, {
      cache: "default"
    });

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    const data = await response.json();

    if (
      data.type !== "FeatureCollection" &&
      data.type !== "Feature"
    ) {
      throw new Error("Expected GeoJSON features");
    }

    return data;
  }

  function loadLayer(definition, control, data) {

    const interactive = definition.interactive !== false;

    const layerOptions = (style, isCasing = false) => ({
      pane: isCasing ? "siteReferenceRoadCasings" : definition.pane,
      interactive,
      smoothFactor: 1.5,
      style,

      pointToLayer: function (feature, latlng) {
        return L.circleMarker(latlng, {
          ...style,
          pane: definition.pane,
          radius: definition.showLabels ? 3 : 6,
          interactive
        });
      },

      onEachFeature: function (feature, featureLayer) {
        if (interactive) {
          addPopup(feature, featureLayer, definition);
        }

        if (definition.showLabels) {
          const label = findLabel(feature.properties || {});

          if (label) {
            const element = document.createElement("span");
            element.textContent = label;

            featureLayer.bindTooltip(element, {
              permanent: true,
              direction: "center",
              className: "site-road-label"
            });
          }
        }
      }
    });

    // Draw a wider casing beneath the road surface where a layer defines one.
    const casingLayer = definition.casingStyle
      ? L.geoJSON(data, layerOptions(definition.casingStyle, true))
      : null;
    const layer = L.geoJSON(data, layerOptions(definition.style));

    if (casingLayer) {
      layer.on("add", () => casingLayer.addTo(map));
      layer.on("remove", () => map.removeLayer(casingLayer));
    }

    control.addOverlay(layer, definition.label);

    if (definition.visible) {
      if (casingLayer) casingLayer.addTo(map);
      layer.addTo(map);
    }

    if (definition.boundary) {
      const bounds = layer.getBounds();

      if (bounds.isValid()) {
        siteBounds.extend(bounds);

        map.setMaxBounds(siteBounds.pad(1.5));

        map.setMinZoom(
          Math.max(
            0,
            map.getBoundsZoom(siteBounds.pad(1.5)) - 1
          )
        );

        /*
         * Do not interrupt a selected LAAR route if the
         * backgrounds finish loading after user selection.
         */
        if (
          typeof selectedAreaLayer === "undefined" ||
          !selectedAreaLayer
        ) {
          const initialCenter = typeof roadNetworkCenter === "function" ? roadNetworkCenter() : siteBounds.getCenter();
          const initialZoom = Math.log2(
            156543.03392804097 * Math.cos(initialCenter.lat * Math.PI / 180) *
            100 / 800
          );
          map.setView(initialCenter, initialZoom, { animate: false });
          const sidebarWidth = document.querySelector("body > aside")?.getBoundingClientRect().width || 0;
          const horizontalOffset = window.matchMedia("(max-width: 760px)").matches
            ? 0
            : sidebarWidth / 2;
          if (horizontalOffset) map.panBy([horizontalOffset, 0], { animate: false });
        }
      }
    }
  }

  let ready = false;

  for (let attempt = 0; attempt < 600; attempt++) {
    const destinationSelect = document.getElementById("end");

    if (
      typeof map !== "undefined" &&
      map &&
      typeof locations !== "undefined" &&
      locations.length &&
      destinationSelect &&
      !destinationSelect.disabled
    ) {
      ready = true;
      break;
    }

    await wait(100);
  }

  if (!ready) {
    warning(
      "Background layers did not load because routing " +
      "initialisation did not complete."
    );
    return;
  }

  pane("siteBaseLayers", 210);
  pane("siteBackground", 250);
  pane("siteReferenceRoadCasings", 290);
  pane("siteReferenceRoads", 300);
  pane("siteFacilities", 320);
  pane("siteReferenceLabels", 350);

  const control = L.control.layers(
    null,
    {},
    { collapsed: true }
  ).addTo(map);
  window.laarLayerControl = control;

  if (typeof displayedRoadLayer !== "undefined" && displayedRoadLayer) {
    control.addOverlay(displayedRoadLayer, "Roads");
  }
  if (typeof gateMarkerLayer !== "undefined" && gateMarkerLayer) {
    control.addOverlay(gateMarkerLayer, "Gates");
  }

  const errors = [];

  // Download and parse background GeoJSON concurrently, then add layers
  // in their declared order so the layer-control ordering remains stable.
  const loadedData = await Promise.all(definitions.map(async definition => {
    try {
      return { definition, data: await fetchLayerData(definition) };
    } catch (error) {
      errors.push(definition.label + ": " + error.message);
      console.error("Could not load " + definition.file, error);
      return { definition, error };
    }
  }));

  for (const item of loadedData) {
    if (item.error) continue;

    try {
      loadLayer(item.definition, control, item.data);
    } catch (error) {
      errors.push(item.definition.label + ": " + error.message);
      console.error("Could not render " + item.definition.file, error);
    }
  }

  if (errors.length) {
    warning(
      "Background warnings:\n" +
      errors.join("\n")
    );
  }
})();

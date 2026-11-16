"use strict";

(async function initialiseBackgroundLayers() {
  const definitions = [
    {
      label: "Boundary",
      file: "data/boundary.geojson",
      pane: "siteBoundary",
      visible: true,
      interactive: false,
      style: {
        color: themeColor("--map-boundary-stroke"),
        weight: themeNumber("--map-boundary-stroke-width"),
        opacity: themeNumber("--map-boundary-stroke-opacity"),
        dashArray: themeColor("--map-boundary-dash-array"),
        lineCap: themeColor("--map-boundary-line-cap"),
        fillColor: themeColor("--map-boundary-fill"),
        fillOpacity: themeNumber("--map-boundary-fill-opacity")
      }
    },
    {
      label: "Communities",
      file: "data/communities.geojson",
      pane: "siteCommunities",
      visible: true,
      interactive: false,
      style: {
        color: themeColor("--map-communities-stroke"),
        weight: themeNumber("--map-communities-stroke-width"),
        opacity: themeNumber("--map-communities-stroke-opacity"),
        dashArray: themeColor("--map-communities-dash-array"),
        lineCap: themeColor("--map-communities-line-cap"),
        fillColor: themeColor("--map-communities-fill"),
        fillOpacity: themeNumber("--map-communities-fill-opacity")
      }
    },
    {
      label: "Masterplan",
      file: "data/masterplan.geojson",
      pane: "siteBackground",
      visible: true,
      boundary: true,
      style: {
        color: themeColor("--map-masterplan-stroke"),
        weight: themeNumber("--map-masterplan-stroke-width"),
        opacity: themeNumber("--map-masterplan-stroke-opacity"),
        dashArray: themeColor("--map-masterplan-dash-array"),
        lineCap: themeColor("--map-masterplan-line-cap"),
        fillColor: themeColor("--map-masterplan-fill"),
        fillOpacity: themeNumber("--map-masterplan-fill-opacity")
      }
    },
    {
      id: "roadNames",
      label: "Road Names",
      file: "data/road_names.geojson",
      pane: "siteReferenceLabels",
      visible: true,
      interactive: false,
      showLabels: true,
      labelField: "RoadName",
      style: {
        radius: 0,
        opacity: 0,
        fillOpacity: 0,
        weight: 0
      }
    }
  ];

  window.roadNameLabelsVisible = window.roadNameLabelsVisible === true;

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

  function findLabel(properties, preferredField) {
    const candidates = [
      ...(preferredField ? [preferredField] : []),
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

  async function fetchLayerData(definition) {
    const startedAt = performance.now();
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

    window.recordMapLoadTiming?.("Load and parse background " + definition.file, startedAt);
    return data;
  }

  function loadLayer(definition, data) {

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
        if (definition.showLabels) {
          const label = findLabel(feature.properties || {}, definition.labelField);

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

    if (definition.id === "roadNames") {
      window.setRoadNameLabelsVisible = function (visible) {
        window.roadNameLabelsVisible = Boolean(visible);
        if (window.roadNameLabelsVisible) {
          if (!map.hasLayer(layer)) layer.addTo(map);
        } else if (map.hasLayer(layer)) {
          map.removeLayer(layer);
        }
      };
      const checkbox = document.getElementById("roadNameLabelsToggle");
      if (checkbox) checkbox.checked = window.roadNameLabelsVisible === true;
    }

    if (
      definition.visible &&
      (definition.id !== "roadNames" || window.roadNameLabelsVisible !== false)
    ) {
      if (casingLayer) casingLayer.addTo(map);
      layer.addTo(map);
    }

    if (definition.boundary) {
      const bounds = layer.getBounds();

      if (bounds.isValid()) {
        siteBounds.extend(bounds);

        // Do not constrain the map camera to the site boundary. Users may
        // zoom out or pan freely; app.js owns the initial boundary fit and
        // routeDisplay.js frames only explicitly selected destinations.
      }
    }
  }

  // Wait only for the initial road map to be visible. Background layers do
  // not depend on the routing graph and should render while it is building.
  const backgroundRenderStartedAt = performance.now();
  const mapWaitStartedAt = performance.now();
  if (!window.initialMapGeometryReady) {
    await new Promise(resolve => {
      document.addEventListener("laar-initial-map-rendered", resolve, { once: true });
    });
  }
  window.recordMapLoadTiming?.("Wait for initial map geometry before background layers", mapWaitStartedAt);

  pane("siteBoundary", 200);
  pane("siteCommunities", 220);
  pane("siteBackground", 250);
  pane("siteReferenceRoadCasings", 290);
  pane("siteReferenceRoads", 300);
  pane("siteFacilities", 320);
  pane("siteReferenceLabels", 350);

  const errors = [];

  // Download and parse background GeoJSON concurrently, then render in declared order.
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
      loadLayer(item.definition, item.data);
    } catch (error) {
      errors.push(item.definition.label + ": " + error.message);
      console.error("Could not render " + item.definition.file, error);
    }
  }

  window.recordMapLoadTiming?.("Render background map layers", backgroundRenderStartedAt);
  if (errors.length) {
    warning(
      "Background warnings:\n" +
      errors.join("\n")
    );
  }
})();

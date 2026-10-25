function themeColor(property) {
  return getComputedStyle(document.documentElement).getPropertyValue(property).trim();
}

function showDestinationArea(destination) {
  const matching = destinationAreas.get(destination.name);

  if (!matching?.length) {
    throw new Error(
      "No polygon matches '" + destination.name +
      "'. Check the exact Name values."
    );
  }

  selectedAreaLayer = L.geoJSON(
    { type: "FeatureCollection", features: matching },
    {
      pane: "selectedLaarPane",

      style: {
        color: themeColor("--map-area-outline"),
        weight: 2.5,
        opacity: 1,
        fillColor: themeColor("--map-area-fill"),
        fillOpacity: 0.30,
        lineCap: "round",
        lineJoin: "round"
      },

      onEachFeature: (feature, layer) => {
        const label = document.createElement("span");
        label.textContent = destination.name;

        layer.bindTooltip(label, {
          direction: "top",
          className: "selected-laar-tooltip"
        });
      }
    }
  ).addTo(map);
}

function fitSelectedResult() {
  let bounds = null;

  for (const layer of [selectedAreaLayer, routeLayer]) {
    if (!layer) continue;

    const layerBounds = layer.getBounds();

    if (!layerBounds.isValid()) continue;

    if (bounds) {
      bounds.extend(layerBounds);
    } else {
      bounds = L.latLngBounds(
        layerBounds.getSouthWest(),
        layerBounds.getNorthEast()
      );
    }
  }

  if (bounds?.isValid()) {
    map.fitBounds(bounds.pad(0.15), {
      animate: false
    });
  }
}

/* ROAD GEOMETRY — ALSO USED BY live-location.js */

function showRouteSummary(destination, start, metres, seconds, roadNames, liveMode) {
  $("summaryDestination").textContent = destination.name;
  $("summaryStart").textContent = start.location.name;

  $("summaryDistance").textContent = metres >= 1000
    ? (metres / 1000).toFixed(2) + " km"
    : metres.toFixed(0) + " m";

  $("summaryTime").textContent =
    (seconds / 60).toFixed(1) + " min";

  if ($("journeyControls")) $("journeyControls").hidden = $("startMode")?.value !== "live";
  // A reroute during an active journey must not reset the Start/Stop controls.
  if (!liveNavigationActive) {
    if ($("startLiveRoute")) $("startLiveRoute").hidden = false;
    if ($("stopLiveRoute")) $("stopLiveRoute").hidden = true;
    if ($("journeyGuidance")) $("journeyGuidance").hidden = true;
  }

  $("routeDetails").textContent =
    "Roads: " +
    (roadNames.length ? roadNames.join(" → ") : "Same network node") +
    "\n\nStart-to-road offset: " +
    start.location.offset.toFixed(1) + " m" +
    "\nDestination centroid-to-road offset: " +
    destination.offset.toFixed(1) + " m" +
    "\n\nRoutes end at the centroid's nearest road position, " +
    "not necessarily an approved entrance. Off-road gaps, " +
    "small connection gaps, queues and delays are excluded." +
    (liveMode
      ? "\n\nLive navigation follows your GPS position. " +
        "With GPS accuracy of 50 m or better, the route is recalculated when you are more than 75 m off route."
      : "");

  $("routeSummary").hidden = false;
}


/* CLEAR RESULT — USED BY live-location.js */

function clearRoute() {
  if (startConnectorLayer) {
    map.removeLayer(startConnectorLayer);
    startConnectorLayer = null;
  }

  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }

  if (routeOutlineLayer) {
    map.removeLayer(routeOutlineLayer);
    routeOutlineLayer = null;
  }

  if (selectedAreaLayer) {
    map.removeLayer(selectedAreaLayer);
    selectedAreaLayer = null;
  }

  if ($("routeSummary")) {
    $("routeSummary").hidden = true;
  }

  updateGateHighlights();
}


/* ROUTING */

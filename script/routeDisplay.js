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
        fillOpacity: Number.parseFloat(themeColor("--map-area-fill-opacity")) / 100,
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

function fitSelectedResult(includeStart = false) {
  // Keep the boundary view authoritative while startup route rendering is in progress.
  if (window.laarInitialMapViewPending) return;

  let bounds = null;

  const extendBounds = candidate => {
    if (!candidate?.isValid?.()) return;
    if (bounds) {
      bounds.extend(candidate);
    } else {
      bounds = L.latLngBounds(candidate.getSouthWest(), candidate.getNorthEast());
    }
  };

  for (const layer of [selectedAreaLayer, routeLayer]) {
    if (!layer) continue;
    extendBounds(layer.getBounds());
  }

  // When no route exists, frame the destination area together with its
  // applicable origin so the user can see both ends of the failed journey.
  if (includeStart) {
    const startMode = $("startMode")?.value || "live";
    if (startMode === "live" && livePosition) {
      const point = L.latLng(livePosition.latitude, livePosition.longitude);
      extendBounds(L.latLngBounds(point, point));
    } else if (startMode === "map" && mapClickOrigin?.point) {
      const point = L.latLng(ll(mapClickOrigin.point));
      extendBounds(L.latLngBounds(point, point));
    }
  }

  if (bounds?.isValid()) {
    const targetBounds = bounds.pad(0.15);
    const currentZoom = map.getZoom();
    const targetZoom = map.getBoundsZoom(targetBounds, false);
    const zoomChange = targetZoom - currentZoom;
    const zoomMagnitude = Math.abs(zoomChange);

    // Scale transition time with the size and direction of the zoom change.
    // Large zoom-ins take slightly longer to keep the approach readable;
    // zoom-outs remain a little quicker while still feeling smooth.
    const secondsPerZoomLevel = zoomChange > 0 ? 0.34 : 0.29;
    const duration = Math.max(
      0.7,
      Math.min(2.5, 0.7 + zoomMagnitude * secondsPerZoomLevel)
    );

    map.fitBounds(targetBounds, {
      animate: true,
      duration,
      easeLinearity: 0.25
    });
  }
}

/* ROAD GEOMETRY — ALSO USED BY live-location.js */

/* CLEAR RESULT — USED BY live-location.js */

function clearRoute() {
  window.laarRouteAvailable = false;
  document.dispatchEvent(new CustomEvent("laar-route-state-change"));
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

}


/* ROUTING */

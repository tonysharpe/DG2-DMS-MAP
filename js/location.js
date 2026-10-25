"use strict";

function themeColor(property) {
  return getComputedStyle(document.documentElement).getPropertyValue(property).trim();
}

let locationWatchId = null;
let livePosition = null;
let previousHeadingPosition = null;
let liveHeadingDegrees = null;
let nextRouteBearing = null;
let journeyStartConfirmed = false;
let liveLocationMarker = null;
// GPS accuracy buffer intentionally removed; the live marker is the sole location cue.
let liveAccuracyCircle = null;
let liveNavigationActive = false;
let lastLiveRouteAttemptAt = 0;
let lastLiveRerouteAt = 0;
const LIVE_ROUTE_DEVIATION_METRES = 75;
const LIVE_ROUTE_MIN_ACCURACY_METRES = 50;
const LIVE_REROUTE_COOLDOWN_MS = 15000;
const LIVE_ROUTE_ATTEMPT_COOLDOWN_MS = 15000;
const LIVE_FOLLOW_ZOOM = 19; // Close navigation view, centred on the live route start.
let mapClickOrigin = null;
let mapClickOriginMarker = null;
const MAP_CLICK_BUFFER_METRES = 15000;
const MAIN_ROAD_40_PERCENT_BUFFER_METRES = 50;
let locationWatchGeneration = 0;
const LIVE_LOCATION_MAX_AGE = 60000;

function locationStatus(text) {
  const element = $("locationStatus");
  if (element) element.textContent = text;
}

function removeMapClickOrigin() {
  mapClickOrigin = null;
  if (mapClickOriginMarker) {
    map.removeLayer(mapClickOriginMarker);
    mapClickOriginMarker = null;
  }
}

/*
 * MAP-CLICK ORIGIN SELECTION
 *
 * The vehicle-specific network is built in app.js. Therefore `roads`
 * already contains only links permitted for the active vehicle.
 * Initially select the geographically nearest permitted link within 15 km.
 * If it cannot route to the selected destination, prepareRoutingStart()
 * searches permitted links within 15 km for the closest routeable alternative.
 */
function chooseMapClickRoad(clickedPoint) {
  let best = null;

  for (const road of roads) {
    const projection = nearest(clickedPoint, road.pts);
    if (!Number.isFinite(projection.offset) || projection.offset > MAP_CLICK_BUFFER_METRES) continue;

    if (!best || projection.offset < best.projection.offset) {
      best = { road, projection };
    }
  }

  return best;
}

/*
 * Return the shortest directed network distance from a projection on a road
 * to a destination node. This is used only to evaluate the optional map-click
 * main-road override; failures simply make that candidate ineligible.
 */
function routeDistanceFromRoadProjection(road, projection, destinationNode) {
  if (!road || !Number.isFinite(projection?.m) ||
      destinationNode === null || destinationNode === undefined) return Infinity;

  // Match the final route graph: the global adjacency can contain links
  // excluded from the active vehicle network. Testing against those links can
  // falsely mark a click candidate as routeable, only for calculate() to fail.
  const allowedRoadIds = new Set(roads.map(candidate => candidate.id));
  let graph = new Map([...adjacency].map(([id, edges]) => [
    id, edges.filter(edge => allowedRoadIds.has(edge.roadId))
  ]));
  let startNode;
  const existingCut = road.cuts.find(cut =>
    Math.abs(cut.m - projection.m) <= ROAD_CUT_TOLERANCE);

  if (existingCut) {
    startNode = existingCut.node;
  } else {
    const cuts = [...road.cuts].sort((a, b) => a.m - b.m);
    let before = null;
    let after = null;
    for (let i = 0; i < cuts.length - 1; i++) {
      if (cuts[i].m < projection.m && projection.m < cuts[i + 1].m) {
        before = cuts[i];
        after = cuts[i + 1];
        break;
      }
    }
    if (!before || !after || !adjacency.has(before.node) || !adjacency.has(after.node)) {
      return Infinity;
    }

    graph = new Map([...adjacency].map(([id, edges]) => [
      id, edges.filter(edge => allowedRoadIds.has(edge.roadId))
    ]));
    startNode = "__main_road_test";
    while (graph.has(startNode)) startNode += "_";
    graph.set(startNode, []);
    graph.set(before.node, graph.get(before.node).filter(edge =>
      !(edge.roadId === road.id && edge.to === after.node)));
    graph.set(after.node, graph.get(after.node).filter(edge =>
      !(edge.roadId === road.id && edge.to === before.node)));

    const temporaryCut = {m: projection.m, node: startNode};
    const addSegment = (a, b) => {
      const length = road.length * (b.m - a.m) /
        road.ms[road.ms.length - 1];
      const seconds = length / (road.speedKmh / 3.6);
      const points = section(road, a.m, b.m);
      if (road.direction !== "reverse") {
        graph.get(a.node).push({
          to: b.node, length, seconds, weight: length, pts: points,
          name: road.name, roadId: road.id
        });
      }
      if (road.direction !== "forward") {
        graph.get(b.node).push({
          to: a.node, length, seconds, weight: length, pts: [...points].reverse(),
          name: road.name, roadId: road.id
        });
      }
    };
    addSegment(before, temporaryCut);
    addSegment(temporaryCut, after);
  }

  const distances = new Map([[startNode, 0]]);
  const visited = new Set();
  while (true) {
    let current = null;
    let currentDistance = Infinity;
    for (const [node, value] of distances) {
      if (!visited.has(node) && value < currentDistance) {
        current = node;
        currentDistance = value;
      }
    }
    if (current === null) return Infinity;
    if (current === destinationNode) return currentDistance;
    visited.add(current);
    for (const edge of graph.get(current) || []) {
      if (edge.roadId !== undefined && edge.roadId !== null &&
          typeof routeDebugRoadIds !== "undefined") {
        routeDebugRoadIds.add(edge.roadId);
      }
      if (visited.has(edge.to)) continue;
      const nextDistance = currentDistance + edge.seconds;
      if (nextDistance < (distances.get(edge.to) ?? Infinity)) {
        distances.set(edge.to, nextDistance);
      }
    }
  }
}

function setMapClickOrigin(latlng) {
  if ($("startMode")?.value !== "map") return;
  // Keep map-click mode active after selection so the origin can be moved.
  if (typeof setMapClickHitAreaEnabled === "function") setMapClickHitAreaEnabled(true);

  const clickedPoint = xy([latlng.lng, latlng.lat]);
  const choice = chooseMapClickRoad(clickedPoint);
  if (!choice) {
    const message = "No road permitted for " + vehicleMode +
      " was found within 15 km of this point.";
    locationStatus("Map origin rejected: " + message);
    status("Origin not changed. Click elsewhere on the map.");
    return;
  }

  const { road: selectedRoad, projection } = choice;
  mapClickOrigin = {
    point: clickedPoint,
    snapPoint: [...projection.q],
    offset: projection.offset,
    measure: projection.m,
    attachedRoadId: selectedRoad.id,
    originalAttachedRoadId: selectedRoad.id,
    originalSnapPoint: [...projection.q],
    roadName: selectedRoad.name
  };

  if (mapClickOriginMarker) map.removeLayer(mapClickOriginMarker);
  mapClickOriginMarker = L.circleMarker(latlng, {
    radius: 8,
    color: themeColor("--map-location-outline"),
    weight: 3,
    fillColor: themeColor("--map-location"),
    fillOpacity: 1,
    pane: "markerPane"
  }).addTo(map);
  mapClickOriginMarker.bindTooltip("Map origin — snapped to " + selectedRoad.name, { direction: "top" });

  locationStatus(
    "Map origin selected. Snapped " + projection.offset.toFixed(1) +
    " m to " + selectedRoad.name + "."
  );
  if (typeof renderDestinationOptions === "function") renderDestinationOptions();
  if ($("end")?.value) {
    status("Origin set. Updating the selected LAAR route…");
    calculate(true);
  } else {
    const prompt = "Origin set. Next, select your LAAR destination.";
    status(prompt);
    if ($("searchStatus")) $("searchStatus").textContent = prompt;
    $("destinationSearch")?.focus();
  }
}

function removeLiveLocationLayers() {
  if (liveLocationMarker) {
    map.removeLayer(liveLocationMarker);
    liveLocationMarker = null;
  }
  if (liveAccuracyCircle) {
    map.removeLayer(liveAccuracyCircle);
    liveAccuracyCircle = null;
  }
}

function stopLiveLocation(showMessage = true) {
  locationWatchGeneration += 1;
  if (locationWatchId !== null) {
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
  }
  livePosition = null;
  liveNavigationActive = false;
  journeyStartConfirmed = false;
  previousHeadingPosition = null;
  liveHeadingDegrees = null;
  if ($("journeyGuidance")) $("journeyGuidance").hidden = true;
  if ($("journeyStage")) $("journeyStage").textContent = "Journey ended";
  if ($("startLiveRoute")) $("startLiveRoute").hidden = false;
  if ($("stopLiveRoute")) $("stopLiveRoute").hidden = true;
  lastLiveRouteAttemptAt = 0;
  lastLiveRerouteAt = 0;
  removeLiveLocationLayers();
  if ($("stopLocation")) $("stopLocation").disabled = true;
  if ($("startMode")?.value === "live") {
    clearRoute();
    $("start").selectedIndex = -1;
    status("Live location stopped. Start it again, or choose Best gate — automatic.");
  }
  if (showMessage) locationStatus("Live location is off.");
}

function bearingDegrees(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const p1 = lat1 * rad, p2 = lat2 * rad, dLon = (lon2 - lon1) * rad;
  const y = Math.sin(dLon) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) -
    Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function updateLiveMarkerHeading() {
  if (!liveLocationMarker || liveHeadingDegrees === null) return;
  const element = liveLocationMarker.getElement();
  if (!element) return;
  element.classList.add("laar-live-heading-marker");
  element.style.setProperty("--laar-live-heading", liveHeadingDegrees + "deg");
  element.setAttribute("aria-label", "Live location, facing direction");
}

function updateJourneyGuidance() {
  updateLiveMarkerHeading();
  const hud = $("journeyGuidance");
  if (!hud || !livePosition || !routeLayer) return;
  const points = routeLayer.getLatLngs();
  if (!Array.isArray(points) || points.length < 2) return;
  let nearestIndex = 0, nearestDistance = Infinity;
  points.forEach((point, index) => {
    const d = map.distance([livePosition.latitude, livePosition.longitude], point);
    if (d < nearestDistance) { nearestDistance = d; nearestIndex = index; }
  });
  const next = points[Math.min(nearestIndex + 1, points.length - 1)];
  if (next) {
    nextRouteBearing = bearingDegrees(
      livePosition.latitude, livePosition.longitude, next.lat, next.lng
    );
  }
  // The marker represents direction of travel from GPS heading or
  // recent movement, not the next route segment. Route bearing is guidance only.
  updateLiveMarkerHeading();
  hud.hidden = !journeyStartConfirmed;
}

function startLiveRoute() {
  if (!livePosition) {
    locationStatus("Waiting for GPS. Allow location access, then try Start route again.");
    return;
  }
  if (!routeLayer) {
    locationStatus("Choose a LAAR destination and wait for the route preview before starting.");
    return;
  }
  confirmBeginJourney();
}

function stopLiveRoute() {
  liveNavigationActive = false;
  journeyStartConfirmed = false;
  if ($("journeyStage")) $("journeyStage").textContent = "Routing stopped";
  if ($("journeyGuidance")) $("journeyGuidance").hidden = true;
  if ($("startLiveRoute")) $("startLiveRoute").hidden = false;
  if ($("stopLiveRoute")) $("stopLiveRoute").hidden = true;
  locationStatus("Routing stopped. Your location is still being tracked; start the route again or use Stop location to turn GPS off.");
}

function confirmBeginJourney() {
  if (!livePosition || !routeLayer) {
    locationStatus("Wait for GPS and a calculated route before beginning.");
    return;
  }
  journeyStartConfirmed = true;
  liveNavigationActive = true;
  if ($("journeyStage")) $("journeyStage").textContent = "Journey started";
  if ($("journeyGuidance")) $("journeyGuidance").hidden = false;
  if ($("startLiveRoute")) $("startLiveRoute").hidden = true;
  if ($("stopLiveRoute")) $("stopLiveRoute").hidden = false;
  updateJourneyGuidance();
  followLiveLocation();
}

function followLiveLocation() {
  if (!livePosition || $("startMode")?.value !== "live") return;

  // Follow the GPS marker while navigation is active; users can pan away
  // and use the recenter control to return to their current position.
  if (liveNavigationActive) {
    map.setView(
      [livePosition.latitude, livePosition.longitude],
      LIVE_FOLLOW_ZOOM,
      {animate: false}
    );
  }

  if (!$("end")?.value) return;

  // If the destination was selected before the first GPS fix, build the
  // initial route once a usable position becomes available.
  if (!routeLayer) {
    if (Date.now() - lastLiveRouteAttemptAt < LIVE_ROUTE_ATTEMPT_COOLDOWN_MS) return;
    lastLiveRouteAttemptAt = Date.now();
    calculate();
    return;
  }

  // After routing is stopped, retain the GPS marker but do not auto-follow
  // the camera or recalculate the route for off-route movement.
  if (!liveNavigationActive) return;

  // Ignore noisy fixes; only reroute when the GPS fix is sufficiently
  // accurate and materially off the currently displayed route.
  if (livePosition.accuracy > LIVE_ROUTE_MIN_ACCURACY_METRES) return;
  const latlngs = routeLayer.getLatLngs();
  if (!Array.isArray(latlngs) || latlngs.length < 2 || !latlngs[0]?.lat) return;

  const routePoints = latlngs.map(point => xy([point.lng, point.lat]));
  const projection = nearest(livePosition.point, routePoints);
  if (!Number.isFinite(projection.offset) ||
      projection.offset <= LIVE_ROUTE_DEVIATION_METRES) return;

  const now = Date.now();
  if (now - lastLiveRerouteAt < LIVE_REROUTE_COOLDOWN_MS) return;
  lastLiveRerouteAt = now;
  locationStatus(
    "You appear to be off the planned route (" +
    Math.round(projection.offset) + " m). Recalculating…"
  );
  calculate();
}

function startLiveLocation() {
  if ($("startMode").value !== "live") $("startMode").value = "live";
  removeMapClickOrigin();
  stopLiveLocation(false);
  clearRoute();
  $("start").selectedIndex = -1;
  if (!window.isSecureContext) {
    locationStatus("Location requires HTTPS or a trusted localhost page.");
    return;
  }
  if (!navigator.geolocation) {
    locationStatus("This browser does not support location access.");
    return;
  }
  locationStatus("Requesting your location. Allow access when prompted.");
  status("Waiting for your location. Once available, select a LAAR or click the route button.");
  const generation = locationWatchGeneration;
  try {
    locationWatchId = navigator.geolocation.watchPosition(
      position => {
        if (generation !== locationWatchGeneration || $("startMode").value !== "live") return;
        const {latitude, longitude, accuracy} = position.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
            !Number.isFinite(accuracy) || accuracy < 0) {
          locationStatus("The browser returned an invalid location.");
          return;
        }
        if (Number.isFinite(position.coords.heading) && position.coords.speed > 0.5) {
          liveHeadingDegrees = (position.coords.heading + 360) % 360;
        } else if (previousHeadingPosition) {
          const moved = dist(
            xy([previousHeadingPosition.longitude, previousHeadingPosition.latitude]),
            xy([longitude, latitude])
          );
          if (moved >= 3) {
            liveHeadingDegrees = bearingDegrees(
              previousHeadingPosition.latitude, previousHeadingPosition.longitude,
              latitude, longitude
            );
          }
        }
        previousHeadingPosition = {latitude, longitude};
        livePosition = {
          latitude, longitude, accuracy,
          timestamp: position.timestamp,
          point: xy([longitude, latitude])
        };
        // Re-evaluate LAAR options once GPS is available; startMode changes
        // initially run before the asynchronous geolocation callback arrives.
        if (typeof renderDestinationOptions === "function") {
          renderDestinationOptions();
        }
        const latlng = [latitude, longitude];
        if (!liveLocationMarker) {
          liveLocationMarker = L.marker(latlng, {
            icon: L.divIcon({
              className: "laar-live-heading-marker",
              html: '<span class="laar-live-heading-arrow" aria-hidden="true"></span><span class="laar-live-heading-core" aria-hidden="true"></span>',
              iconSize: [32, 42],
              iconAnchor: [16, 22]
            }),
            zIndexOffset: 1000,
            keyboard: false
          }).addTo(map);
          liveLocationMarker.bindTooltip("My live location", {direction: "top"});
        } else {
          liveLocationMarker.setLatLng(latlng);
        }
        // No accuracy circle: keep the map clean and make the 2D position marker prominent.
        $("stopLocation").disabled = false;
        updateJourneyGuidance();
        followLiveLocation();
        locationStatus(journeyStartConfirmed ? "Journey started" : "Journey ended");
      },
      error => {
        if (generation !== locationWatchGeneration || $("startMode").value !== "live") return;
        const messages = {
          1: "Location permission was denied. Allow location in your browser's site settings, then retry.",
          2: "Your location is currently unavailable. Check device location services and retry.",
          3: "The location request timed out. Wait for another update or retry."
        };
        locationStatus(messages[error.code] || "Location error: " + error.message);
        if (error.code === 1) stopLiveLocation(false);
      },
      {enableHighAccuracy: true, timeout: 20000, maximumAge: 0}
    );
    $("stopLocation").disabled = false;
  } catch (error) {
    stopLiveLocation(false);
    locationStatus("Cannot start live location: " + error.message);
  }
}

function recenterMapOnStart() {
  if (!map) return;

  if ($("startMode")?.value === "live") {
    if (!livePosition) {
      locationStatus("Waiting for a live GPS fix before centring the map.");
      return;
    }
    map.setView([livePosition.latitude, livePosition.longitude], Math.max(map.getZoom(), 16), {animate: true});
    return;
  }

  if ($("startMode")?.value === "map" && mapClickOrigin?.point) {
    map.setView(L.latLng(ll(mapClickOrigin.point)), Math.max(map.getZoom(), 16), {animate: true});
    return;
  }

  const selectedValue = $("start")?.value;
  const selectedIndex = selectedValue === "" || selectedValue == null ? NaN : Number(selectedValue);
  if (Number.isInteger(selectedIndex) && locations[selectedIndex]?.point) {
    map.setView(L.latLng(ll(locations[selectedIndex].point)), Math.max(map.getZoom(), 16), {animate: true});
    return;
  }

  if (routeLayer && typeof routeLayer.getBounds === "function" && routeLayer.getLayers().length) {
    const bounds = routeLayer.getBounds();
    if (bounds.isValid()) {
      const first = bounds.getCenter();
      map.setView(first, Math.max(map.getZoom(), 15), {animate: true});
      return;
    }
  }

  locationStatus("Select a start point or enable My location first.");
}

function addRecenterControl() {
  if (!map || map._laarRecenterControl) return;
  const control = L.control({position: "topleft"});
  control.onAdd = function () {
    const button = L.DomUtil.create("button", "laar-recenter-control");
    button.type = "button";
    button.title = "Return to start point or live location";
    button.setAttribute("aria-label", "Return to start point or live location");
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    L.DomEvent.disableClickPropagation(button);
    L.DomEvent.on(button, "click", recenterMapOnStart);
    return button;
  };
  control.addTo(map);
  map._laarRecenterControl = control;
}

// A live route is initially an overview. Camera-following starts only
// after the user explicitly confirms Begin journey.
const calculateRouteForJourney = calculate;
calculate = function () {
  const result = calculateRouteForJourney.apply(this, arguments);
  if ($("startMode")?.value === "live" && routeLayer && !liveNavigationActive) {
    if ($("journeyStage")) {
      $("journeyStage").textContent =
        "Route preview ready. Start when you are ready.";
    }
  }
  return result;
};

function initialiseLocationControls() {
  $("startLiveRoute")?.addEventListener("click", startLiveRoute);
  $("stopLiveRoute")?.addEventListener("click", stopLiveRoute);
  for (const id of ["startMode", "locate", "stopLocation", "locationStatus"]) {
    if (!$(id)) throw new Error("index.html is missing element id='" + id + "'.");
  }
  addRecenterControl();
  $("startMode").disabled = false;
  $("locate").disabled = true;
  $("stopLocation").disabled = true;
  $("startMode").onchange = () => {
    clearRoute();
    $("start").selectedIndex = -1;
    if ($("startMode").value === "live") {
      if (typeof setMapClickHitAreaEnabled === "function") setMapClickHitAreaEnabled(false);
      removeMapClickOrigin();
      $("locate").disabled = false;
      startLiveLocation();
    } else if ($("startMode").value === "map") {
      stopLiveLocation(false);
      if (typeof setMapClickHitAreaEnabled === "function") setMapClickHitAreaEnabled(true);
      $("locate").disabled = true;
      $("stopLocation").disabled = true;
      removeMapClickOrigin();
      map.closePopup();
      locationStatus("Click anywhere on the map. The origin snaps to the nearest road permitted for the selected vehicle within 15 km. The route follows mapped connections and road directions.");
      status("Step 1 of 2: click anywhere on the map to set the origin.");
    } else {
      if (typeof setMapClickHitAreaEnabled === "function") setMapClickHitAreaEnabled(false);
      stopLiveLocation();
      removeMapClickOrigin();
      $("locate").disabled = true;
      if ($("end").value !== "") calculate();
      else status("Gate mode selected. Select a LAAR destination.");
    }
  };
  $("locate").onclick = startLiveLocation;
  $("stopLocation").onclick = () => stopLiveLocation();
  $("route").textContent = "Show Route";
  window.addEventListener("pagehide", () => stopLiveLocation(false));
}

function prepareRoutingStart() {
  const startMode = $("startMode").value;
  if (startMode === "map" && !mapClickOrigin) {
    throw new Error("Click anywhere on the map to set an origin.");
  }
  if (startMode !== "live" && startMode !== "map") {
    const sources = locations
      .map((location, index) => ({location, index}))
      .filter(item => item.location.kind === "gate" && item.location.valid &&
        adjacency.has(item.location.node));
    if (!sources.length) throw new Error("No valid starting gates.");
    return {graph: adjacency, sources};
  }
  if (startMode === "live" && !livePosition) {
    throw new Error("Your location is not available. Start live location and allow access.");
  }
  if (startMode === "live" && Date.now() - livePosition.timestamp > LIVE_LOCATION_MAX_AGE) {
    throw new Error("Your location reading is older than 60 seconds. Wait for a new reading or retry live location.");
  }
  const snapshot = startMode === "map"
    ? { point: [...mapClickOrigin.point], accuracy: 0, timestamp: Date.now() }
    : {...livePosition, point: [...livePosition.point]};
  let nearestMappedRoad = null;
  if (startMode === "map") {
    // Re-evaluate against the active vehicle network when routing starts.
    const choice = chooseMapClickRoad(snapshot.point);
    if (!choice) {
      throw new Error("No road permitted for " + vehicleMode + " was found within 15 km of the selected map point.");
    }
    nearestMappedRoad = { candidate: choice.road, ...choice.projection };
    mapClickOrigin = {
      ...mapClickOrigin,
      snapPoint: [...choice.projection.q],
      offset: choice.projection.offset,
      measure: choice.projection.m,
      attachedRoadId: choice.road.id,
      originalAttachedRoadId: choice.road.id,
      originalSnapPoint: [...choice.projection.q],
      roadName: choice.road.name
    };
  } else {
    for (const candidate of allRoadCandidates) {
      const projection = nearest(snapshot.point, candidate.pts);
      if (Number.isFinite(projection.offset) &&
          (!nearestMappedRoad || projection.offset < nearestMappedRoad.offset)) {
        nearestMappedRoad = { candidate, ...projection };
      }
    }
  }
  let selectedRoad = startMode === "map"
    ? roads.find(road => road.id === (mapClickOrigin.originalAttachedRoadId || mapClickOrigin.attachedRoadId))
    : nearestMappedRoad
      ? roads.find(road => road.id === nearestMappedRoad.candidate.id)
      : null;
  if (!nearestMappedRoad || !selectedRoad || !Number.isFinite(nearestMappedRoad.offset)) {
    throw new Error(
      "Cannot attach the selected origin to a road permitted for " +
      vehicleMode + ". No route was created."
    );
  }

  // Preserve the true nearest road and projection as the reference for the
  // 40% comparison, even if the separate routeability fallback is needed.
  const originalNearestRoad = selectedRoad;
  const originalNearestProjection = nearest(snapshot.point, originalNearestRoad.pts);
  const originalRoadLocal = String(
    roadField(originalNearestRoad.properties || {}, "local") ?? ""
  ).trim().toLowerCase();

  /*
   * If the closest road is explicitly local: "no", evaluate the original
   * attachment and every eligible major/local:no road within 50 m of its
   * projection. routeDistanceFromRoadProjection returns travel time in seconds,
   * so choose the fastest connected option. The clicked point itself may be
   * much farther from the road; it is not used for the 50 m candidate buffer.
   */
  if (startMode === "map" && originalRoadLocal === "no") {
    const destination = typeof selectedDestination === "function"
      ? selectedDestination()
      : null;
    const originalRoadSnapPoint = originalNearestProjection.q;
    let fastest = null;

    if (destination) {
      const originalTravelSeconds = routeDistanceFromRoadProjection(
        originalNearestRoad, originalNearestProjection, destination.node
      );
      if (Number.isFinite(originalTravelSeconds)) {
        fastest = {
          road: originalNearestRoad,
          projection: originalNearestProjection,
          travelSeconds: originalTravelSeconds,
          isOriginal: true
        };
      }

      const searchNearbyRoads = (majorOnly, requireNonLocal) => {
        for (const candidateRoad of roads) {
          if (candidateRoad.id === originalNearestRoad.id) continue;
          if (majorOnly && candidateRoad.type !== "major") continue;
          if (requireNonLocal) {
            const candidateLocal = String(
              roadField(candidateRoad.properties || {}, "local") ?? ""
            ).trim().toLowerCase();
            if (candidateLocal !== "no") continue;
          }

          const candidateProjection = nearest(originalRoadSnapPoint, candidateRoad.pts);
          if (!Number.isFinite(candidateProjection.offset) ||
              candidateProjection.offset > MAIN_ROAD_40_PERCENT_BUFFER_METRES) continue;

          const candidateTravelSeconds = routeDistanceFromRoadProjection(
            candidateRoad, candidateProjection, destination.node
          );
          if (!Number.isFinite(candidateTravelSeconds)) continue;

          if (!fastest || candidateTravelSeconds < fastest.travelSeconds) {
            fastest = {
              road: candidateRoad,
              projection: candidateProjection,
              travelSeconds: candidateTravelSeconds,
              isOriginal: false
            };
          }
        }
      };

      // Prefer the major-road alternatives first. If neither the original
      // link nor any major-road alternative reaches the LAAR, retry with all
      // road types within the same 50 m buffer.
      searchNearbyRoads(true, true);
      if (!fastest) searchNearbyRoads(false, false);
    }

    if (fastest && !fastest.isOriginal) {
      selectedRoad = fastest.road;
      nearestMappedRoad = {
        candidate: selectedRoad,
        ...fastest.projection,
        offset: dist(snapshot.point, fastest.projection.q)
      };
      mapClickOrigin = {
        ...mapClickOrigin,
        snapPoint: [...fastest.projection.q],
        offset: nearestMappedRoad.offset,
        measure: fastest.projection.m,
        attachedRoadId: selectedRoad.id,
        roadName: selectedRoad.name
      };
      if (mapClickOriginMarker) {
        mapClickOriginMarker.bindTooltip(
          "Map origin — fastest valid route via " + selectedRoad.name,
          { direction: "top" }
        );
      }
      locationStatus(
        "Selected fastest valid route via " + selectedRoad.name +
        " (" + Math.round(fastest.travelSeconds) + " s)."
      );
    }
  }

  // The graph starts at the road projection. Live GPS displays that snapped
  // point; map-click mode preserves the exact clicked coordinate as origin.
  const best = startMode === "map"
    ? nearest(mapClickOrigin.snapPoint, selectedRoad.pts)
    : nearest(snapshot.point, selectedRoad.pts);
  const originPoint = startMode === "map" ? [...snapshot.point] : [...best.q];
  const originOffset = startMode === "map" ? nearestMappedRoad.offset : best.offset;
  snapshot.point = [...best.q];
  const existingCut = selectedRoad.cuts.find(cut =>
    Math.abs(cut.m - best.m) <= ROAD_CUT_TOLERANCE);
  let graph = adjacency;
  let startNode;
  if (existingCut) {
    startNode = existingCut.node;
  } else {
    const cuts = [...selectedRoad.cuts].sort((a, b) => a.m - b.m);
    let before = null;
    let after = null;
    for (let i = 0; i < cuts.length - 1; i++) {
      if (cuts[i].m < best.m && best.m < cuts[i + 1].m) {
        before = cuts[i];
        after = cuts[i + 1];
        break;
      }
    }
    if (!before || !after) {
      throw new Error("Cannot identify the road segment at your location.");
    }
    graph = new Map([...adjacency].map(([id, edges]) => [id, [...edges]]));
    startNode = "__live_start";
    while (graph.has(startNode)) startNode += "_";
    graph.set(startNode, []);
    graph.set(before.node, graph.get(before.node).filter(edge =>
      !(edge.roadId === selectedRoad.id && edge.to === after.node)));
    graph.set(after.node, graph.get(after.node).filter(edge =>
      !(edge.roadId === selectedRoad.id && edge.to === before.node)));
    const temporaryCut = {m: best.m, node: startNode};
    function addSegment(a, b) {
      const length = selectedRoad.length * (b.m - a.m) /
        selectedRoad.ms[selectedRoad.ms.length - 1];
      const seconds = length / (selectedRoad.speedKmh / 3.6);
      const points = section(selectedRoad, a.m, b.m);
      if (selectedRoad.direction !== "reverse") {
        graph.get(a.node).push({
          to: b.node, length, seconds, weight: length, pts: points,
          name: selectedRoad.name, roadId: selectedRoad.id
        });
      }
      if (selectedRoad.direction !== "forward") {
        graph.get(b.node).push({
          to: a.node, length, seconds, weight: length, pts: [...points].reverse(),
          name: selectedRoad.name, roadId: selectedRoad.id
        });
      }
    }
    addSegment(before, temporaryCut);
    addSegment(temporaryCut, after);
  }
  return {
    graph,
    sources: [{
      index: null,
      location: {
        name: startMode === "map" ? "Map click origin" : "My live location (accuracy " + snapshot.accuracy.toFixed(0) + " m)",
        kind: startMode === "map" ? "map" : "live", node: startNode, point: originPoint,
        snapPoint: startMode === "map" ? [...mapClickOrigin.snapPoint] : [...best.q],
        offset: originOffset, attachedRoadId: selectedRoad.id, valid: true
      }
    }]
  };
}

# LAAR Navigation — Performance and Reliability Roadmap

This roadmap tracks improvements intended to make LAAR Navigation faster, smoother, and more reliable without changing vehicle access rules or route-selection behaviour unintentionally.

## 1. Establish a baseline
- [ ] Profile route calculation and road-network processing on representative datasets.
- [ ] Measure initial load time, route-generation time, and mobile interaction responsiveness.
- [ ] Record a repeatable baseline before making performance changes.

## 2. Route calculation and road-network processing
- [ ] Identify expensive operations in route calculation and graph preparation.
- [ ] Avoid rebuilding or traversing unchanged road-network data unnecessarily.
- [ ] Prevent duplicate route requests and ensure stale asynchronous results cannot overwrite newer selections.
- [ ] Preserve vehicle-specific road access and directed-edge constraints.
- [ ] Make route failures visible and actionable rather than silently failing.

## 3. Destination filtering
- [ ] Profile graph traversal and destination filtering when changing start points or vehicle types.
- [ ] Cache derived reachability only where graph and start-state invalidation can be guaranteed.
- [ ] Verify that filtering never exposes inaccessible destinations or hides valid reachable destinations.

## 4. Live GPS and navigation
- [ ] Profile GPS callback work and marker/camera updates.
- [ ] Reduce redundant marker, accuracy-circle, and map-camera updates where safe.
- [ ] Keep camera motion smooth without fighting manual map panning.
- [ ] Retain sensible GPS accuracy thresholds and reroute cooldowns.
- [ ] Handle permission denial, unavailable GPS, poor accuracy, and signal recovery clearly.

## 5. Mobile layout and map responsiveness
- [ ] Test planner and live-navigation overlays at narrow viewport widths and with device safe areas.
- [ ] Avoid panel overlap, unexpected layout shifts, and accidental taps.
- [ ] Verify map sizing after panel expand/collapse and orientation changes.
- [ ] Check that map animations remain responsive while route controls are used.

## 6. Loading, caching, and error handling
- [ ] Audit script and data loading for unnecessary work or duplicate requests.
- [ ] Apply appropriate cache behaviour to static assets and data files.
- [ ] Ensure failed or slow requests provide useful status feedback and can be retried.
- [ ] Check for uncaught errors and excessive console logging.

## 7. Regression checks
- [ ] Select different starts and destinations and generate routes repeatedly.
- [ ] Test map-click routing in multiple areas, including difficult or disconnected locations.
- [ ] Switch between vehicle types and verify road-access restrictions.
- [ ] Start and end live navigation; test GPS loss and recovery.
- [ ] Test mobile planner expansion/collapse and live-navigation overlay placement.
- [ ] Confirm all optimisations preserve route correctness.

## Implementation principles
- Make small, reviewable changes and commit each coherent improvement.
- Do not alter routing rules merely to improve speed.
- Prefer measured improvements over speculative micro-optimisations.
- Do not mark an item complete until the relevant checks have been run.

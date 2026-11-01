"use strict";

/*
 * LAAR DESTINATION ACCESS FILTER
 *
 * Load after app.js and live-location.js.
 * Filters destinations using the currently active vehicle graph.
 * This is a UI filter only; it is not a security boundary.
 */
(function () {
  function install() {
    if (
      typeof renderDestinationOptions !== "function" ||
      typeof calculate !== "function" ||
      typeof prepareRoutingStart !== "function"
    ) {
      console.error(
        "laar-access.js: app.js/live-location.js functions are missing. " +
        "Check script order and that this file is loaded."
      );
      return;
    }

    const originalRender = renderDestinationOptions;
    let renderingFilteredOptions = false;

    function getRoutingContext() {
      if (($("startMode")?.value || "gate") === "live") {
        try {
          const prepared = prepareRoutingStart();
          if (
            !prepared ||
            !(prepared.graph instanceof Map) ||
            !Array.isArray(prepared.sources)
          ) {
            return { graph: new Map(), sources: [], ready: false };
          }

          const sources = prepared.sources
            .map(source => source.location?.node)
            .filter(node => node !== null && node !== undefined);

          return {
            graph: prepared.graph,
            sources,
            ready: sources.length > 0
          };
        } catch (_) {
          return { graph: new Map(), sources: [], ready: false };
        }
      }

      const sources = locations
        .filter(location =>
          location.kind === "gate" &&
          location.valid &&
          location.node !== null &&
          location.node !== undefined
        )
        .map(location => location.node);

      return { graph: adjacency, sources, ready: sources.length > 0 };
    }

    function getReachableNodes(context) {
      const reachable = new Set();
      // The graph is rebuilt for the active vehicle using its matching
      // roads.geojson access field (car, suv, pickup, minibus, bus or truck).
      // Traverse only actual directed graph edges on that permitted network.
      const permittedRoadIds = new Set(roads.map(road => road.id));
      const queue = [];

      for (const node of context.sources) {
        if (!reachable.has(node)) {
          reachable.add(node);
          queue.push(node);
        }
      }

      for (let i = 0; i < queue.length; i += 1) {
        const edges = context.graph.get(queue[i]) || [];
        for (const edge of edges) {
          if (!permittedRoadIds.has(edge.roadId)) continue;
          if (reachable.has(edge.to)) continue;
          reachable.add(edge.to);
          queue.push(edge.to);
        }
      }

      return reachable;
    }

    function getAccessibleOptions() {
      const context = getRoutingContext();
      if (!context.ready) return { ready: false, options: [], unreachable: [] };

      const reachable = getReachableNodes(context);
      const allDestinations = locations.flatMap((location, index) =>
        location.kind === "destination" ? [{
          index,
          name: location.name,
          type: location.type,
          valid: location.valid,
          hasPolygon: destinationAreas.has(location.name)
        }] : []
      );
      const isAccessible = option => {
        const location = locations[option.index];
        return Boolean(
          location &&
          location.kind === "destination" &&
          location.valid &&
          option.hasPolygon &&
          location.node !== null &&
          location.node !== undefined &&
          reachable.has(location.node)
        );
      };
      const options = destinationOptions.filter(isAccessible);
      const unreachable = allDestinations.filter(option => !isAccessible(option));

      return { ready: true, options, unreachable };
    }

    function renderFilteredOptions() {
      if (renderingFilteredOptions) return;
      if (!$("end") || !$("destinationSearch")) {
        originalRender();
        return;
      }

      renderingFilteredOptions = true;
      const allOptions = destinationOptions;
      const selectedBefore = $("end").value;

      try {
        const result = getAccessibleOptions();
        destinationOptions = result.options;
        originalRender();

        const selectedStillAvailable = result.options.some(
          option => String(option.index) === selectedBefore
        );

        if (selectedBefore && !selectedStillAvailable) {
          $("end").value = "";
          if (typeof clearRoute === "function") clearRoute();
          if ($("start")) $("start").selectedIndex = -1;
          if (typeof updateDestinationUrl === "function") updateDestinationUrl();
          if (typeof refreshShareControls === "function") refreshShareControls();
        }

        if ($("searchStatus")) {
          if (!result.ready) {
            $("searchStatus").textContent =
              "No valid starting route yet. Start live location or choose a gate.";
          } else if (!result.options.length) {
            $("searchStatus").textContent =
              "No LAAR destinations are reachable for this vehicle and start.";
          } else {
            $("searchStatus").textContent =
              result.options.length + " reachable LAAR destination(s).";
          }
        }

        const diagnosticsStatus = $("diagnosticsStatus");
        const unreachableList = $("unreachableDestinations");
        if (diagnosticsStatus && unreachableList) {
          unreachableList.replaceChildren();
          if (!result.ready) {
            diagnosticsStatus.textContent =
              "Choose a valid start location to check destination reachability.";
          } else if (!result.unreachable.length) {
            diagnosticsStatus.textContent =
              "All destinations are reachable for the selected vehicle and start location.";
          } else {
            diagnosticsStatus.textContent =
              result.unreachable.length + " destination(s) cannot be reached:";
            result.unreachable
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .forEach(option => {
                const item = document.createElement("li");
                item.textContent = option.name +
                  (!option.valid ? " (invalid destination data)" :
                    !option.hasPolygon ? " (no destination area)" :
                    locations[option.index].node == null ? " (not connected to the road network)" : "");
                unreachableList.appendChild(item);
              });
          }
        }
      } finally {
        destinationOptions = allOptions;
        renderingFilteredOptions = false;
      }
    }

    // app.js calls renderDestinationOptions during startup and on search.
    renderDestinationOptions = renderFilteredOptions;

    // Vehicle changes rebuild the permitted road network in app.js.
    // Re-render after that handler has updated roads/adjacency.
    const vehicle = $("vehicleType");
    if (vehicle) {
      const existingVehicleChange = vehicle.onchange;
      vehicle.onchange = function (event) {
        if (typeof existingVehicleChange === "function") {
          existingVehicleChange.call(this, event);
        }
        renderFilteredOptions();
      };
    }

    for (const id of ["startMode", "start"]) {
      const element = $(id);
      if (element) {
        element.addEventListener("change", renderFilteredOptions);
      }
    }

    // Re-run after the initial network build and after shared-link loading.
    renderFilteredOptions();
    window.addEventListener("pageshow", renderFilteredOptions);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();

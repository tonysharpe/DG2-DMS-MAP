"use strict";

/*
 * DESTINATION REACHABILITY STATUS
 *
 * Keep every destination visible. Reachability is displayed as status only;
 * it must not remove destinations from the selector or prevent selection.
 */
(function () {
  function install() {
    if (
      typeof renderDestinationOptions !== "function" ||
      typeof calculate !== "function" ||
      typeof prepareRoutingStart !== "function"
    ) {
      console.error("Destination reachability: required app functions are missing.");
      return;
    }

    const originalRender = renderDestinationOptions;
    let rendering = false;

    function getRoutingContext() {
      if (($("startMode")?.value || "gate") === "live") {
        try {
          const prepared = prepareRoutingStart();
          if (!prepared || !(prepared.graph instanceof Map) || !Array.isArray(prepared.sources)) {
            return { graph: new Map(), sources: [], ready: false };
          }
          const sources = prepared.sources
            .map(source => source.location?.node)
            .filter(node => node !== null && node !== undefined);
          return { graph: prepared.graph, sources, ready: sources.length > 0 };
        } catch (_) {
          return { graph: new Map(), sources: [], ready: false };
        }
      }

      const sources = locations
        .filter(location => location.kind === "gate" && location.valid &&
          location.node !== null && location.node !== undefined)
        .map(location => location.node);
      return { graph: adjacency, sources, ready: sources.length > 0 };
    }

    function getReachableNodes(context) {
      const reachable = new Set(context.sources);
      const permittedRoadIds = new Set(roads.map(road => road.id));
      const queue = [...reachable];

      for (let i = 0; i < queue.length; i += 1) {
        for (const edge of context.graph.get(queue[i]) || []) {
          if (!permittedRoadIds.has(edge.roadId) || reachable.has(edge.to)) continue;
          reachable.add(edge.to);
          queue.push(edge.to);
        }
      }
      return reachable;
    }

    function renderWithReachability() {
      if (rendering) return;
      rendering = true;
      try {
        const context = getRoutingContext();
        const reachableNodes = context.ready ? getReachableNodes(context) : null;
        let reachableCount = 0;
        let unreachableCount = 0;

        for (const option of destinationOptions) {
          if (!context.ready) {
            option.reachable = null;
            continue;
          }
          const location = option.index === null ? null : locations[option.index];
          const reachable = Boolean(
            location &&
            location.kind === "destination" &&
            location.valid &&
            option.hasPolygon &&
            location.node !== null &&
            location.node !== undefined &&
            reachableNodes.has(location.node)
          );
          option.reachable = reachable;
          if (reachable) reachableCount += 1;
          else unreachableCount += 1;
        }

        originalRender();

        const diagnosticsStatus = $("diagnosticsStatus");
        const unreachableList = $("unreachableDestinations");
        if (diagnosticsStatus && unreachableList) {
          unreachableList.replaceChildren();
          if (!context.ready) {
            diagnosticsStatus.textContent =
              "Choose a valid start location to check destination reachability.";
          } else if (!unreachableCount) {
            diagnosticsStatus.textContent =
              "All destinations are reachable for the selected vehicle and start location.";
          } else {
            diagnosticsStatus.textContent =
              unreachableCount + " destination(s) cannot be reached; they remain selectable:";
            destinationOptions
              .filter(option => option.reachable === false)
              .sort((a, b) => a.name.localeCompare(b.name))
              .forEach(option => {
                const item = document.createElement("li");
                const location = option.index === null ? null : locations[option.index];
                item.textContent = option.name +
                  (!option.hasAccessPoint ? " (no destination point)" :
                    !option.hasPolygon ? " (no destination area)" :
                      !location?.valid ? " (invalid road attachment)" :
                        location?.node == null ? " (not connected to the road network)" : " (no route from selected start)");
                unreachableList.appendChild(item);
              });
          }
        }

        const searchStatus = $("searchStatus");
        if (searchStatus && context.ready) {
          const count = destinationOptions.length;
          searchStatus.textContent = count + " destination(s): " +
            reachableCount + " reachable, " + unreachableCount + " not reachable. All remain selectable.";
        }
      } finally {
        rendering = false;
      }
    }

    renderDestinationOptions = renderWithReachability;

    const vehicle = $("vehicleType");
    if (vehicle) {
      const existingVehicleChange = vehicle.onchange;
      vehicle.onchange = function (event) {
        if (typeof existingVehicleChange === "function") existingVehicleChange.call(this, event);
        renderWithReachability();
      };
    }

    for (const id of ["startMode", "start"]) {
      const element = $(id);
      if (element) element.addEventListener("change", renderWithReachability);
    }

    renderWithReachability();
    window.addEventListener("pageshow", renderWithReachability);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();

"use strict";

/*
 * Destination status annotation. Keep every destination in the selector;
 * mark destinations with no reachable graph path without changing routing.
 */
(function () {
  function install() {
    if (
      typeof renderDestinationOptions !== "function" ||
      typeof prepareRoutingStart !== "function"
    ) {
      console.error("Destination reachability: required app functions are missing.");
      return;
    }

    const originalRender = renderDestinationOptions;
    let rendering = false;

    function routingContext() {
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

    function reachableNodes(context) {
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

    function renderWithStatus() {
      if (rendering) return;
      rendering = true;
      try {
        const context = routingContext();
        const reachable = context.ready ? reachableNodes(context) : null;

        destinationOptions = destinationOptions.map(option => {
          const location = Number.isInteger(option.index) ? locations[option.index] : null;
          const canRoute = reachable === null ? null : Boolean(
            location &&
            location.kind === "destination" &&
            location.valid &&
            location.node !== null &&
            location.node !== undefined &&
            reachable.has(location.node)
          );
          return { ...option, reachable: canRoute };
        });

        originalRender();

        const unreachable = context.ready
          ? destinationOptions.filter(option => option.reachable === false)
          : [];
        const diagnosticsStatus = $("diagnosticsStatus");
        const unreachableList = $("unreachableDestinations");
        if (diagnosticsStatus && unreachableList) {
          unreachableList.replaceChildren();
          if (!context.ready) {
            diagnosticsStatus.textContent =
              "Choose a valid start location to check destination reachability.";
          } else if (!unreachable.length) {
            diagnosticsStatus.textContent =
              "All destinations are reachable for the selected vehicle and start location.";
          } else {
            diagnosticsStatus.textContent = unreachable.length + " destination(s) have no route:";
            unreachable.sort((a, b) => a.name.localeCompare(b.name))
              .forEach(option => {
                const item = document.createElement("li");
                item.textContent = option.name + " (no route found)";
                unreachableList.appendChild(item);
              });
          }
        }
      } finally {
        rendering = false;
      }
    }

    renderDestinationOptions = renderWithStatus;

    const vehicle = $("vehicleType");
    if (vehicle) {
      const existing = vehicle.onchange;
      vehicle.onchange = function (event) {
        if (typeof existing === "function") existing.call(this, event);
        renderWithStatus();
      };
    }

    for (const id of ["startMode", "start"]) {
      $(id)?.addEventListener("change", renderWithStatus);
    }

    renderWithStatus();
    window.addEventListener("pageshow", renderWithStatus);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();

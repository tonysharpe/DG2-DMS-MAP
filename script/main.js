"use strict";

/*
 * Application bootstrap.
 *
 * index.html loads the shared classic scripts in dependency order:
 * app -> location -> route display -> map presentation -> reachability ->
 * background layers -> UI -> this entry point.
 *
 * These scripts intentionally share the application scope. Validate that
 * every runtime dependency has loaded before starting asynchronous init.
 */
function startApplication() {
  const dependencies = [
    ["Leaflet", () => typeof L !== "undefined"],
    ["Proj4", () => typeof proj4 !== "undefined"],
    ["application init", () => typeof init === "function"],
    ["location controls", () => typeof initialiseLocationControls === "function"],
    ["routing start preparation", () => typeof prepareRoutingStart === "function"],
    ["route calculation", () => typeof calculate === "function"],
    ["destination rendering", () => typeof renderDestinationOptions === "function"],
    ["destination area rendering", () => typeof showDestinationArea === "function"],
    ["map legend", () => typeof addMapLegend === "function"],
    ["road styling", () => typeof roadStyle === "function"]
  ];

  const missing = dependencies
    .filter(([, isAvailable]) => !isAvailable())
    .map(([name]) => name);

  if (missing.length) {
    const message = "Application startup blocked. Missing dependencies: " +
      missing.join(", ") +
      ". Check the ordered script references in index.html.";
    const statusElement = document.getElementById("status");
    if (statusElement) statusElement.textContent = message;
    console.error(message);
    return;
  }

  init();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApplication, { once: true });
} else {
  startApplication();
}

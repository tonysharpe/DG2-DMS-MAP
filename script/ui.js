"use strict";

/* Mobile map-first controls. Desktop layout remains unchanged. */
(function () {
  const panel = document.getElementById("navigationPanel");
  const toggle = document.getElementById("panelToggle");
  const mobileQuery = window.matchMedia("(max-width: 760px)");

  if (!panel || !toggle) return;

  function setExpanded(expanded) {
    toggle.disabled = false;
    if (mobileQuery.matches) {
      // Always return the planner to its initial position when opening or
      // collapsing it after a route has been calculated.
      panel.scrollTop = 0;
      // The old floating live-routing dialog is retired; controls are in the header.
      const journeyControls = document.getElementById("journeyControls");
      if (journeyControls) journeyControls.hidden = true;
    }
    panel.classList.toggle("mobile-panel-collapsed", !expanded && mobileQuery.matches);
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.textContent = expanded ? "Hide Menu" : "Show Menu";
  }

  function syncViewport() {
    toggle.disabled = false;
    if (mobileQuery.matches) {
      setExpanded(false);
    } else {
      panel.classList.remove("mobile-panel-collapsed");
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = "Hide Menu";
    }
  }

  // Panel visibility is controlled only by the Show Menu / Hide Menu button.
  // Route recalculations must not collapse the panel automatically; doing so
  // can make the destination selector flash between the sheet and full map.


  toggle.addEventListener("click", function () {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    setExpanded(!expanded);
  });

  // Do not auto-toggle the bottom sheet on viewport/media-query changes.
  // Mobile browser chrome and viewport resizes can otherwise cause visible flashing.

  syncViewport();
})();


/* Prevent browser pinch-zoom on the UI panels on mobile while leaving the map zoomable.
   CSS touch-action alone is not consistently enforced for page zoom in iOS Safari. */
(function () {
  const panelSelector = "body > aside, body > #journeyControls.journey-controls";
  function isMobile() {
    return window.matchMedia("(max-width: 760px)").matches;
  }
  document.addEventListener("touchstart", function (event) {
    if (isMobile() && event.touches && event.touches.length > 1 && event.target.closest(panelSelector)) {
      event.preventDefault();
    }
  }, { passive: false, capture: true });
  document.addEventListener("touchmove", function (event) {
    if (isMobile() && event.touches && event.touches.length > 1 && event.target.closest(panelSelector)) {
      event.preventDefault();
    }
  }, { passive: false, capture: true });
  document.addEventListener("gesturestart", function (event) {
    if (isMobile() && event.target.closest(panelSelector)) event.preventDefault();
  }, { passive: false, capture: true });
  document.addEventListener("gesturechange", function (event) {
    if (isMobile() && event.target.closest(panelSelector)) event.preventDefault();
  }, { passive: false, capture: true });
})();



/* Header live-route button delegates to the existing location handlers. */
(function () {
  const button = document.getElementById("liveRouteToggle");
  const start = document.getElementById("startLiveRoute");
  const stop = document.getElementById("stopLiveRoute");
  if (!button || !start || !stop) return;
  function sync() {
    const running = start.hidden && !stop.hidden;
    button.textContent = running ? "Stop" : "Start";
    button.classList.toggle("is-stop", running);
    button.disabled = !running && !window.laarRouteAvailable;
  }
  button.addEventListener("click", function () {
    if (button.disabled) return;
    (button.textContent === "Stop" ? stop : start).click();
    sync();
  });
  document.addEventListener("laar-route-state-change", sync);
  start.addEventListener("click", sync);
  stop.addEventListener("click", sync);
  sync();
})();


/* Desktop-only collapsible Development Features section. */
(function () {
  const section = document.querySelector(".development-section");
  const toggle = document.getElementById("developmentToggle");
  const content = document.getElementById("developmentContent");
  const desktopQuery = window.matchMedia("(min-width: 761px)");

  if (!section || !toggle || !content) return;

  function setExpanded(expanded) {
    // Do not permit expansion at mobile viewport widths.
    if (!desktopQuery.matches) expanded = false;
    content.hidden = !expanded;
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", (expanded ? "Collapse" : "Expand") + " Development Features");
    toggle.textContent = expanded ? "−" : "+";
  }

  toggle.addEventListener("click", function () {
    if (!desktopQuery.matches) return;
    setExpanded(toggle.getAttribute("aria-expanded") !== "true");
  });

  function syncViewport() {
    if (!desktopQuery.matches) setExpanded(false);
  }

  if (typeof desktopQuery.addEventListener === "function") {
    desktopQuery.addEventListener("change", syncViewport);
  } else if (typeof desktopQuery.addListener === "function") {
    desktopQuery.addListener(syncViewport);
  }

  setExpanded(false);
})();


/* Keep the selected vehicle symbol and destination name visible in the collapsed mobile bar. */
(function () {
  const summary = document.getElementById("mobileHeaderSummary");
  const vehicleIcon = document.getElementById("mobileHeaderVehicleIcon");
  const destinationText = document.getElementById("mobileHeaderDestination");
  if (!summary || !vehicleIcon || !destinationText) return;

  function refresh() {
    const vehicle = document.getElementById("vehicleType");
    const destination = typeof selectedDestination === "function"
      ? selectedDestination()
      : null;
    const vehicleValue = vehicle?.value || "truck";
    const sourceIcon = document.querySelector(
      'input[name="vehicleTypeChoice"][value="' + vehicleValue + '"]'
    )?.closest("label")?.querySelector("svg.vehicle-icon");

    vehicleIcon.replaceChildren();
    if (sourceIcon) {
      const icon = sourceIcon.cloneNode(true);
      icon.removeAttribute("id");
      icon.setAttribute("aria-hidden", "true");
      vehicleIcon.appendChild(icon);
    }

    // Use only the destination's name property; do not include contractor,
    // route status, or other selector text in the compact header.
    destinationText.textContent = destination?.name || "No Route Selected";
  }

  document.addEventListener("change", event => {
    if (
      event.target?.id === "vehicleType" ||
      event.target?.id === "end" ||
      event.target?.name === "vehicleTypeChoice"
    ) refresh();
  });
  document.addEventListener("laar-destination-selection-change", refresh);
  window.addEventListener("pageshow", refresh);
  refresh();
  window.updateMobileHeaderSummary = refresh;
})();

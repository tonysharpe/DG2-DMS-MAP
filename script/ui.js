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

  // Mobile bottom-sheet gestures. Use native touch events as the primary
  // path (reliable on Android Chrome), with Pointer Events as a fallback.
  const header = panel.querySelector(".site-header");
  if (header) {
    let touchStart = null;
    let suppressHeaderClick = false;

    function startGesture(x, y) {
      const rect = header.getBoundingClientRect();
      const inHeader =
        x >= rect.left && x <= rect.right &&
        y >= rect.top && y <= rect.bottom;
      return inHeader ? { x, y, moved: false } : null;
    }

    function finishGesture(x, y, preventClick) {
      if (!touchStart) return false;
      const dx = x - touchStart.x;
      const dy = y - touchStart.y;
      touchStart = null;

      // Require a clear vertical movement; ignore taps and horizontal swipes.
      if (Math.abs(dy) < 35 || Math.abs(dy) < Math.abs(dx) * 1.15) return false;

      if (preventClick) {
        suppressHeaderClick = true;
        window.setTimeout(function () { suppressHeaderClick = false; }, 500);
      }
      setExpanded(dy > 0);
      return true;
    }

    header.addEventListener("click", function (event) {
      if (suppressHeaderClick) {
        suppressHeaderClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.target.closest("button, a, input, select, label")) return;
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      setExpanded(!expanded);
    });

    // Android Chrome touch path: cancel native vertical panning only after
    // the gesture is clearly vertical, then use touchend to change the sheet.
    header.addEventListener("touchstart", function (event) {
      if (!mobileQuery.matches || event.touches.length !== 1) {
        touchStart = null;
        return;
      }
      const t = event.touches[0];
      touchStart = startGesture(t.clientX, t.clientY);
    }, { passive: true });

    header.addEventListener("touchmove", function (event) {
      if (!mobileQuery.matches || !touchStart || event.touches.length !== 1) return;
      const t = event.touches[0];
      const dx = t.clientX - touchStart.x;
      const dy = t.clientY - touchStart.y;
      if (Math.abs(dy) >= 12 && Math.abs(dy) > Math.abs(dx) * 1.1) {
        event.preventDefault();
        touchStart.moved = true;
      }
    }, { passive: false });

    header.addEventListener("touchend", function (event) {
      if (!mobileQuery.matches || !touchStart || event.changedTouches.length !== 1) {
        touchStart = null;
        return;
      }
      const t = event.changedTouches[0];
      finishGesture(t.clientX, t.clientY, true);
    }, { passive: true });

    header.addEventListener("touchcancel", function () {
      touchStart = null;
    }, { passive: true });

    // Pointer fallback for browsers that do not dispatch touch events.
    let pointerStart = null;
    header.addEventListener("pointerdown", function (event) {
      if (!mobileQuery.matches || event.pointerType !== "touch" || !event.isPrimary) return;
      pointerStart = startGesture(event.clientX, event.clientY);
    });
    header.addEventListener("pointerup", function (event) {
      if (!mobileQuery.matches || event.pointerType !== "touch" || !pointerStart) return;
      const dx = event.clientX - pointerStart.x;
      const dy = event.clientY - pointerStart.y;
      pointerStart = null;
      if (Math.abs(dy) >= 35 && Math.abs(dy) > Math.abs(dx) * 1.15) {
        suppressHeaderClick = true;
        window.setTimeout(function () { suppressHeaderClick = false; }, 500);
        setExpanded(dy > 0);
      }
    });
    header.addEventListener("pointercancel", function () { pointerStart = null; });
  }

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


/* URL-gated collapsible Development Features section. */
(function () {
  const section = document.querySelector(".development-section");
  const toggle = document.getElementById("developmentToggle");
  const content = document.getElementById("developmentContent");
  if (!section || !toggle || !content) return;

  // Development controls are available only through an explicit URL opt-in.
  // Keep the whole section out of the layout unless the query is exactly
  // ?dev=true (or includes &dev=true alongside other parameters).
  const developmentEnabled =
    new URLSearchParams(window.location.search).get("dev") === "true";
  if (!developmentEnabled) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  function setExpanded(expanded) {
    content.hidden = !expanded;
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", (expanded ? "Collapse" : "Expand") + " Development Features");
    toggle.textContent = expanded ? "−" : "+";
  }

  toggle.addEventListener("click", function () {
    setExpanded(toggle.getAttribute("aria-expanded") !== "true");
  });

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

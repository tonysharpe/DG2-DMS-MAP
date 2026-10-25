"use strict";

/* Mobile map-first controls. Desktop layout remains unchanged. */
(function () {
  const panel = document.getElementById("navigationPanel");
  const toggle = document.getElementById("panelToggle");
  const mobileQuery = window.matchMedia("(max-width: 760px)");

  if (!panel || !toggle) return;

  function setExpanded(expanded) {
    if (mobileQuery.matches) {
      // Always return the planner to its initial position when opening or
      // collapsing it after a route has been calculated.
      panel.scrollTop = 0;
    }
    panel.classList.toggle("mobile-panel-collapsed", !expanded && mobileQuery.matches);
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.textContent = expanded ? "Hide controls" : "Plan route";
  }

  function syncViewport() {
    if (mobileQuery.matches) {
      setExpanded(false);
    } else {
      panel.classList.remove("mobile-panel-collapsed");
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = "Plan route";
    }
  }

  document.addEventListener("laar-route-ready", function () {
    if (!mobileQuery.matches) return;
    setExpanded(false);
    panel.scrollTop = 0;
    // Let the bottom sheet finish sliding away before Leaflet measures
    // the full-screen map and refits the complete route.
    window.setTimeout(function () {
      panel.scrollTop = 0;
      document.dispatchEvent(new CustomEvent("laar-mobile-layout-settled"));
    }, 260);
  });

  toggle.addEventListener("click", function () {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    setExpanded(!expanded);
  });

  if (typeof mobileQuery.addEventListener === "function") {
    mobileQuery.addEventListener("change", syncViewport);
  } else {
    mobileQuery.addListener(syncViewport);
  }

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


/* Mobile live-routing popup: the persistent map-pin button opens/closes the card. */
(function () {
  const button = document.getElementById("journeyPopupToggle");
  const card = document.getElementById("journeyControls");
  const mobileQuery = window.matchMedia("(max-width: 760px)");
  if (!button || !card) return;

  function setOpen(open) {
    const shouldOpen = Boolean(open && mobileQuery.matches && !card.hidden || open && mobileQuery.matches);
    card.classList.toggle("mobile-popup-open", shouldOpen);
    button.setAttribute("aria-expanded", String(shouldOpen));
    button.setAttribute("aria-label", shouldOpen ? "Close live routing controls" : "Open live routing controls");
    button.setAttribute("title", shouldOpen ? "Close live route" : "Live route");
    button.classList.toggle("is-open", shouldOpen);
    if (shouldOpen) card.hidden = false;
  }

  button.addEventListener("click", function () {
    // Toggle the popup independently of its contents. Closing never stops a route.
    setOpen(!card.classList.contains("mobile-popup-open"));
  });

  card.addEventListener("click", function (event) {
    if (event.target.closest("#startLiveRoute, #stopLiveRoute")) {
      // Keep the popup open while starting/stopping a live journey.
      setOpen(true);
    }
  });

  // The routing UI can hide the card when start mode changes; keep the launcher
  // state accurate so the next tap always opens it and the following tap closes it.
  const visibilityObserver = new MutationObserver(function () {
    if (card.hidden && card.classList.contains("mobile-popup-open")) setOpen(false);
  });
  visibilityObserver.observe(card, {attributes: true, attributeFilter: ["hidden"]});

  document.addEventListener("laar-route-ready", function () {
    if (mobileQuery.matches) setOpen(false);
  });

  function syncViewport() {
    if (!mobileQuery.matches) {
      card.classList.remove("mobile-popup-open");
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-label", "Open live routing controls");
      button.classList.remove("is-open");
    } else {
      setOpen(false);
    }
  }
  if (typeof mobileQuery.addEventListener === "function") mobileQuery.addEventListener("change", syncViewport);
  else mobileQuery.addListener(syncViewport);
  syncViewport();
})();

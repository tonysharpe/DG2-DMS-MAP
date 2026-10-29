"use strict";

/*
 * DIRIYAH-INSPIRED PRESENTATION
 *
 * Presentation only: routing permissions, road directions
 * and junction connections remain controlled by app.js.
 *
 * Public and haul roads:
 *   - solid lines
 *   - equal width
 *   - full opacity
 *
 * Calculated route:
 *   - Google Maps-inspired blue
 *   - wider than the road network
 */

(function () {
  if (
    typeof roadStyle !== "function" ||
    typeof calculate !== "function" ||
    typeof showDestinationArea !== "function" ||
    typeof addMapLegend !== "function" ||
    typeof roadField !== "function"
  ) {
    console.error(
      "Load map.js after the updated app.js."
    );

    return;
  }


  /* Visual values are defined centrally in style.css. */
  function themeColor(property) {
    return getComputedStyle(document.documentElement).getPropertyValue(property).trim();
  }

  function themeNumber(property) {
    return Number(themeColor(property));
  }


  /* ROAD PRESENTATION */

  roadStyle = function (feature) {
    const type = roadField(
      feature.properties || {},
      "type"
    );

    let color = themeColor("--map-unknown-road");

    if (type === "major" || type === "main") {
      color = themeColor("--map-major-road");
    } else if (["minor", "local", "public"].includes(type)) {
      color = themeColor("--map-public-road");
    } else if (type === "haul") {
      color = themeColor("--map-haul-road");
    }

    return {
      color,
      weight: themeNumber("--map-road-width"),
      opacity: 1,
      dashArray: null,
      lineCap: "round",
      lineJoin: "round"
    };
  };

  roadCasingStyle = function (feature) {
    const type = roadField(feature.properties || {}, "type");
    return {
      color: (type === "major" || type === "main") ? themeColor("--map-major-road-outline") : themeColor("--map-road-outline"),
      weight: (type === "major" || type === "main") ? 6 : 5.5,
      opacity: 1,
      lineCap: "round",
      lineJoin: "round"
    };
  };


  /* SELECTED LAAR */

  const originalShowDestinationArea =
    showDestinationArea;

  showDestinationArea = function (destination) {
    const result =
      originalShowDestinationArea(destination);

    if (selectedAreaLayer) {
      selectedAreaLayer.setStyle({
        color: themeColor("--map-area-outline"),
        weight: 2.5,
        opacity: 1,

        fillColor: themeColor("--map-area-fill"),
        fillOpacity: 0.18,
        lineCap: "round",
        lineJoin: "round"
      });
    }

    return result;
  };


  /* GOOGLE MAPS-INSPIRED BLUE ROUTE */

  const originalCalculate = calculate;

  calculate = function () {
    const result = originalCalculate.apply(
      this,
      arguments
    );

    if (routeLayer) {
      routeLayer.setStyle({
        color: themeColor("--map-route"),
        weight: themeNumber("--map-route-width"),
        opacity: 1,
        dashArray: null,
        lineCap: "round",
        lineJoin: "round"
      });
    }

    return result;
  };


  /* MAP LEGEND */

  addMapLegend = function () {
    const mobileQuery = window.matchMedia("(max-width: 760px)");
    const legend = L.control({
      position: "topright"
    });

    legend.onAdd = function () {
      const container = L.DomUtil.create(
        "div",
        "map-legend"
      );

      container.setAttribute(
        "aria-label",
        "Map legend"
      );

      const mobileLegend = window.matchMedia("(max-width: 760px)").matches;

      container.innerHTML = `
        <button
          class="map-legend__toggle"
          type="button"
          aria-expanded="${mobileLegend ? "false" : "true"}"
          aria-controls="mapLegendContent"
        >
          <span>Map Key</span>
          <span class="map-legend__toggle-icon" aria-hidden="true">${mobileLegend ? "+" : "−"}</span>
        </button>

        <div id="mapLegendContent" class="map-legend__content"${mobileLegend ? " hidden" : ""}>
          <div class="map-legend__row">
            <span class="map-key-major-road" aria-hidden="true"><span></span></span>
            <span>Major Roads</span>
          </div>

          <div class="map-legend__row">
            <span class="diriyah-swatch diriyah-swatch--minor" aria-hidden="true"></span>
            <span>Minor Roads</span>
          </div>

          <div class="map-legend__row">
            <span class="diriyah-swatch diriyah-swatch--haul" aria-hidden="true"></span>
            <span>Haul Roads</span>
          </div>

          <div class="map-legend__row">
            <span class="diriyah-swatch diriyah-swatch--route" aria-hidden="true"></span>
            <span>Route</span>
          </div>

          <div class="map-legend__row">
            <span class="diriyah-area-key" aria-hidden="true"></span>
            <span>Destination</span>
          </div>

          <div class="map-legend__row">
            <span class="legend-gate">${gateSvg()}</span>
            <span>Gate</span>
          </div>

          <div class="map-legend__row">
            <span class="legend-location" aria-hidden="true"></span>
            <span>My Location</span>
          </div>

          <p class="diriyah-legend-note">
            Road visibility does not indicate vehicle access.
          </p>
        </div>
      `;

      const toggle = container.querySelector(".map-legend__toggle");
      const content = container.querySelector(".map-legend__content");
      const icon = container.querySelector(".map-legend__toggle-icon");

      toggle.addEventListener("click", function () {
        const expanded = toggle.getAttribute("aria-expanded") === "true";
        toggle.setAttribute("aria-expanded", String(!expanded));
        content.hidden = expanded;
        icon.textContent = expanded ? "+" : "−";
      });
      L.DomEvent.disableClickPropagation(
        container
      );

      L.DomEvent.disableScrollPropagation(
        container
      );

      return container;
    };

    legend.addTo(map);

    /*
     * TEMPORARY REPLACEMENT KEY
     * Keep the existing key for comparison while testing this isolated version.
     * Its own class names and SVG symbols avoid legacy legend CSS.
     */
    const testLegend = L.control({ position: "bottomright" });

    testLegend.onAdd = function () {
      const container = L.DomUtil.create("div", "map-key-v2");
      container.setAttribute("aria-label", "New map key");

      container.innerHTML = `
        <div class="map-key-v2__title">Map Key — new</div>

        <div class="map-key-v2__row">
          <svg class="map-key-v2__symbol map-key-v2__road" viewBox="0 0 32 8" aria-hidden="true">
            <path class="map-key-v2__casing map-key-v2__casing--major" d="M3 4 H29"/>
            <path class="map-key-v2__surface map-key-v2__surface--major" d="M3 4 H29"/>
          </svg>
          <span>Major roads</span>
        </div>

        <div class="map-key-v2__row">
          <svg class="map-key-v2__symbol map-key-v2__road" viewBox="0 0 32 8" aria-hidden="true">
            <path class="map-key-v2__casing map-key-v2__casing--minor" d="M3 4 H29"/>
            <path class="map-key-v2__surface map-key-v2__surface--minor" d="M3 4 H29"/>
          </svg>
          <span>Minor roads</span>
        </div>

        <div class="map-key-v2__row">
          <svg class="map-key-v2__symbol map-key-v2__road" viewBox="0 0 32 8" aria-hidden="true">
            <path class="map-key-v2__casing map-key-v2__casing--haul" d="M3 4 H29"/>
            <path class="map-key-v2__surface map-key-v2__surface--haul" d="M3 4 H29"/>
          </svg>
          <span>Haul roads</span>
        </div>

        <div class="map-key-v2__row">
          <svg class="map-key-v2__symbol map-key-v2__route" viewBox="0 0 32 12" aria-hidden="true">
            <path class="map-key-v2__route-line" d="M3 6 H29"/>
          </svg>
          <span>Route</span>
        </div>

        <div class="map-key-v2__row">
          <svg class="map-key-v2__symbol map-key-v2__destination" viewBox="0 0 32 20" aria-hidden="true">
            <rect class="map-key-v2__destination-area" x="2" y="2" width="28" height="16" rx="2"/>
          </svg>
          <span>Destination</span>
        </div>

        <div class="map-key-v2__row">
          <span class="legend-gate">${gateSvg()}</span>
          <span>Gate</span>
        </div>

        <div class="map-key-v2__row">
          <span class="map-key-v2__location" aria-hidden="true"></span>
          <span>Live / start location</span>
        </div>
      `;

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);
      return container;
    };

    testLegend.addTo(map);

    const updateLegendPosition = function () {
      legend.setPosition("topright");
    };

    if (typeof mobileQuery.addEventListener === "function") {
      mobileQuery.addEventListener("change", updateLegendPosition);
    } else {
      mobileQuery.addListener(updateLegendPosition);
    }
  };


  /* MINIMAL MENU HELPERS */

  function setText(id, text) {
    const element =
      document.getElementById(id);

    if (
      element &&
      element.textContent !== text
    ) {
      element.textContent = text;
    }
  }

  function setOptionText(selectId, value, text) {
    const select =
      document.getElementById(selectId);

    if (!select) return;

    const option = Array.from(
      select.options
    ).find(item => {
      return item.value === value;
    });

    if (
      option &&
      option.textContent !== text
    ) {
      option.textContent = text;
    }
  }

  function setLabel(forId, text) {
    const label = document.querySelector(
      'label[for="' + forId + '"]'
    );

    if (
      label &&
      label.textContent !== text
    ) {
      label.textContent = text;
    }
  }


  /* MINIMAL MENU */

  function applyMinimalMenu() {
    setText("vehicleHeading", "Vehicle Type:");
    setText("destinationHeading", "Destination");
    setText("startingHeading", "Start Location:");
    setText("shareHeading", "Share");

    setLabel("vehicleType", "Vehicle");
    setLabel("destinationSearch", "Search");
    setLabel("end", "LAAR");
    setLabel("startMode", "Start from");
    setLabel("start", "Selected Gate");

    setOptionText("vehicleType", "car", "Car");
    setOptionText("vehicleType", "truck", "Truck");

    setOptionText("startMode", "gate", "Best gate");
    setOptionText("startMode", "live", "My location");

    setText("locate", "Locate me");
    setText("stopLocation", "Stop");
    setText("copyLink", "Copy link");
    setText("clear", "Clear");
    setText("fit", "Whole site");
    setText("routeSummaryHeading", "Route");

    const search = document.getElementById(
      "destinationSearch"
    );

    if (search) {
      search.placeholder = "Search LAAR…";
    }

    /*
     * Support older index versions by grouping existing
     * operational notes into one expandable section.
     */
    const sidebar =
      document.querySelector("aside");

    if (
      sidebar &&
      !document.getElementById("navigationGuidance")
    ) {
      const notes = Array.from(
        sidebar.querySelectorAll("p.note")
      );

      if (notes.length) {
        const guidance =
          document.createElement("details");

        guidance.id = "navigationGuidance";
        guidance.className = "navigation-guidance";

        const summary =
          document.createElement("summary");

        summary.textContent = "Access & guidance";

        const body =
          document.createElement("div");

        body.className =
          "navigation-guidance__body";

        for (const note of notes) {
          body.appendChild(note);
        }

        guidance.append(summary, body);

        sidebar.appendChild(guidance);
      }
    }

    if (
      typeof displayedRoadLayer !== "undefined" &&
      displayedRoadLayer
    ) {
      displayedRoadLayer.setStyle(
        roadStyle
      );
    }

    if (
      typeof routeLayer !== "undefined" &&
      routeLayer
    ) {
      routeLayer.setStyle({
        color: themeColor("--map-route"),
        weight: themeNumber("--map-route-width"),
        opacity: 1,
        dashArray: null
      });
    }
  }


  /* START */

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      applyMinimalMenu,
      { once: true }
    );

  } else {
    applyMinimalMenu();
  }
})();

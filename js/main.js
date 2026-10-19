import { map } from "./map.js";
import { enableUserLocation } from "./location.js";

import {
  loadSiteBoundary,
  loadCommunities,
  loadHaulRoadType,
  loadLocalRoads,
  loadMainRoadType,
  loadPublicRoadType,
  loadRiyadhPrimary,
  loadRiyadhSecondary,
  loadRiyadhResidential,
  setLayerOrder
} from "./mapLayers.js";

import { loadDestinations, calculateRoute } from "./routing.js";
import { clearRoute } from "./routeDisplay.js";
import { setMessage } from "./ui.js";

const destinationSelect = document.getElementById("destinationSelect");
const routeButton = document.getElementById("routeButton");

// Calculate a route when the button is clicked.
routeButton.addEventListener("click", () => {
  calculateRoute(map);
});

// Clear the route when the destination changes.
destinationSelect.addEventListener("change", () => {
  clearRoute(map);

  if (destinationSelect.value) {
    setMessage(
      `Destination ${destinationSelect.value} selected. Click Calculate route.`
    );
  } else {
    setMessage("Select a destination to begin.");
  }
});

// Load map data and apply the required layer order.
map.on("load", async () => {
  try {
    // Hide the default basemap layers.
    for (const layer of map.getStyle().layers ?? []) {
      map.setLayoutProperty(layer.id, "visibility", "none");
    }

    // Load destinations and map layers.
    await Promise.all([
      loadDestinations(),
      loadSiteBoundary(map),
      loadCommunities(map),
      loadHaulRoadType(map),
      loadLocalRoads(map),
      loadMainRoadType(map),
      loadPublicRoadType(map),
      loadRiyadhPrimary(map),
      loadRiyadhSecondary(map),
      loadRiyadhResidential(map)
    ]);

    // Apply the intended layer order.
    const result = await setLayerOrder(map);
    console.table(result);

    // Enable user location.
    enableUserLocation(map);
  } catch (error) {
    console.error("Failed to load application layers:", error);
  }
});

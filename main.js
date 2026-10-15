import { map } from "./map.js";
import { enableUserLocation } from "./location.js";
import {
  loadSiteBoundary,
  loadCommunities,
  loadHaulRoads,
  loadLocalRoads,
  loadMainRoads,
  loadPublicRoads,
  loadRiyadhPrimary,
  loadRiyadhSecondary,
  loadRiyadhResidential
  } from "./mapLayers.js";
import { loadDestinations, calculateRoute } from "./routing.js";
import { clearRoute } from "./routeDisplay.js";
import { setMessage } from "./ui.js";
import { setLayerOrder } from "./mapLayers.js";

const destinationSelect = document.getElementById("destinationSelect");
const routeButton = document.getElementById("routeButton");

routeButton.addEventListener("click", () => calculateRoute(map));

destinationSelect.addEventListener("change", () => {
  clearRoute(map);
  if (destinationSelect.value) {
    setMessage(`Destination ${destinationSelect.value} selected. Click Calculate route.`);
  } else {
    setMessage("Select a destination to begin.");
  }
});

// Hides the default basemap layers, then loads destinations and all map data.
map.on("load", async () => {
  for (const layer of map.getStyle().layers ?? []) {
    map.setLayoutProperty(layer.id, "visibility", "none");
  }

  try {
    await Promise.all([
      loadDestinations(),
      loadSiteBoundary(map),
      loadCommunities(map),
      loadHaulRoads(map),
      loadLocalRoads(map),
      loadMainRoads(map),
      loadPublicRoads(map),
      loadRiyadhPrimary(map),
      loadRiyadhSecondary(map),
      loadRiyadhResidential(map)
    ]);

    const result = await setLayerOrder(map);
    console.table(result);

    } catch (error) {
    console.error("Map loading or layer ordering failed:", error);
    }
    
    setLayerOrder(map)
      .then(result => console.table(result))
      .catch(error => console.error(error));
    
    enableUserLocation(map);
  } catch (error) {
    console.error("Failed to load application layers:", error);
  }
});


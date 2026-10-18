import { map } from "../map/map.js";
import { enableUserLocation } from "../location/location.js";
import {
  loadSiteBoundary,
  loadCommunities,
  loadHaulRoads,
  loadLocalRoads,
  loadMainRoads,
  loadPublicRoads,
  loadRiyadhPrimary,
  loadRiyadhSecondary,
  loadRiyadhResidential,
  setLayerOrder
} from "../map/layers.js";
import { loadDestinations, calculateRoute } from "../routing/routing.js";
import { clearRoute } from "../routing/routeDisplay.js";
import { setMessage } from "../menus/ui.js";

const destinationSelect = document.getElementById("destinationSelect");
const routeButton = document.getElementById("routeButton");

routeButton.addEventListener("click", () => calculateRoute(map));

destinationSelect.addEventListener("change", () => {
  clearRoute(map);
  setMessage(
    destinationSelect.value
      ? `Destination ${destinationSelect.value} selected. Click Calculate route.`
      : "Select a destination to begin."
  );
});

map.on("load", async () => {
  try {
    for (const layer of map.getStyle().layers ?? []) {
      map.setLayoutProperty(layer.id, "visibility", "none");
    }

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
    enableUserLocation(map);
  } catch (error) {
    console.error("Failed to load application layers:", error);
  }
});

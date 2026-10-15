// Loads GeoJSON datasets and creates the corresponding map sources and layers.

async function fetchGeoJSON(path, filename) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load ${filename}`);
  return response.json();
}

// Calculates the bounding box containing every coordinate in a GeoJSON geometry.
export function getGeoJSONBounds(geometry) {
  const bounds = new maplibregl.LngLatBounds();

  function visitCoordinates(value) {
    if (
      Array.isArray(value) &&
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      bounds.extend([value[0], value[1]]);
      return;
    }
    if (Array.isArray(value)) value.forEach(visitCoordinates);
  }

  visitCoordinates(geometry.coordinates);
  return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
}

export async function loadSiteBoundary(map) {
  const geojson = await fetchGeoJSON("./data/site_boundary.geojson", "site_boundary.geojson");
  if (map.getSource("site_boundary")) {
    map.getSource("site_boundary").setData(geojson);
    return;
  }
  map.addSource("site_boundary", { type: "geojson", data: geojson });
  map.addLayer({
    id: "site_boundary-fill",
    type: "fill",
    source: "site_boundary",
    paint: { "fill-color": "#dfaf7e", "fill-opacity": 0.2 }
  });
}

export async function loadCommunities(map) {
  const geojson = await fetchGeoJSON("./data/communities.geojson", "communities.geojson");
  console.log("Community features:", geojson.features?.length);
  console.log("First community properties:", geojson.features?.[0]?.properties);

  if (!map.getSource("communities")) {
    map.addSource("communities", { type: "geojson", data: geojson });
  } else {
    map.getSource("communities").setData(geojson);
  }

  if (!map.getLayer("communities-fill")) {
    map.addLayer({
      id: "communities-fill",
      type: "fill",
      source: "communities",
      paint: { "fill-color": "#B9A5C9", "fill-opacity": 0.05 }
    });
  }

  if (!map.getLayer("communities-outline")) {
    map.addLayer({
      id: "communities-outline",
      type: "line",
      source: "communities",
      paint: { "line-color": "#9B85AF", "line-width": 1.2, "line-opacity": 0.1 }
    });
  }

  // Create one label point per community feature.
  const labelFeatures = {
    type: "FeatureCollection",
    features: geojson.features
      .filter(feature => feature.properties?.name)
      .map(feature => {
        const point = turf.pointOnFeature(feature);
        point.properties = { name: feature.properties.name };
        return point;
      })
  };

  if (map.getSource("community-labels")) {
    map.getSource("community-labels").setData(labelFeatures);
  } else {
    map.addSource("community-labels", { type: "geojson", data: labelFeatures });
  }

  if (!map.getLayer("community-labels")) {
    map.addLayer({
      id: "community-labels",
      type: "symbol",
      source: "community-labels",
      layout: {
        "text-field": ["get", "name"],
        "text-size": 12,
        "text-anchor": "center",
        "text-allow-overlap": true,
        "text-ignore-placement": true
      },
      paint: {
        "text-color": "#75677F",
        "text-opacity": 0.55,
        "text-halo-color": "#F4EFE5",
        "text-halo-width": 1
      }
    });
  }
}

async function loadRoadLayer(map, config) {
  const geojson = await fetchGeoJSON(config.path, config.filename);
  if (map.getSource(config.sourceId)) {
    map.getSource(config.sourceId).setData(geojson);
    return;
  }

  map.addSource(config.sourceId, { type: "geojson", data: geojson });
  const sharedLayout = { "line-cap": "round", "line-join": "round" };

  map.addLayer({
    id: `${config.sourceId}-outline`,
    type: "line",
    source: config.sourceId,
    layout: sharedLayout,
    paint: {
      "line-color": config.outlineColor,
      "line-width": config.outlineWidth,
      "line-opacity": 1
    }
  });
  map.addLayer({
    id: `${config.sourceId}-lines`,
    type: "line",
    source: config.sourceId,
    layout: sharedLayout,
    paint: {
      "line-color": config.surfaceColor,
      "line-width": config.surfaceWidth,
      "line-opacity": 1
    }
  });
}

export const loadLocalRoads = map => loadRoadLayer(map, {
  path: "./data/local_roads.geojson", filename: "local_roads.geojson", sourceId: "local_roads",
  outlineColor: "#B8C9D8", outlineWidth: 1.0, surfaceColor: "#CED8E1", surfaceWidth: 0.7
});

export const loadRiyadhResidential = map => loadRoadLayer(map, {
  path: "./data/riyadh_residential.geojson", filename: "riyadh_residential.geojson", sourceId: "riyadh_residential",
  outlineColor: "#B8C9D8", outlineWidth: 1.0, surfaceColor: "#CED8E1", surfaceWidth: 0.7
});

export const loadRiyadhSecondary = map => loadRoadLayer(map, {
  path: "./data/riyadh_secondary.geojson", filename: "riyadh_secondary.geojson", sourceId: "riyadh_secondary",
  outlineColor: "#B8C9D8", outlineWidth: 2.5, surfaceColor: "#CED8E1", surfaceWidth: 1.5
});

export const loadMainRoads = map => loadRoadLayer(map, {
  path: "./data/main_roads.geojson", filename: "main_roads.geojson", sourceId: "main_roads",
  outlineColor: "#7189A8", outlineWidth: 6, surfaceColor: "#92A9C6", surfaceWidth: 4
});

export const loadRiyadhPrimary = map => loadRoadLayer(map, {
  path: "./data/riyadh_primary.geojson", filename: "riyadh_primary.geojson", sourceId: "riyadh_primary",
  outlineColor: "#7189A8", outlineWidth: 6, surfaceColor: "#92A9C6", surfaceWidth: 4
});

export const loadPublicRoads = map => loadRoadLayer(map, {
  path: "./data/public_roads.geojson", filename: "public_roads.geojson", sourceId: "public_roads",
  outlineColor: "#B0C2D4", outlineWidth: 5, surfaceColor: "#D9E1E8", surfaceWidth: 3.5
});

export const loadHaulRoads = map => loadRoadLayer(map, {
  path: "./data/haul_roads.geojson", filename: "haul_roads.geojson", sourceId: "haul_roads",
  outlineColor: "#9C4525", outlineWidth: 5, surfaceColor: "#D96B35", surfaceWidth: 3.5
});

export function setLayerOrder(map) {
  const layerOrder = [
    "site_boundary-fill",
    "communities-fill",
    "communities-outline",
    "community-labels",
    
    "local_roads-outline",
    "local_roads-lines",
    "riyadh_residential-outline",
    "riyadh_residential-lines",
    "riyadh_secondary-outline",
    "riyadh_secondary-lines",
    "public_roads-outline",
    "public_roads-lines",
    "main_roads-outline",
    "main_roads-lines",
    "riyadh_primary-outline",
    "riyadh_primary-lines",
    "haul_roads-outline",
    "haul_roads-lines"
  ];
  
  // Move layers into the specified bottom-to-top order. 
  for (const layerId of layerOrder) {
    if (map.getLayer(layerId)) {
      map.moveLayer(layerId);
    } 
  } 
}

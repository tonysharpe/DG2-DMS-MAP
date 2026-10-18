// Creates the shared MapLibre map instance.
export const map = new maplibregl.Map({
  container: "map",
  style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  center: [46.603, 24.716],
  zoom: 14
});

map.addControl(new maplibregl.NavigationControl(), "top-right");

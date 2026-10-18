// Tracks the user's current location and updates the map marker.
let userLocationMarker = null;
let userLocationWatchId = null;

export function enableUserLocation(map) {
  if (!navigator.geolocation) {
    console.error("Geolocation is not supported by this browser.");
    return;
  }

  if (userLocationWatchId !== null) return;

  userLocationWatchId = navigator.geolocation.watchPosition(
    (position) => {
      const lng = position.coords.longitude;
      const lat = position.coords.latitude;
      console.log("LIVE LOCATION RECEIVED:", lat, lng);

      if (!userLocationMarker) {
        const markerElement = document.createElement("div");
        markerElement.className = "user-location-marker";

        userLocationMarker = new maplibregl.Marker({
          element: markerElement,
          anchor: "center"
        })
          .setLngLat([lng, lat])
          .addTo(map);

        // Center on the user's location when first received.
        map.flyTo({ center: [lng, lat], zoom: 15 });
      } else {
        userLocationMarker.setLngLat([lng, lat]);
      }
    },
    (error) => {
      console.error("Geolocation error:", error.code, error.message);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 30000
    }
  );
}

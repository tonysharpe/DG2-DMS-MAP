const API_BASE = "https://dg2-dms-routing.onrender.com";

import { setMessage, setServiceStatus, showRouteSummary } from "./ui.js";
import { clearRoute, displayRoute, displayDiagnosticMap } from "./routeDisplay.js?v=map-inspection-1";

const destinationSelect = document.getElementById("destinationSelect");
const routeButton = document.getElementById("routeButton");

// Checks the routing API and populates the destination selector.
export async function loadDestinations() {
  try {
    const health = await fetch(`${API_BASE}/health`);
    if (!health.ok) throw new Error(`Health check returned HTTP ${health.status}`);
    setServiceStatus("Routing service connected", "ok");

    const response = await fetch(`${API_BASE}/destinations`);
    if (!response.ok) throw new Error(`Destinations request returned HTTP ${response.status}`);
    const data = await response.json();
    const destinations = data.destinations || [];
    if (!destinations.length) throw new Error("The routing service returned no destinations.");

    destinationSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a destination…";
    destinationSelect.appendChild(placeholder);

    destinations.forEach(id => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = id;
      destinationSelect.appendChild(option);
    });

    destinationSelect.disabled = false;
    routeButton.disabled = false;
    setMessage(`${destinations.length} destinations loaded. Select one and calculate a route.`);
  } catch (error) {
    setServiceStatus("Routing service unavailable", "error");
    setMessage(`Could not load destinations: ${error.message}. Check the API service and network connection.`, "error");
  }
}

// Renders routing diagnostics returned by the backend, or a fallback when unavailable.
function showRoutingDiagnostics(steps) {
  const panel = document.getElementById("routingDiagnostics");
  const list = document.getElementById("diagnosticSteps");
  if (!panel || !list) return;
  list.replaceChildren();
  (steps || []).forEach(step => {
    const item = document.createElement("li");
    item.className = step.status === "error" ? "error" : "ok";
    const stage = document.createElement("span");
    stage.className = "diagnostic-stage";
    stage.textContent = step.stage || "Routing step";
    const detail = document.createElement("span");
    detail.className = "diagnostic-detail";
    detail.textContent = step.detail || "No details returned.";
    item.append(stage, detail);
    list.appendChild(item);
  });
  panel.hidden = !(steps || []).length;
}

function clearRoutingDiagnostics() {
  const panel = document.getElementById("routingDiagnostics");
  const list = document.getElementById("diagnosticSteps");
  if (panel) panel.hidden = true;
  if (list) list.replaceChildren();
}

// Requests a route, displays it on the map, and updates route details.
export async function calculateRoute(map) {
  const destinationId = destinationSelect.value;
  if (!destinationId) {
    setMessage("Select a destination first.", "error");
    return;
  }

  routeButton.disabled = true;
  routeButton.textContent = "Calculating…";
  setMessage(`Calculating route to ${destinationId}…`);
  clearRoute(map);
  clearRoutingDiagnostics();
  let diagnosticsReceived = false;

  try {
    const response = await fetch(`${API_BASE}/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination_id: destinationId })
    });
    const data = await response.json();
    if (Array.isArray(data.diagnostics) && data.diagnostics.length) {
      showRoutingDiagnostics(data.diagnostics);
      diagnosticsReceived = true;
    } else {
      showRoutingDiagnostics([{
        stage: "Backend diagnostics",
        status: "error",
        detail: `The API response did not include routing diagnostics (HTTP ${response.status}, status=${data.status || "unspecified"}). The deployed backend may not have the diagnostics update yet.`
      }]);
    }

    if (!response.ok) throw new Error(data.detail || `Request failed with HTTP ${response.status}`);
    if (data.diagnostic_map) displayDiagnosticMap(map, data);
    if (data.status === "no_route") throw new Error(data.message || "No route is available for this destination.");
    if (data.status !== "ok" || !data.route || !Array.isArray(data.route.features)) {
      throw new Error("API response did not contain route geometry in the expected format.");
    }

    displayRoute(map, data);
    showRouteSummary(data);
    setMessage(`Route to ${destinationId} found.`, "success");
  } catch (error) {
    if (!diagnosticsReceived) {
      showRoutingDiagnostics([{
        stage: "Route request",
        status: "error",
        detail: error.message || String(error)
      }]);
    }
    setMessage(`Route calculation failed: ${error.message}`, "error");
  } finally {
    routeButton.disabled = false;
    routeButton.textContent = "Calculate route";
  }
}

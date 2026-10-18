const statusEl = document.getElementById("serviceStatus");
const messageEl = document.getElementById("message");
const summaryEl = document.getElementById("routeSummary");

// Displays a message and applies the corresponding message style.
export function setMessage(text, type = "") {
  messageEl.textContent = text;
  messageEl.className = `message ${type}`.trim();
}

// Displays the routing service status and applies the corresponding status style.
export function setServiceStatus(text, type = "") {
  statusEl.textContent = text;
  statusEl.className = `status ${type}`.trim();
}

// Converts a duration in seconds into a readable minutes-and-seconds string.
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return mins ? `${mins} min ${secs} sec` : `${secs} sec`;
}

export function hideRouteSummary() {
  summaryEl.hidden = true;
}

export function showRouteSummary(data) {
  document.getElementById("gateValue").textContent = data.gate_id ?? "—";
  document.getElementById("startValue").textContent = data.start_junction ?? "—";
  document.getElementById("endValue").textContent = data.end_junction ?? "—";
  document.getElementById("timeValue").textContent = formatDuration(data.travel_time_seconds);
  document.getElementById("roadsValue").textContent = (data.road_ids || []).length;
  document.getElementById("roadSequence").textContent = (data.road_ids || []).join(" → ") || "—";
  summaryEl.hidden = false;
}

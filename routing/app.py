from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Support both "uvicorn routing.app:app" from the repository root and
# "uvicorn app:app" when running from the routing directory.
if __package__:
    from .routing_engine import RoutingEngine
else:
    from routing_engine import RoutingEngine

app = FastAPI(title="Temporary Road Routing API")

# Shared network data lives in the repository's top-level data/ directory.
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
engine = RoutingEngine(DATA_DIR)


class RouteRequest(BaseModel):
    destination_id: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/network-info")
def network_info():
    """Identify the exact road dataset loaded by this running API process."""
    return engine.network_info


@app.get("/destinations")
def destinations():
    return {"destinations": sorted(engine.destination_by_name.keys())}


@app.post("/route")
def route(request: RouteRequest):
    try:
        return engine.route(request.destination_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

# Serve the frontend from the same Render web service as the routing API.
# Keep API routes above these static mounts so /health, /destinations,
# /route, and /network-info continue to be handled by FastAPI.
ROOT_DIR = Path(__file__).resolve().parent.parent


@app.get("/", include_in_schema=False)
def frontend():
    return FileResponse(ROOT_DIR / "index.html")


@app.get("/style.css", include_in_schema=False)
def stylesheet():
    return FileResponse(ROOT_DIR / "style.css")


app.mount("/js", StaticFiles(directory=ROOT_DIR / "js"), name="frontend-js")
app.mount("/data", StaticFiles(directory=ROOT_DIR / "data"), name="map-data")

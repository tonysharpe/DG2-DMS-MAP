from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Support both "uvicorn routing.app:app" from the repository root and
# "uvicorn app:app" when running from the routing directory.
if __package__:
    from .routing_engine import RoutingEngine
else:
    from routing_engine import RoutingEngine

app = FastAPI(title="Temporary Road Routing API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://dg2-dms-map.onrender.com",
    ],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

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
    return {"destinations": engine.destination_ids()}


@app.post("/route")
def route(request: RouteRequest):
    try:
        return engine.route(request.destination_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

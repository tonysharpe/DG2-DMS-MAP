from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
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

engine = RoutingEngine("data")


class RouteRequest(BaseModel):
    destination_id: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/destinations")
def destinations():
    return {"destinations": engine.destination_ids()}


@app.post("/route")
def route(request: RouteRequest):
    try:
        return engine.route(request.destination_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

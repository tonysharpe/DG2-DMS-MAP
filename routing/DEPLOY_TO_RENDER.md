# Deploy to Render without installing Python

## 1. Put this folder in a GitHub repository

The repository root should contain:

app.py
routing_engine.py
requirements.txt
render.yaml
.python-version
data/
  roads.geojson
  junctions.geojson
  gates.geojson
  destinations.geojson
  destinations_gates_lookup.csv

## 2. Create the Render service

In Render:

1. Create a new Web Service.
2. Connect the GitHub repository.
3. Select the `main` branch.
4. Use the repository root as the Root Directory.
5. The included `render.yaml` provides the build/start configuration.
6. Deploy.

If entering the commands manually:

Build Command:
pip install -r requirements.txt

Start Command:
uvicorn app:app --host 0.0.0.0 --port $PORT

## 3. Test the deployment

Open:

/health

Expected:

{"status":"ok"}

Then open:

/docs

FastAPI's interactive documentation lets you call the endpoints from the browser.

## 4. Test routing

POST /route

Body:

{
  "destination_id": "D001"
}

The response contains the selected gate, dynamically selected nearest
junctions, route road IDs, travel time, and the route GeoJSON.

## Important

The network files are part of the deployed application. If the temporary
road network changes, replace all five network files together and deploy the
new commit. The routing engine then rebuilds its graph when the service
starts.

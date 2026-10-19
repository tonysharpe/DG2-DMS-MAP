# Deploy the routing API to Render

The repository root is the service root directory. The root-level `render.yaml` installs dependencies from `routing/requirements.txt` and starts the API as `routing.app:app`.

The routing engine reads its network files from the shared repository-level `data/` directory. Do not set the Render Root Directory to `routing`, because that would exclude the shared `data/` directory from the service.

## Test the deployment

Open `/health`; expected response:

```json
{"status":"ok"}
```

Then use `/docs` to test the API. `GET /destinations` lists destination IDs, and `POST /route` accepts:

```json
{
  "destination_id": "D001"
}
```

When the routing network changes, update the routing files in the root `data/` directory and deploy the new commit.

## Verify the loaded road dataset

Open `/network-info` on the deployed routing API. It reports the resolved `roads.geojson` path, file size, feature count, and SHA-256 fingerprint for the file loaded by the running process. Compare the fingerprint with the intended `data/roads.geojson` file to verify that the router is serving the expected network.

The routing engine loads the road dataset at process startup. After updating `data/roads.geojson`, deploy the new commit and ensure the routing service has restarted; an already-running process will continue using the dataset loaded at startup.

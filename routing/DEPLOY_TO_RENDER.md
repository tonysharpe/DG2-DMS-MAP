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

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDirectory = path.join(root, "data", "routing-networks");
const port = Number(process.env.PORT || 4173);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url.startsWith("/__routing-cache/")) {
    const vehicle = req.url.slice("/__routing-cache/".length);
    const expected = ["truck", "car", "suv", "pickup", "minibus", "bus"];
    if (!expected.includes(vehicle)) {
      res.writeHead(400).end("Unsupported vehicle");
      return;
    }
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const parsed = JSON.parse(raw);
        if (parsed.schemaVersion !== 3 || parsed.vehicle !== vehicle ||
            !parsed.inputsSignature || !parsed.snapshot ||
            !Array.isArray(parsed.snapshot.nodes) ||
            !Array.isArray(parsed.snapshot.adjacency) ||
            !Array.isArray(parsed.snapshot.roads) ||
            !Array.isArray(parsed.snapshot.locations)) {
          throw new Error("Generated " + vehicle + " network has an invalid structure.");
        }
        fs.mkdirSync(cacheDirectory, { recursive: true });
        const cachePath = path.join(cacheDirectory, vehicle + ".json");
        fs.writeFileSync(cachePath, raw + "\n");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, vehicle, bytes: Buffer.byteLength(raw) }));
      } catch (error) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": mime[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("console", message => {
    if (message.type() === "error") console.error("[browser]", message.text());
    if (message.text().includes("[Routing cache generation")) console.log(message.text());
  });
  page.on("pageerror", error => console.error("[browser page error]", error.message));
  await page.goto(`http://127.0.0.1:${port}/?rebuildRoutingCache=1&generateRoutingCache=1`, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });
  await page.waitForFunction(() => window.laarNetworkBuildReady === true, null, { timeout: 180000 });
  const results = await page.evaluate(async () => {
    const cache = await window.generateAllRoutingNetworksCache();
    const vehicles = ["truck", "car", "suv", "pickup", "minibus", "bus"];
    const replacer = (_key, value) =>
      value === Infinity ? "__INF__" :
      value === -Infinity ? "__-INF__" :
      Number.isNaN(value) ? "__NAN__" : value;
    const results = [];
    for (const vehicle of vehicles) {
      const payload = {
        schemaVersion: 3,
        vehicle,
        inputsSignature: cache.inputsSignature,
        generatedAt: cache.generatedAt,
        snapshot: cache.networks[vehicle]
      };
      const response = await fetch("/__routing-cache/" + vehicle, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload, replacer)
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Failed to save " + vehicle + " routing network.");
      }
      results.push(result);
    }
    return results;
  });
  for (const result of results) {
    console.log(`Saved ${result.vehicle} routing network (${result.bytes} bytes).`);
  }
  console.log("Saved all six routing networks to data/routing-networks/.");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

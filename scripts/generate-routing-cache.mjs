import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cachePath = path.join(root, "data", "routing-network-cache.json");
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
  if (req.method === "POST" && req.url === "/__routing-cache") {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const parsed = JSON.parse(raw);
        const expected = ["truck", "car", "suv", "pickup", "minibus", "bus"];
        if (parsed.schemaVersion !== 1 ||
            !expected.every(vehicle => parsed.networks?.[vehicle]) ||
            !parsed.inputsSignature) {
          throw new Error("Generated cache is missing a vehicle network or signature.");
        }
        fs.writeFileSync(cachePath, raw + "\n");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, bytes: Buffer.byteLength(raw) }));
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
  const serializedCache = await page.evaluate(async () => {
    const cache = await window.generateAllRoutingNetworksCache();
    return JSON.stringify(cache, (_key, value) =>
      value === Infinity ? "__INF__" :
      value === -Infinity ? "__-INF__" :
      Number.isNaN(value) ? "__NAN__" : value);
  });
  const response = await fetch(`http://127.0.0.1:${port}/__routing-cache`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: serializedCache
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "Failed to save routing cache.");
  console.log(`Saved six vehicle networks to data/routing-network-cache.json (${result.bytes} bytes).`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

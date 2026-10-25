const fs = require("node:fs");
const { chromium } = require("playwright");

(async () => {
  const baseUrl = process.env.APP_URL || "http://127.0.0.1:8000/";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", error => console.error("Application page error:", error.message));

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.laarNetworkBuildReady === true, null, { timeout: 300000 });

    const truck = await page.evaluate(() => window.exportRoutingNetworkSnapshot());
    if (!truck?.inputsSignature || truck.vehicleMode !== "truck" || !truck.snapshot?.adjacency?.length) {
      throw new Error("Truck routing network snapshot was empty or invalid.");
    }

    const car = await page.evaluate(async () => {
      const selector = document.getElementById("vehicleType");
      selector.value = "car";
      await changeVehicle();
      return window.exportRoutingNetworkSnapshot();
    });
    if (!car?.inputsSignature || car.inputsSignature !== truck.inputsSignature ||
        car.vehicleMode !== "car" || !car.snapshot?.adjacency?.length) {
      throw new Error("Car routing network snapshot was empty, invalid, or built from different source data.");
    }

    const output = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      inputsSignature: truck.inputsSignature,
      networks: {
        truck: truck.snapshot,
        car: car.snapshot
      }
    };
    fs.writeFileSync("data/routing-network-cache.json", JSON.stringify(output, (_key, value) =>\n      typeof value === "number" && !Number.isFinite(value)\n        ? (value === Infinity ? "__INF__" : value === -Infinity ? "__-INF__" : "__NAN__")\n        : value));
    console.log("Generated routing cache:", {
      signature: output.inputsSignature,
      truckNodes: output.networks.truck.nodes.length,
      truckRoads: output.networks.truck.roads.length,
      carNodes: output.networks.car.nodes.length,
      carRoads: output.networks.car.roads.length,
      bytes: fs.statSync("data/routing-network-cache.json").size
    });
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

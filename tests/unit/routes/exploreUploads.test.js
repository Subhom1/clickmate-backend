import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import express from "express";
import helmet from "helmet";
import { createExploreUploadsRouter } from "../../../routes/exploreUploads.js";

test("Explore images can load from the configured web origin", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clickmate-explore-"));
  await writeFile(join(directory, "photo.jpg"), "test image");
  const app = express();
  app.use(helmet());
  app.use("/uploads", createExploreUploadsRouter(["http://localhost:3000"], directory));
  const server = app.listen(0, "127.0.0.1");

  try {
    await once(server, "listening");
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/uploads/photo.jpg`, {
      headers: { Origin: "http://localhost:3000" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:3000");
    assert.equal(response.headers.get("cross-origin-resource-policy"), "cross-origin");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { AppError } from "../src/common/errors/app-error";
import { NomadClient } from "../src/modules/nomad/nomad.client";

test("Nomad detail 404 becomes NOMAD_RESOURCE_NOT_FOUND", async () => {
  const server = http.createServer((_req, res) => {
    res.statusCode = 404;
    res.end("missing");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const client = new NomadClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      requestTimeoutMs: 1000,
      tlsRejectUnauthorized: true
    });

    await assert.rejects(
      client.getNode("missing-node"),
      error => error instanceof AppError
        && error.statusCode === 404
        && error.code === "NOMAD_RESOURCE_NOT_FOUND"
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

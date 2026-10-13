// Version: 2.10.0
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { ConsulClient } from "../src/modules/consul/consul.client";

interface Route {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

async function withServer(
  routes: Record<string, Route>,
  run: (client: ConsulClient, requests: Array<{ url: string; token?: string }>) => Promise<void>,
): Promise<void> {
  const requests: Array<{ url: string; token?: string }> = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url ?? "", token: req.headers["x-consul-token"] as string | undefined });
    const path = (req.url ?? "").split("?")[0];
    const route = routes[path] ?? { status: 404, body: "not found" };
    res.writeHead(route.status, { "content-type": "application/json", ...route.headers });
    res.end(route.body);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(new ConsulClient({ baseUrl: `http://127.0.0.1:${port}`, token: "secret", requestTimeoutMs: 2000 }), requests);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

test("autopilot health body is read on HTTP 429 (unhealthy cluster)", async () => {
  const body = JSON.stringify({ Healthy: false, FailureTolerance: 0, Servers: [{ ID: "raft-1", Name: "server-1", Healthy: false }] });
  await withServer({ "/v1/operator/autopilot/health": { status: 429, body } }, async (client, requests) => {
    const health = await client.getAutopilotHealth("dc1");
    assert.equal(health.Healthy, false);
    assert.equal(health.Servers[0].ID, "raft-1");
    assert.equal(requests[0].url, "/v1/operator/autopilot/health?dc=dc1");
    assert.equal(requests[0].token, "secret");
  });
});

test("status leader: address, empty string, and 500 No cluster leader", async () => {
  await withServer({ "/v1/status/leader": { status: 200, body: "\"10.0.0.1:8300\"" } }, async client => {
    assert.equal(await client.getLeader("dc1"), "10.0.0.1:8300");
  });
  await withServer({ "/v1/status/leader": { status: 200, body: "\"\"" } }, async client => {
    assert.equal(await client.getLeader("dc1"), "");
  });
  await withServer({ "/v1/status/leader": { status: 500, body: "No cluster leader" } }, async client => {
    assert.equal(await client.getLeader("dc1"), "");
  });
  await withServer({ "/v1/status/leader": { status: 500, body: "No path to datacenter" } }, async client => {
    await assert.rejects(client.getLeader("dc9"), (error: { code?: string }) => error.code === "CONSUL_UPSTREAM_ERROR");
  });
});

test("health checks use stale reads and expose X-Consul-KnownLeader", async () => {
  const checks = [{ Node: "worker-1", CheckID: "serfHealth", Name: "Serf Health Status", Status: "passing" }];
  await withServer({
    "/v1/health/state/any": { status: 200, body: JSON.stringify(checks), headers: { "X-Consul-KnownLeader": "false" } },
  }, async (client, requests) => {
    const result = await client.getHealthChecks("any", "dc1");
    assert.equal(result.checks.length, 1);
    assert.equal(result.knownLeader, false);
    assert.match(requests[0].url, /^\/v1\/health\/state\/any\?dc=dc1&stale/);
  });
});

test("other non-2xx responses are upstream errors", async () => {
  await withServer({ "/v1/catalog/datacenters": { status: 403, body: "Permission denied" } }, async client => {
    await assert.rejects(client.getDatacenters(), (error: { code?: string }) => error.code === "CONSUL_UPSTREAM_ERROR");
  });
});

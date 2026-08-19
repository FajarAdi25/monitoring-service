import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { NomadController } from "../src/modules/nomad/nomad.controller";
import type { NomadService } from "../src/modules/nomad/nomad.service";
import { parseNomadClusterQuery } from "../src/modules/nomad/nomad.validation";

test("Nomad cluster query is optional", () => {
  assert.equal(parseNomadClusterQuery({}), undefined);
  assert.equal(parseNomadClusterQuery({ cluster: "1" }), "1");
  assert.equal(parseNomadClusterQuery({ cluster: ["2", "1"] }), "2");
});

test("Nomad controller forwards cluster query to nodes", async () => {
  let received: string | undefined;
  const service = {
    async getNodes(clusterId?: string) {
      received = clusterId;
      return [];
    }
  } as unknown as NomadService;
  const controller = new NomadController(service);
  const req = { query: { cluster: "2" } } as unknown as Request;
  const res = { json(_value: unknown) {} } as unknown as Response;

  await controller.nodes(req, res);
  assert.equal(received, "2");
});

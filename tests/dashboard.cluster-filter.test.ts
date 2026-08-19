import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { DashboardController } from "../src/modules/dashboard/dashboard.controller";
import { DashboardService } from "../src/modules/dashboard/dashboard.service";
import type { IncidentRepository } from "../src/modules/incidents/incident.repository";
import type { MonitoringCurrentStateRepository } from "../src/modules/monitoring/monitoring-current-state.repository";
import { fakeClusterRepository } from "./test-fixtures";

const summaryCounts = {
  activeTotal: 3,
  acknowledged: 1,
  unacknowledged: 2,
  postponed: 1,
  resolvedToday: 4,
  resolvedLast24Hours: 5,
  bySeverity: { CRITICAL: 2, MAJOR: 1 },
  byType: { NODE_DOWN: 3 }
};

test("dashboard incident summary forwards cluster filter", async () => {
  let receivedCluster: string | undefined;
  const incidents = {
    async countSummary(clusterId?: string) {
      receivedCluster = clusterId;
      return summaryCounts;
    }
  } as unknown as IncidentRepository;

  const service = new DashboardService(
    incidents,
    {} as MonitoringCurrentStateRepository,
    fakeClusterRepository()
  );
  await service.summary({ cluster: "2" });
  assert.equal(receivedCluster, "2");
});

test("dashboard controller forwards summary query", async () => {
  let receivedQuery: Record<string, unknown> | undefined;
  const service = {
    async summary(query: Record<string, unknown>) {
      receivedQuery = query;
      return { ok: true };
    }
  } as unknown as DashboardService;
  const controller = new DashboardController(service);
  const req = { query: { cluster: "1" } } as unknown as Request;
  const res = { json(value: unknown) { return value; } } as unknown as Response;

  await controller.summary(req, res);
  assert.deepEqual(receivedQuery, { cluster: "1" });
});

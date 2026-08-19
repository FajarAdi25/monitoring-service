import assert from "node:assert/strict";
import test from "node:test";
import type { MonitoringCurrentStateRepository } from "../src/modules/monitoring/monitoring-current-state.repository";
import { DashboardService } from "../src/modules/dashboard/dashboard.service";
import type { IncidentEntity } from "../src/modules/incidents/incident.entity";
import { IncidentSeverity, IncidentStatus } from "../src/modules/incidents/incident.enums";
import type { IncidentRepository } from "../src/modules/incidents/incident.repository";
import { IncidentService } from "../src/modules/incidents/incident.service";
import { fakeClusterRepository } from "./test-fixtures";

const incident = {
  id: "1",
  publicId: "INC-00123",
  clusterId: "1",
  source: "NOMAD",
  type: "NODE_DOWN",
  severity: IncidentSeverity.CRITICAL,
  resourceType: "NODE",
  resourceKey: "east-node",
  resourceName: "east-node",
  fingerprint: "fingerprint",
  activeFingerprint: "fingerprint",
  status: IncidentStatus.OPEN,
  message: "Node is down",
  contextJson: { ID: "east-node" },
  openedAt: new Date("2026-08-19T03:00:00.000Z"),
  lastDetectedAt: new Date("2026-08-19T03:01:00.000Z"),
  lastNotificationAt: new Date("2026-08-19T03:00:00.000Z"),
  nextNotificationAt: new Date("2026-08-19T03:02:00.000Z"),
  reminderCount: 1,
  acknowledgedAt: new Date("2026-08-19T03:00:30.000Z"),
  acknowledgedBy: "101",
  acknowledgedByUserName: "Budi Santoso",
  acknowledgedByUsername: "budi",
  acknowledgementNote: "Checking",
  postponedAt: new Date("2026-08-19T03:00:40.000Z"),
  postponedBy: "101",
  postponedByUserName: "Budi Santoso",
  postponedByUsername: "budi",
  postponeUntil: new Date("2099-08-19T04:00:00.000Z"),
  postponeRemark: "Maintenance",
  resolvedAt: null,
  createdAt: new Date("2026-08-19T03:00:00.000Z"),
  updatedAt: new Date("2026-08-19T03:01:00.000Z")
} as IncidentEntity;

function incidentRepositoryFake(): IncidentRepository {
  return {
    async findByPublicId(publicId: string) {
      return publicId === incident.publicId ? incident : null;
    },
    async list() {
      return { items: [incident], total: 1 };
    },
    async recent() {
      return [incident];
    },
    async resolvedHistory() {
      return { items: [incident], total: 1 };
    }
  } as unknown as IncidentRepository;
}

test("incident detail adds cluster identity without changing action structures", async () => {
  const service = new IncidentService(incidentRepositoryFake(), fakeClusterRepository());
  const detail = await service.detail("INC-00123");

  assert.equal(detail.clusterId, 1);
  assert.equal(detail.clusterName, "Cluster EAST");
  assert.equal(detail.site, "cawang");
  assert.equal(detail.appName, "Nomad East Lab App");
  assert.equal(detail.env, "PRODUCTION");
  assert.deepEqual(detail.acknowledgement, {
    acknowledged: true,
    acknowledgedAt: incident.acknowledgedAt,
    acknowledgedBy: { id: 101, name: "Budi Santoso", username: "budi" },
    note: "Checking"
  });
  assert.deepEqual(detail.postpone, {
    postponed: true,
    postponedAt: incident.postponedAt,
    postponedBy: { id: 101, name: "Budi Santoso", username: "budi" },
    postponeUntil: incident.postponeUntil,
    remark: "Maintenance"
  });
});

test("incident list bulk-loads metadata once", async () => {
  let metadataCalls = 0;
  const service = new IncidentService(
    incidentRepositoryFake(),
    fakeClusterRepository({ onBulkLookup: () => { metadataCalls += 1; } })
  );
  const result = await service.list({ page: 1, limit: 20 });

  assert.equal(metadataCalls, 1);
  assert.equal(result.items[0].clusterName, "Cluster EAST");
  assert.equal(result.items[0].clusterId, 1);
});

test("dashboard recent and resolved enrich incident rows", async () => {
  let metadataCalls = 0;
  const dashboard = new DashboardService(
    incidentRepositoryFake(),
    {} as MonitoringCurrentStateRepository,
    fakeClusterRepository({ onBulkLookup: () => { metadataCalls += 1; } })
  );

  const recent = await dashboard.recent({});
  const resolved = await dashboard.resolved({});

  assert.equal(recent[0].clusterName, "Cluster EAST");
  assert.equal(resolved.items[0].appName, "Nomad East Lab App");
  assert.equal(metadataCalls, 2);
});

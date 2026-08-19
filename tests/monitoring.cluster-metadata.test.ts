import assert from "node:assert/strict";
import test from "node:test";
import type { MonitoringCurrentStateEntity } from "../src/modules/monitoring/monitoring-current-state.entity";
import type { MonitoringCurrentStateRepository } from "../src/modules/monitoring/monitoring-current-state.repository";
import { MonitoringCurrentStateService } from "../src/modules/monitoring/monitoring-current-state.service";
import type { MonitoringSnapshotEntity } from "../src/modules/monitoring/monitoring-snapshot.entity";
import type { MonitoringSnapshotRepository } from "../src/modules/monitoring/monitoring-snapshot.repository";
import { MonitoringSnapshotService } from "../src/modules/monitoring/monitoring-snapshot.service";
import { fakeClusterRepository } from "./test-fixtures";

const eastCurrent = {
  id: "10",
  clusterId: "1",
  source: "NOMAD",
  resourceType: "NODE",
  resourceKey: "east-node",
  resourceName: "east-node",
  state: "READY",
  payloadJson: { Status: "ready" },
  lastCheckedAt: new Date("2026-08-19T08:00:00.000Z"),
  lastChangedAt: new Date("2026-08-19T07:00:00.000Z")
} as unknown as MonitoringCurrentStateEntity;

const westCurrent = {
  ...eastCurrent,
  id: "11",
  clusterId: "2",
  resourceKey: "west-node",
  resourceName: "west-node"
} as unknown as MonitoringCurrentStateEntity;

const eastSnapshot = {
  id: "20",
  clusterId: "1",
  source: "NOMAD",
  resourceType: "NODE",
  resourceKey: "east-node",
  resourceName: "east-node",
  state: "READY",
  payloadJson: { Status: "ready" },
  observedAt: new Date("2026-08-19T08:00:00.000Z")
} as unknown as MonitoringSnapshotEntity;

test("monitoring current enriches rows with one bulk cluster lookup", async () => {
  let metadataCalls = 0;
  const repository = {
    async list() { return [eastCurrent, westCurrent]; }
  } as unknown as MonitoringCurrentStateRepository;
  const clusters = fakeClusterRepository({
    onBulkLookup: () => { metadataCalls += 1; }
  });
  const service = new MonitoringCurrentStateService(repository, clusters);

  const result = await service.list({});

  assert.equal(metadataCalls, 1);
  assert.equal(result[0].clusterId, "1");
  assert.equal(result[0].clusterName, "Cluster EAST");
  assert.equal(result[1].site, "tebet");
  assert.equal(result[0].resourceKey, "east-node");
  assert.equal(result[0].lastCheckedAt, "2026-08-19T08:00:00.000Z");
  assert.equal("url" in result[0], false);
  assert.equal("token" in result[0], false);
});

test("monitoring snapshots preserve fields and add cluster metadata with one bulk lookup", async () => {
  let metadataCalls = 0;
  const repository = {
    async list() { return [eastSnapshot]; }
  } as unknown as MonitoringSnapshotRepository;
  const clusters = fakeClusterRepository({
    onBulkLookup: () => { metadataCalls += 1; }
  });
  const service = new MonitoringSnapshotService(repository, clusters);

  const result = await service.list({});

  assert.equal(metadataCalls, 1);
  assert.deepEqual(result[0], {
    id: "20",
    clusterId: "1",
    clusterName: "Cluster EAST",
    site: "cawang",
    appName: "Nomad East Lab App",
    env: "PRODUCTION",
    source: "NOMAD",
    resourceType: "NODE",
    resourceKey: "east-node",
    resourceName: "east-node",
    state: "READY",
    payload: { Status: "ready" },
    observedAt: "2026-08-19T08:00:00.000Z"
  });
});

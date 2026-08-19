import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/common/errors/app-error";
import type { AlertingService } from "../src/modules/alerting/alerting.service";
import type { FailureSignal } from "../src/modules/alerting/alerting.types";
import type { MonitoringObservationService } from "../src/modules/monitoring/monitoring-observation.service";
import { NomadService } from "../src/modules/nomad/nomad.service";
import type {
  NomadAllocation,
  NomadClientPort,
  NomadEvaluation,
  NomadNode
} from "../src/modules/nomad/nomad.types";
import { eastCluster, fakeClusterRepository, westCluster } from "./test-fixtures";

type ClientBehavior = {
  nodes?: NomadNode[] | Error;
  nodeDetail?: NomadNode | Error;
  allocations?: NomadAllocation[] | Error;
  allocationDetail?: NomadAllocation | Error;
  jobSummary?: Record<string, unknown> | Error;
  blockedEvaluations?: NomadEvaluation[] | Error;
};

async function resolved<T>(value: T | Error | undefined, fallback: T): Promise<T> {
  if (value instanceof Error) throw value;
  return value ?? fallback;
}

async function detail<T>(value: T | Error | undefined): Promise<T> {
  if (value instanceof Error) throw value;
  if (value !== undefined) return value;
  throw new AppError(404, "NOMAD_RESOURCE_NOT_FOUND", "missing");
}

function fakeClient(behavior: ClientBehavior = {}): NomadClientPort {
  return {
    getNodes: () => resolved(behavior.nodes, []),
    getNode: () => detail(behavior.nodeDetail),
    getAllocations: () => resolved(behavior.allocations, []),
    getFailedAllocations: () => resolved(behavior.allocations, []),
    getAllocation: () => detail(behavior.allocationDetail),
    getJobSummary: () => detail(behavior.jobSummary),
    getBlockedEvaluations: () => resolved(behavior.blockedEvaluations, [])
  };
}

function makeService(input: { east?: ClientBehavior; west?: ClientBehavior }) {
  const monitoringCalls: Array<{ clusterId: string }> = [];
  const failureSignals: FailureSignal[] = [];

  const monitoring = {
    async record(value: { clusterId: string }) {
      monitoringCalls.push({ clusterId: value.clusterId });
      return { changed: false };
    },
    async latestStates() {
      return [];
    }
  } as unknown as MonitoringObservationService;

  const alerting = {
    async processFailure(signal: FailureSignal) {
      failureSignals.push(signal);
      return undefined;
    },
    async processRecovery() {
      return null;
    }
  } as unknown as AlertingService;

  const clientFactory = (cluster: typeof eastCluster): NomadClientPort =>
    cluster.clusterId === "1" ? fakeClient(input.east) : fakeClient(input.west);

  return {
    service: new NomadService(
      fakeClusterRepository({ clusters: [eastCluster, westCluster] }),
      clientFactory,
      monitoring,
      alerting
    ),
    monitoringCalls,
    failureSignals
  };
}

test("scoped node list uses only the requested cluster and enriches metadata", async () => {
  const { service } = makeService({
    east: { nodes: [{ ID: "east-node", Name: "east", Status: "ready" }] },
    west: { nodes: [{ ID: "west-node", Name: "west", Status: "ready" }] }
  });

  const result = await service.getNodes("1");

  assert.equal(result.length, 1);
  assert.equal(result[0].ID, "east-node");
  assert.equal(result[0].clusterId, 1);
  assert.equal(result[0].clusterName, "Cluster EAST");
  assert.equal(result[0].site, "cawang");
  assert.equal(result[0].appName, "Nomad East Lab App");
  assert.equal(result[0].env, "PRODUCTION");
});

test("unscoped node list combines all cluster results", async () => {
  const { service } = makeService({
    east: { nodes: [{ ID: "east-node", Name: "east", Status: "ready" }] },
    west: { nodes: [{ ID: "west-node", Name: "west", Status: "ready" }] }
  });

  const result = await service.getNodes();
  assert.deepEqual(result.map(item => [item.ID, item.clusterId]), [
    ["east-node", 1],
    ["west-node", 2]
  ]);
});

test("unknown explicit cluster returns CLUSTER_NOT_FOUND", async () => {
  const { service } = makeService({});
  await assert.rejects(
    service.getNodes("99"),
    error => error instanceof AppError
      && error.statusCode === 404
      && error.code === "CLUSTER_NOT_FOUND"
  );
});

test("unscoped detail returns its unique cluster match", async () => {
  const { service } = makeService({
    east: { nodeDetail: new AppError(404, "NOMAD_RESOURCE_NOT_FOUND", "missing") },
    west: { nodeDetail: { ID: "shared-id", Name: "west", Status: "ready" } }
  });
  const result = await service.getNode("shared-id");
  assert.equal(result.clusterId, 2);
});

test("unscoped detail returns NOMAD_RESOURCE_NOT_FOUND when no cluster matches", async () => {
  const { service } = makeService({
    east: { nodeDetail: new AppError(404, "NOMAD_RESOURCE_NOT_FOUND", "missing") },
    west: { nodeDetail: new AppError(404, "NOMAD_RESOURCE_NOT_FOUND", "missing") }
  });
  await assert.rejects(
    service.getNode("missing"),
    error => error instanceof AppError && error.code === "NOMAD_RESOURCE_NOT_FOUND"
  );
});

test("unscoped detail returns NOMAD_RESOURCE_CLUSTER_AMBIGUOUS on multiple matches", async () => {
  const { service } = makeService({
    east: { nodeDetail: { ID: "shared-id", Name: "east", Status: "ready" } },
    west: { nodeDetail: { ID: "shared-id", Name: "west", Status: "ready" } }
  });
  await assert.rejects(
    service.getNode("shared-id"),
    error => error instanceof AppError
      && error.statusCode === 409
      && error.code === "NOMAD_RESOURCE_CLUSTER_AMBIGUOUS"
  );
});

test("all-cluster node list fails instead of returning a partial array", async () => {
  const { service } = makeService({
    east: { nodes: new AppError(502, "NOMAD_UPSTREAM_ERROR", "east failed") },
    west: { nodes: [{ ID: "west-node", Name: "west", Status: "ready" }] }
  });
  await assert.rejects(
    service.getNodes(),
    error => error instanceof AppError && error.code === "NOMAD_UPSTREAM_ERROR"
  );
});

for (const failedClusterId of ["1", "2"] as const) {
  test(`all-cluster pull continues when cluster ${failedClusterId} fails`, async () => {
    const failed = { nodes: new AppError(502, "NOMAD_UPSTREAM_ERROR", "failed") };
    const healthy = { nodes: [], allocations: [], blockedEvaluations: [] };
    const { service } = makeService(
      failedClusterId === "1"
        ? { east: failed, west: healthy }
        : { east: healthy, west: failed }
    );

    const outcomes = await service.pullOnce(undefined, new Date("2026-08-19T08:00:00.000Z"));
    assert.ok(Array.isArray(outcomes));
    assert.equal(outcomes.length, 2);
    assert.equal(outcomes.find(item => String(item.clusterId) === failedClusterId)?.success, false);
    assert.equal(outcomes.find(item => String(item.clusterId) !== failedClusterId)?.success, true);
  });
}

test("pull processing propagates WEST clusterId into monitoring and incident signals", async () => {
  const { service, monitoringCalls, failureSignals } = makeService({
    east: { nodes: [], allocations: [], blockedEvaluations: [] },
    west: {
      nodes: [{ ID: "west-node", Name: "west-node", Status: "down", StatusDescription: "down" }],
      allocations: [],
      blockedEvaluations: []
    }
  });

  await service.pullOnce("2", new Date("2026-08-19T08:00:00.000Z"));

  assert.equal(monitoringCalls[0].clusterId, "2");
  assert.equal(failureSignals[0].clusterId, "2");
});

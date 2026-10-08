// Version: 2.9.1
import assert from "node:assert/strict";
import test from "node:test";
import type { AlertingService } from "../src/modules/alerting/alerting.service";
import type { FailureSignal } from "../src/modules/alerting/alerting.types";
import type { ClusterEntity } from "../src/modules/clusters/cluster.entity";
import type { IncidentEntity } from "../src/modules/incidents/incident.entity";
import { IncidentSeverity } from "../src/modules/incidents/incident.enums";
import type { MonitoringObservationService } from "../src/modules/monitoring/monitoring-observation.service";
import { createNomadFingerprint } from "../src/modules/nomad/nomad.fingerprint";
import { NomadService } from "../src/modules/nomad/nomad.service";
import type { NomadAllocation, NomadClientPort, NomadJob } from "../src/modules/nomad/nomad.types";

const NOW = new Date("2026-10-08T01:00:00.000Z");
const CLUSTER_ID = "1";
const JOB_KEY = "default:web";
const RUNNING_JOB: NomadJob = { ID: "web", Namespace: "default", Status: "running", Stop: false };

function allocation(slot: number, clientStatus: string, createIndex: number): NomadAllocation {
  return {
    ID: `alloc-${slot}-${createIndex}`,
    Name: `web.app[${slot}]`,
    Namespace: "default",
    JobID: "web",
    TaskGroup: "app",
    NodeName: `node${slot}`,
    DesiredStatus: "run",
    ClientStatus: clientStatus,
    ClientDescription: clientStatus === "failed" ? "Failed tasks" : "Tasks are running",
    CreateIndex: createIndex,
  };
}

function fingerprint(resourceKey: string): string {
  return createNomadFingerprint({
    clusterId: CLUSTER_ID,
    type: "ALLOCATION_FAILED",
    resourceType: "ALLOCATION",
    resourceKey,
  });
}

async function pull(input: {
  allocations: NomadAllocation[];
  jobs: NomadJob[];
  openFingerprints?: string[];
  states?: Array<{ resourceKey: string; state: string }>;
}) {
  const failures: FailureSignal[] = [];
  const recoveries: string[] = [];
  const recorded: Array<{ resourceKey: string; state: string }> = [];

  const client = {
    getNodes: async () => [],
    getAllocations: async () => input.allocations,
    getFailedAllocations: async () =>
      input.allocations.filter(item => item.ClientStatus === "failed"),
    getBlockedEvaluations: async () => [],
    getJobs: async () => input.jobs,
  } as unknown as NomadClientPort;

  const monitoring = {
    record: async (snapshot: { resourceKey: string; state: string }) => {
      recorded.push({ resourceKey: snapshot.resourceKey, state: snapshot.state });
      return { changed: true };
    },
    latestStates: async ({ resourceType }: { resourceType: string }) =>
      resourceType === "ALLOCATION" ? input.states ?? [] : [],
  } as unknown as MonitoringObservationService;

  const alerting = {
    processFailure: async (signal: FailureSignal) => {
      failures.push(signal);
    },
    processRecovery: async (signal: { fingerprint: string }) => {
      recoveries.push(signal.fingerprint);
      return {} as IncidentEntity;
    },
    findOpenIncidents: async () =>
      (input.openFingerprints ?? []).map(activeFingerprint => ({ activeFingerprint }) as IncidentEntity),
  } as unknown as AlertingService;

  const service = new NomadService({} as never, () => client, monitoring, alerting);
  const cluster = { clusterId: CLUSTER_ID } as ClusterEntity;
  await (service as unknown as {
    pullCluster(cluster: ClusterEntity, now: Date): Promise<unknown>;
  }).pullCluster(cluster, NOW);

  return { failures, recoveries, recorded };
}

test("all allocations of a job failed: one FAILED alert per job with MAJOR severity", async () => {
  const result = await pull({
    allocations: [allocation(0, "failed", 10), allocation(1, "failed", 11)],
    jobs: [RUNNING_JOB],
  });

  assert.equal(result.failures.length, 1);
  const [signal] = result.failures;
  assert.equal(signal.fingerprint, fingerprint(JOB_KEY));
  assert.equal(signal.resourceKey, JOB_KEY);
  assert.equal(signal.resourceName, "web");
  assert.equal(signal.severity, IncidentSeverity.MAJOR);
  assert.deepEqual(signal.context?.jobSummary, { status: "FAILED", failed: 2, running: 0, total: 2 });
  // Latest failed allocation (highest CreateIndex) is shown.
  assert.equal((signal.context?.currentAllocation as NomadAllocation).Name, "web.app[1]");
  assert.deepEqual(result.recoveries, []);
});

test("some allocations still running: DEGRADED alert with WARNING severity", async () => {
  const result = await pull({
    allocations: [
      allocation(0, "running", 10),
      allocation(1, "failed", 11),
      allocation(2, "running", 12),
      allocation(3, "failed", 13),
    ],
    jobs: [RUNNING_JOB],
  });

  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].severity, IncidentSeverity.WARNING);
  assert.deepEqual(result.failures[0].context?.jobSummary, { status: "DEGRADED", failed: 2, running: 2, total: 4 });
});

test("slot replaced by a running allocation does not count as failed", async () => {
  const result = await pull({
    allocations: [allocation(0, "failed", 10), allocation(0, "running", 20)],
    jobs: [RUNNING_JOB],
    openFingerprints: [fingerprint(JOB_KEY)],
  });

  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.recoveries, [fingerprint(JOB_KEY)]);
});

test("job alert is resolved when the job is stopped", async () => {
  const result = await pull({
    allocations: [allocation(0, "failed", 10)],
    jobs: [{ ...RUNNING_JOB, Status: "dead", Stop: true }],
    openFingerprints: [fingerprint(JOB_KEY)],
  });

  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.recoveries, [fingerprint(JOB_KEY)]);
});

test("job alert is resolved when the job is purged", async () => {
  const result = await pull({
    allocations: [allocation(0, "failed", 10)],
    jobs: [],
    openFingerprints: [fingerprint(JOB_KEY)],
  });

  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.recoveries, [fingerprint(JOB_KEY)]);
});

test("open per-slot incidents from before grouping are resolved", async () => {
  const legacy = fingerprint("default:web:app:0");
  const result = await pull({
    allocations: [allocation(0, "failed", 10)],
    jobs: [RUNNING_JOB],
    openFingerprints: [legacy, fingerprint(JOB_KEY)],
  });

  assert.equal(result.failures.length, 1);
  assert.deepEqual(result.recoveries, [legacy]);
});

test("failed slot that disappeared from Nomad becomes NOT_FOUND", async () => {
  const result = await pull({
    allocations: [],
    jobs: [],
    states: [
      { resourceKey: "default:web:app:0", state: "FAILED" },
      { resourceKey: "default:web:app:1", state: "RUNNING" },
    ],
  });

  assert.deepEqual(result.recorded, [{ resourceKey: "default:web:app:0", state: "NOT_FOUND" }]);
});

test("system job counts one slot per node even though every allocation is named [0]", async () => {
  const systemAllocation = (node: string, clientStatus: string, createIndex: number): NomadAllocation => ({
    ...allocation(0, clientStatus, createIndex),
    ID: `alloc-${node}-${createIndex}`,
    Name: "web.app[0]",
    NodeID: `node-id-${node}`,
    NodeName: node,
  });

  const result = await pull({
    allocations: [
      systemAllocation("node1", "running", 10),
      systemAllocation("node2", "failed", 11),
      systemAllocation("node3", "running", 12),
    ],
    jobs: [{ ...RUNNING_JOB, Type: "system" }],
  });

  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].severity, IncidentSeverity.WARNING);
  assert.deepEqual(result.failures[0].context?.jobSummary, { status: "DEGRADED", failed: 1, running: 2, total: 3 });
  assert.equal((result.failures[0].context?.currentAllocation as NomadAllocation).NodeName, "node2");
  assert.ok(result.recorded.some(item => item.resourceKey === "default:web:app:node-id-node2" && item.state === "FAILED"));
});

// Version: 2.9.2
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
import type {
  NomadAllocation,
  NomadClientPort,
  NomadEvaluation,
  NomadJob,
} from "../src/modules/nomad/nomad.types";

const NOW = new Date("2026-10-08T01:00:00.000Z");
const MINUTE = 60 * 1000;
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

function evaluation(id: string, createIndex: number, jobId = "plugin-s3"): NomadEvaluation {
  return { ID: id, JobID: jobId, Namespace: "default", Status: "blocked", CreateIndex: createIndex };
}

function fingerprint(resourceKey: string): string {
  return createNomadFingerprint({
    clusterId: CLUSTER_ID,
    type: "ALLOCATION_FAILED",
    resourceType: "ALLOCATION",
    resourceKey,
  });
}

function evaluationFingerprint(resourceKey: string): string {
  return createNomadFingerprint({
    clusterId: CLUSTER_ID,
    type: "EVALUATION_BLOCKED",
    resourceType: "EVALUATION",
    resourceKey,
  });
}

interface SeedState {
  resourceType?: string;
  resourceKey: string;
  state: string;
  /** When the resource entered this state; defaults to 1 hour ago. */
  since?: Date;
}

interface OpenIncident {
  type: string;
  resourceKey: string;
  activeFingerprint: string;
}

async function pull(input: {
  allocations?: NomadAllocation[];
  evaluations?: NomadEvaluation[];
  jobs: NomadJob[];
  /** Open ALLOCATION_FAILED incidents by fingerprint. */
  openFingerprints?: string[];
  openIncidents?: OpenIncident[];
  states?: SeedState[];
}) {
  const allocations = input.allocations ?? [];
  const failures: FailureSignal[] = [];
  const recoveries: string[] = [];
  const recorded: Array<{ resourceKey: string; state: string }> = [];

  // In-memory monitoring_current_states keyed by resource type and key.
  const store = new Map<string, { resourceType: string; resourceKey: string; state: string; since: Date }>();
  for (const seed of input.states ?? []) {
    const resourceType = seed.resourceType ?? "ALLOCATION";
    store.set(`${resourceType}|${seed.resourceKey}`, {
      resourceType,
      resourceKey: seed.resourceKey,
      state: seed.state,
      since: seed.since ?? new Date(NOW.getTime() - 60 * MINUTE),
    });
  }

  const client = {
    getNodes: async () => [],
    getAllocations: async () => allocations,
    getFailedAllocations: async () => allocations.filter(item => item.ClientStatus === "failed"),
    getBlockedEvaluations: async () => input.evaluations ?? [],
    getJobs: async () => input.jobs,
  } as unknown as NomadClientPort;

  const monitoring = {
    record: async (snapshot: { resourceType: string; resourceKey: string; state: string }) => {
      recorded.push({ resourceKey: snapshot.resourceKey, state: snapshot.state });
      const key = `${snapshot.resourceType}|${snapshot.resourceKey}`;
      const current = store.get(key);
      const changed = !current || current.state !== snapshot.state;
      const since = changed ? NOW : current.since;
      store.set(key, { resourceType: snapshot.resourceType, resourceKey: snapshot.resourceKey, state: snapshot.state, since });
      return { changed, lastChangedAt: since };
    },
    latestStates: async ({ resourceType }: { resourceType: string }) =>
      [...store.values()]
        .filter(row => row.resourceType === resourceType)
        .map(row => ({ resourceKey: row.resourceKey, state: row.state, lastChangedAt: row.since })),
  } as unknown as MonitoringObservationService;

  const openIncidents: OpenIncident[] = [
    ...(input.openFingerprints ?? []).map(activeFingerprint => ({
      type: "ALLOCATION_FAILED",
      resourceKey: "",
      activeFingerprint,
    })),
    ...(input.openIncidents ?? []),
  ];

  const alerting = {
    processFailure: async (signal: FailureSignal) => {
      failures.push(signal);
    },
    processRecovery: async (signal: { fingerprint: string }) => {
      recoveries.push(signal.fingerprint);
      return {} as IncidentEntity;
    },
    findOpenIncidents: async (_clusterId: string, type: string) =>
      openIncidents.filter(incident => incident.type === type) as unknown as IncidentEntity[],
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

test("open alert stays open while the replacement allocation is running for less than 2 minutes", async () => {
  const result = await pull({
    allocations: [allocation(0, "failed", 10), allocation(0, "running", 20)],
    jobs: [RUNNING_JOB],
    openFingerprints: [fingerprint(JOB_KEY)],
    states: [{ resourceKey: "default:web:app:0", state: "FAILED" }],
  });

  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.recoveries, []);
});

test("open alert is resolved once every allocation has been running for 2 minutes", async () => {
  const result = await pull({
    allocations: [allocation(0, "failed", 10), allocation(0, "running", 20)],
    jobs: [RUNNING_JOB],
    openFingerprints: [fingerprint(JOB_KEY)],
    states: [{ resourceKey: "default:web:app:0", state: "RUNNING", since: new Date(NOW.getTime() - 2 * MINUTE) }],
  });

  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.recoveries, [fingerprint(JOB_KEY)]);
});

test("open alert stays open while a rescheduled replacement is pending", async () => {
  // Nomad stops the failed allocation it rescheduled; the replacement has not started yet.
  const result = await pull({
    allocations: [
      { ...allocation(0, "failed", 10), DesiredStatus: "stop" },
      allocation(0, "pending", 20),
    ],
    jobs: [RUNNING_JOB],
    openFingerprints: [fingerprint(JOB_KEY)],
  });

  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.recoveries, []);
});

test("slots being stopped do not hold an open alert", async () => {
  const result = await pull({
    allocations: [
      allocation(0, "running", 10),
      { ...allocation(1, "pending", 11), DesiredStatus: "stop" },
    ],
    jobs: [RUNNING_JOB],
    openFingerprints: [fingerprint(JOB_KEY)],
    states: [{ resourceKey: "default:web:app:0", state: "RUNNING" }],
  });

  assert.deepEqual(result.recoveries, [fingerprint(JOB_KEY)]);
});

test("blocked evaluations are one alert per job and replaced evaluation IDs keep the same alert", async () => {
  const result = await pull({
    evaluations: [evaluation("eval-1", 10), evaluation("eval-2", 20)],
    jobs: [],
  });

  assert.equal(result.failures.length, 1);
  const [signal] = result.failures;
  assert.equal(signal.type, "EVALUATION_BLOCKED");
  assert.equal(signal.resourceKey, "default:plugin-s3");
  assert.equal(signal.resourceName, "plugin-s3");
  assert.equal(signal.fingerprint, evaluationFingerprint("default:plugin-s3"));
  assert.equal(signal.context?.ID, "eval-2");
});

test("blocked evaluation alert is held for 2 minutes after the job is no longer blocked", async () => {
  const open: OpenIncident = {
    type: "EVALUATION_BLOCKED",
    resourceKey: "default:plugin-s3",
    activeFingerprint: evaluationFingerprint("default:plugin-s3"),
  };

  const justUnblocked = await pull({
    jobs: [],
    openIncidents: [open],
    states: [{ resourceType: "EVALUATION", resourceKey: "default:plugin-s3", state: "BLOCKED" }],
  });
  assert.deepEqual(justUnblocked.recoveries, []);
  assert.deepEqual(justUnblocked.recorded, [{ resourceKey: "default:plugin-s3", state: "NOT_BLOCKED" }]);

  const stillUnblocked = await pull({
    jobs: [],
    openIncidents: [open],
    states: [{
      resourceType: "EVALUATION",
      resourceKey: "default:plugin-s3",
      state: "NOT_BLOCKED",
      since: new Date(NOW.getTime() - 2 * MINUTE),
    }],
  });
  assert.deepEqual(stillUnblocked.recoveries, [open.activeFingerprint]);
});

test("per-evaluation incidents from earlier versions are resolved after the hold", async () => {
  const legacy: OpenIncident = {
    type: "EVALUATION_BLOCKED",
    resourceKey: "eval-1",
    activeFingerprint: evaluationFingerprint("eval-1"),
  };

  const result = await pull({
    evaluations: [evaluation("eval-2", 20)],
    jobs: [],
    openIncidents: [legacy],
    states: [{
      resourceType: "EVALUATION",
      resourceKey: "eval-1",
      state: "NOT_BLOCKED",
      since: new Date(NOW.getTime() - 3 * MINUTE),
    }],
  });

  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].resourceKey, "default:plugin-s3");
  assert.deepEqual(result.recoveries, [legacy.activeFingerprint]);
});

test("an old running allocation being stopped does not resolve while its replacement is pending", async () => {
  // Deployment: the old version is still running but being stopped; the new version has not started.
  const result = await pull({
    allocations: [
      { ...allocation(0, "running", 10), DesiredStatus: "stop" },
      allocation(0, "pending", 20),
    ],
    jobs: [RUNNING_JOB],
    openFingerprints: [fingerprint(JOB_KEY)],
    states: [{ resourceKey: "default:web:app:0", state: "RUNNING" }],
  });

  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.recoveries, []);
  assert.ok(result.recorded.some(item => item.resourceKey === "default:web:app:0" && item.state === "PENDING"));
});

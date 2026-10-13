// Version: 2.10.0
import assert from "node:assert/strict";
import test from "node:test";
import type { AlertingService } from "../src/modules/alerting/alerting.service";
import type { FailureSignal } from "../src/modules/alerting/alerting.types";
import type { ClusterEntity } from "../src/modules/clusters/cluster.entity";
import { ClusterType } from "../src/modules/clusters/cluster.enums";
import type { ClusterRepositoryPort } from "../src/modules/clusters/cluster.types";
import { createConsulFingerprint } from "../src/modules/consul/consul.fingerprint";
import { ConsulService } from "../src/modules/consul/consul.service";
import type {
  ConsulAutopilotHealth,
  ConsulClientPort,
  ConsulHealthCheck,
  ConsulPullOutcome,
} from "../src/modules/consul/consul.types";
import type { IncidentEntity } from "../src/modules/incidents/incident.entity";
import { IncidentSeverity } from "../src/modules/incidents/incident.enums";
import type { MonitoringObservationService } from "../src/modules/monitoring/monitoring-observation.service";

const NOW = new Date("2026-10-12T01:00:00.000Z");
const MINUTE = 60 * 1000;
const CLUSTER_ID = "7";
const DC = "dc1";

function serf(node: string, status = "passing"): ConsulHealthCheck {
  return { Node: node, CheckID: "serfHealth", Name: "Serf Health Status", Status: status, Output: "", ServiceID: "", ServiceName: "" };
}

function serviceCheck(node: string, serviceId: string, status: string, serviceName = "payment-api"): ConsulHealthCheck {
  return {
    Node: node,
    CheckID: `service:${serviceId}`,
    Name: "HTTP /health",
    Status: status,
    Output: status === "critical" ? "connection refused" : "HTTP 200",
    ServiceID: serviceId,
    ServiceName: serviceName,
  };
}

/** Three payment-api instances on three healthy nodes. */
function paymentChecks(statuses: [string, string, string]): ConsulHealthCheck[] {
  return [
    serf("worker-1"), serf("worker-2"), serf("worker-3"),
    serviceCheck("worker-1", "payment-api-1", statuses[0]),
    serviceCheck("worker-2", "payment-api-2", statuses[1]),
    serviceCheck("worker-3", "payment-api-3", statuses[2]),
  ];
}

function healthyAutopilot(): ConsulAutopilotHealth {
  return {
    Healthy: true,
    FailureTolerance: 1,
    Servers: [
      { ID: "raft-1", Name: "server-1", Address: "10.0.0.1:8300", SerfStatus: "alive", Leader: true, Voter: true, Healthy: true },
      { ID: "raft-2", Name: "server-2", Address: "10.0.0.2:8300", SerfStatus: "alive", Leader: false, Voter: true, Healthy: true },
    ],
  };
}

function fingerprint(type: string, resourceType: string, resourceKey: string): string {
  return createConsulFingerprint({ clusterId: CLUSTER_ID, type, resourceType, resourceKey });
}

const SERVICE_FP = fingerprint("CONSUL_SERVICE_CRITICAL", "CONSUL_SERVICE", `${DC}:payment-api`);

interface SeedState {
  resourceType: string;
  resourceKey: string;
  state: string;
  since?: Date;
}

interface OpenIncident {
  type: string;
  resourceKey: string;
  activeFingerprint: string;
}

function harness(input: {
  checks?: ConsulHealthCheck[];
  leader?: string;
  knownLeader?: boolean | null;
  autopilot?: ConsulAutopilotHealth;
  openIncidents?: OpenIncident[];
  states?: SeedState[];
}) {
  const failures: FailureSignal[] = [];
  const recoveries: string[] = [];
  const recorded: Array<{ resourceType: string; resourceKey: string; state: string }> = [];
  let autopilotCalls = 0;

  const store = new Map<string, { resourceType: string; resourceKey: string; state: string; since: Date }>();
  for (const seed of input.states ?? []) {
    store.set(`${seed.resourceType}|${seed.resourceKey}`, {
      ...seed,
      since: seed.since ?? new Date(NOW.getTime() - 60 * MINUTE),
    });
  }

  const client: ConsulClientPort = {
    getDatacenters: async () => [DC],
    getLeader: async () => input.leader ?? "10.0.0.1:8300",
    getHealthChecks: async () => ({ checks: input.checks ?? [], knownLeader: input.knownLeader ?? true }),
    getAutopilotHealth: async () => {
      autopilotCalls += 1;
      return input.autopilot ?? healthyAutopilot();
    },
  };

  const monitoring = {
    record: async (snapshot: { resourceType: string; resourceKey: string; state: string }) => {
      recorded.push({ resourceType: snapshot.resourceType, resourceKey: snapshot.resourceKey, state: snapshot.state });
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

  const alerting = {
    processFailure: async (signal: FailureSignal) => {
      failures.push(signal);
    },
    processRecovery: async (signal: { fingerprint: string }) => {
      recoveries.push(signal.fingerprint);
      return {} as IncidentEntity;
    },
    findOpenIncidents: async (_clusterId: string, type: string) =>
      (input.openIncidents ?? []).filter(incident => incident.type === type) as unknown as IncidentEntity[],
  } as unknown as AlertingService;

  return {
    failures,
    recoveries,
    recorded,
    autopilotCalls: () => autopilotCalls,
    client,
    monitoring,
    alerting,
  };
}

async function pull(input: Parameters<typeof harness>[0]) {
  const h = harness(input);
  const service = new ConsulService({} as never, () => h.client, h.monitoring, h.alerting);
  const result = await (service as unknown as {
    pullCluster(cluster: ClusterEntity, now: Date): Promise<Record<string, unknown>>;
  }).pullCluster({ clusterId: CLUSTER_ID } as ClusterEntity, NOW);
  return { ...h, result };
}

test("some service instances critical: one DEGRADED incident with WARNING severity", async () => {
  const { failures, recorded, result } = await pull({ checks: paymentChecks(["passing", "critical", "passing"]) });

  assert.equal(failures.length, 1);
  const [signal] = failures;
  assert.equal(signal.source, "CONSUL");
  assert.equal(signal.type, "CONSUL_SERVICE_CRITICAL");
  assert.equal(signal.resourceType, "CONSUL_SERVICE");
  assert.equal(signal.resourceKey, `${DC}:payment-api`);
  assert.equal(signal.fingerprint, SERVICE_FP);
  assert.equal(signal.severity, IncidentSeverity.WARNING);
  assert.equal(signal.context?.status, "DEGRADED");
  assert.equal(signal.context?.total, 3);
  assert.equal(signal.context?.unhealthy, 1);
  const [instance] = signal.context?.instances as Array<Record<string, unknown>>;
  assert.equal(instance.serviceId, "payment-api-2");
  assert.equal(instance.reason, "SERVICE_CHECK");
  assert.ok(recorded.some(row => row.resourceType === "CONSUL_SERVICE" && row.state === "DEGRADED"));
  assert.equal(result.services, 1);
  assert.equal(result.nodes, 3);
  assert.equal(result.servers, 2);
});

test("all service instances critical: FAILED with MAJOR severity on the same fingerprint", async () => {
  const { failures } = await pull({ checks: paymentChecks(["critical", "critical", "critical"]) });

  assert.equal(failures.length, 1);
  assert.equal(failures[0].fingerprint, SERVICE_FP);
  assert.equal(failures[0].severity, IncidentSeverity.MAJOR);
  assert.equal(failures[0].context?.status, "FAILED");
});

test("node serfHealth critical: node incident and its service instances count as unhealthy", async () => {
  const checks = paymentChecks(["passing", "passing", "passing"]);
  checks[1] = serf("worker-2", "critical");
  const { failures } = await pull({ checks });

  const node = failures.find(signal => signal.type === "CONSUL_NODE_CRITICAL");
  assert.ok(node);
  assert.equal(node.resourceKey, `${DC}:worker-2`);
  assert.equal(node.severity, IncidentSeverity.CRITICAL);

  const service = failures.find(signal => signal.type === "CONSUL_SERVICE_CRITICAL");
  assert.ok(service);
  assert.equal(service.context?.status, "DEGRADED");
  const [instance] = service.context?.instances as Array<Record<string, unknown>>;
  assert.equal(instance.node, "worker-2");
  assert.equal(instance.reason, "NODE_DOWN");
});

test("warning checks are recorded but do not open an incident", async () => {
  const { failures, recorded } = await pull({ checks: paymentChecks(["passing", "warning", "passing"]) });

  assert.equal(failures.length, 0);
  assert.ok(recorded.some(row => row.resourceType === "CONSUL_SERVICE" && row.state === "WARNING"));
});

test("recovered service is held open for 2 minutes, then resolved", async () => {
  const open = [{ type: "CONSUL_SERVICE_CRITICAL", resourceKey: `${DC}:payment-api`, activeFingerprint: SERVICE_FP }];

  const justRecovered = await pull({
    checks: paymentChecks(["passing", "passing", "passing"]),
    openIncidents: open,
    states: [{ resourceType: "CONSUL_SERVICE", resourceKey: `${DC}:payment-api`, state: "DEGRADED" }],
  });
  assert.deepEqual(justRecovered.recoveries, []);

  const stillHolding = await pull({
    checks: paymentChecks(["passing", "passing", "passing"]),
    openIncidents: open,
    states: [{
      resourceType: "CONSUL_SERVICE",
      resourceKey: `${DC}:payment-api`,
      state: "HEALTHY",
      since: new Date(NOW.getTime() - 1 * MINUTE),
    }],
  });
  assert.deepEqual(stillHolding.recoveries, []);

  const settled = await pull({
    checks: paymentChecks(["passing", "passing", "passing"]),
    openIncidents: open,
    states: [{
      resourceType: "CONSUL_SERVICE",
      resourceKey: `${DC}:payment-api`,
      state: "HEALTHY",
      since: new Date(NOW.getTime() - 3 * MINUTE),
    }],
  });
  assert.deepEqual(settled.recoveries, [SERVICE_FP]);
});

test("deregistered service is resolved immediately and marked NOT_FOUND", async () => {
  const { recoveries, recorded } = await pull({
    checks: [serf("worker-1")],
    openIncidents: [{ type: "CONSUL_SERVICE_CRITICAL", resourceKey: `${DC}:payment-api`, activeFingerprint: SERVICE_FP }],
    states: [{ resourceType: "CONSUL_SERVICE", resourceKey: `${DC}:payment-api`, state: "FAILED" }],
  });

  assert.deepEqual(recoveries, [SERVICE_FP]);
  assert.ok(recorded.some(row => row.resourceKey === `${DC}:payment-api` && row.state === "NOT_FOUND"));
});

test("no leader: CONSUL_NO_LEADER, autopilot skipped, open server incidents kept", async () => {
  const serverFp = fingerprint("CONSUL_SERVER_UNHEALTHY", "CONSUL_SERVER", `${DC}:raft-2`);
  const h = await pull({
    checks: [serf("worker-1")],
    leader: "",
    openIncidents: [{ type: "CONSUL_SERVER_UNHEALTHY", resourceKey: `${DC}:raft-2`, activeFingerprint: serverFp }],
  });

  const noLeader = h.failures.find(signal => signal.type === "CONSUL_NO_LEADER");
  assert.ok(noLeader);
  assert.equal(noLeader.resourceType, "CONSUL_CLUSTER");
  assert.equal(noLeader.resourceKey, DC);
  assert.equal(noLeader.severity, IncidentSeverity.CRITICAL);
  assert.equal(h.autopilotCalls(), 0);
  assert.deepEqual(h.recoveries, []);
});

test("X-Consul-KnownLeader false also counts as no leader", async () => {
  const { failures } = await pull({ checks: [serf("worker-1")], knownLeader: false });
  assert.ok(failures.some(signal => signal.type === "CONSUL_NO_LEADER"));
});

test("leader back: CONSUL_NO_LEADER is resolved", async () => {
  const noLeaderFp = fingerprint("CONSUL_NO_LEADER", "CONSUL_CLUSTER", DC);
  const { recoveries } = await pull({
    checks: [serf("worker-1")],
    openIncidents: [{ type: "CONSUL_NO_LEADER", resourceKey: DC, activeFingerprint: noLeaderFp }],
  });
  assert.deepEqual(recoveries, [noLeaderFp]);
});

test("unhealthy server opens CONSUL_SERVER_UNHEALTHY; healthy again resolves it", async () => {
  const autopilot = healthyAutopilot();
  autopilot.Healthy = false;
  autopilot.Servers[1] = { ...autopilot.Servers[1], SerfStatus: "failed", Healthy: false };
  const unhealthy = await pull({ checks: [serf("worker-1")], autopilot });

  const server = unhealthy.failures.find(signal => signal.type === "CONSUL_SERVER_UNHEALTHY");
  assert.ok(server);
  assert.equal(server.resourceKey, `${DC}:raft-2`);
  assert.equal(server.resourceName, "server-2");
  assert.equal(server.severity, IncidentSeverity.CRITICAL);

  const serverFp = fingerprint("CONSUL_SERVER_UNHEALTHY", "CONSUL_SERVER", `${DC}:raft-2`);
  const healthy = await pull({
    checks: [serf("worker-1")],
    openIncidents: [{ type: "CONSUL_SERVER_UNHEALTHY", resourceKey: `${DC}:raft-2`, activeFingerprint: serverFp }],
  });
  assert.deepEqual(healthy.recoveries, [serverFp]);
});

test("recovered node is resolved immediately", async () => {
  const nodeFp = fingerprint("CONSUL_NODE_CRITICAL", "CONSUL_NODE", `${DC}:worker-1`);
  const { recoveries } = await pull({
    checks: [serf("worker-1")],
    openIncidents: [{ type: "CONSUL_NODE_CRITICAL", resourceKey: `${DC}:worker-1`, activeFingerprint: nodeFp }],
  });
  assert.deepEqual(recoveries, [nodeFp]);
});

test("pullOnce reads only CONSUL clusters and one failing cluster does not stop the others", async () => {
  const h = harness({ checks: [serf("worker-1")] });
  let requestedType: ClusterType | undefined;
  const clusters = {
    findActive: async (type: ClusterType) => {
      requestedType = type;
      return [
        { clusterId: "7", clusterName: "consul-a", site: "s", appName: "a", env: "PRODUCTION" },
        { clusterId: "8", clusterName: "consul-b", site: "s", appName: "b", env: "PRODUCTION" },
      ] as ClusterEntity[];
    },
  } as unknown as ClusterRepositoryPort;
  const failing: ConsulClientPort = {
    ...h.client,
    getDatacenters: async () => {
      throw new Error("connect ECONNREFUSED");
    },
  };
  const service = new ConsulService(
    clusters,
    cluster => (cluster.clusterId === "8" ? failing : h.client),
    h.monitoring,
    h.alerting,
  );

  const outcomes = await service.pullOnce(undefined, NOW) as ConsulPullOutcome[];
  assert.equal(requestedType, ClusterType.CONSUL);
  assert.equal(outcomes.length, 2);
  assert.equal(outcomes[0].success, true);
  assert.equal(outcomes[1].success, false);
});

test("a cluster id of another type is rejected", async () => {
  const clusters = {
    findById: async () => ({ clusterId: "1", isActive: true, type: ClusterType.NOMAD }) as ClusterEntity,
  } as unknown as ClusterRepositoryPort;
  const h = harness({});
  const service = new ConsulService(clusters, () => h.client, h.monitoring, h.alerting);

  await assert.rejects(service.pullOnce("1", NOW), (error: { code?: string }) => error.code === "CLUSTER_NOT_FOUND");
});

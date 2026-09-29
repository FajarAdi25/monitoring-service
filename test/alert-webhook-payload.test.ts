// Version: 2.7.1
import assert from "node:assert/strict";
import test from "node:test";
import { buildAlertWebhookPayload } from "../src/modules/alerting/alerting.notifier";
import { ClusterEnvironment } from "../src/modules/clusters/cluster.enums";
import type { ClusterMetadata } from "../src/modules/clusters/cluster.types";
import type { IncidentEntity } from "../src/modules/incidents/incident.entity";
import { IncidentSeverity, IncidentStatus } from "../src/modules/incidents/incident.enums";

const cluster: ClusterMetadata = {
  clusterId: "1",
  clusterName: "Cluster WEST",
  site: "cawang",
  appName: "Nomad West",
  env: ClusterEnvironment.PRODUCTION,
};

// REINTAKE contract v1.0 enums (section 6).
const ENTITY_TYPES = [
  "host", "vm", "esxi_host", "cluster", "datastore", "physical_server",
  "network_device", "process", "nomad_node", "nomad_server", "consul_server", "other",
];

function incident(overrides: Partial<IncidentEntity> = {}): IncidentEntity {
  return {
    id: "10",
    publicId: "INC-1790000000000-ABC123",
    clusterId: "1",
    source: "NOMAD",
    type: "NODE_DOWN",
    severity: IncidentSeverity.CRITICAL,
    resourceType: "NODE",
    resourceKey: "9d2e7c1a-4b3f-4e8a-9c1d-2e3f4a5b6c7d",
    resourceName: "NomadClientWest2.dc.local",
    fingerprint: "f".repeat(64),
    activeFingerprint: "f".repeat(64),
    status: IncidentStatus.OPEN,
    message: "Node heartbeat missed",
    contextJson: {
      ID: "9d2e7c1a-4b3f-4e8a-9c1d-2e3f4a5b6c7d",
      Status: "down",
      StatusDescription: "Node heartbeat missed",
      Address: "10.30.0.22",
      Datacenter: "dc-west",
      NodePool: "default",
      Drivers: { docker: { Healthy: true } },
      CreateIndex: 12,
    },
    openedAt: new Date("2026-09-29T01:00:00.000Z"),
    lastDetectedAt: new Date("2026-09-29T01:05:00.000Z"),
    lastNotificationAt: null,
    nextNotificationAt: null,
    reminderCount: 0,
    resolvedAt: null,
    createdAt: new Date("2026-09-29T01:00:00.000Z"),
    updatedAt: new Date("2026-09-29T01:05:00.000Z"),
    ...overrides,
  } as IncidentEntity;
}

function assertStringMap(map: Record<string, unknown>): void {
  assert.ok(Object.keys(map).length <= 20);
  for (const value of Object.values(map)) {
    assert.equal(typeof value, "string");
    assert.ok((value as string).length <= 256);
  }
}

test("NODE_DOWN INITIAL matches the REINTAKE alert contract", () => {
  const payload = buildAlertWebhookPayload(
    { kind: "INITIAL", incident: incident() },
    cluster,
    { batchId: "0191f4b1-2a3c-4d4e-8f50-112233445566", sentAtMs: 1790000000000 },
  );

  assert.equal(payload.schema_version, "1.0");
  assert.equal(payload.metric_source, "hashicorp");
  assert.equal(payload.delivery_mode, "push");
  assert.equal(payload.sent_at_ms, 1790000000000);
  assert.equal(payload.record_count, payload.alerts.length);

  const [alert] = payload.alerts;
  assert.match(alert.alert_id, /^HCP-A-[0-9a-f]{24}$/);
  assert.equal(
    alert.fingerprint,
    "hashicorp|nomad_node|9d2e7c1a-4b3f-4e8a-9c1d-2e3f4a5b6c7d|node_down",
  );
  assert.equal(alert.status, "firing");
  assert.equal(alert.severity, "critical");
  assert.equal(alert.resolved_at_ms, null);
  assert.equal(alert.updated_at_ms, Date.parse("2026-09-29T01:05:00.000Z"));
  assert.deepEqual(alert.entity, {
    type: "nomad_node",
    name: "NomadClientWest2.dc.local",
    host_key: "nomadclientwest2",
    source_id: "9d2e7c1a-4b3f-4e8a-9c1d-2e3f4a5b6c7d",
    ip: "10.30.0.22",
  });
  assert.equal(alert.trigger, null);
  assert.deepEqual(alert.dimensions, {
    cluster: "Cluster WEST",
    site: "cawang",
    app: "Nomad West",
    env: "PRODUCTION",
    datacenter: "dc-west",
    node_pool: "default",
  });
  assert.deepEqual(alert.context, {
    node_id: "9d2e7c1a-4b3f-4e8a-9c1d-2e3f4a5b6c7d",
    status: "down",
    status_description: "Node heartbeat missed",
  });
});

test("REMINDER uses poll_reconcile; RESOLVED has newer updated_at_ms and the same ids", () => {
  const open = incident();
  const resolved = incident({
    status: IncidentStatus.RESOLVED,
    resolvedAt: new Date("2026-09-29T01:10:00.000Z"),
  });

  const reminder = buildAlertWebhookPayload({ kind: "REMINDER", incident: open }, cluster);
  const recovery = buildAlertWebhookPayload({ kind: "RESOLVED", incident: resolved }, cluster);

  assert.equal(reminder.delivery_mode, "poll_reconcile");
  assert.equal(reminder.alerts[0].status, "firing");
  assert.equal(recovery.delivery_mode, "push");
  assert.equal(recovery.alerts[0].status, "resolved");
  assert.equal(recovery.alerts[0].resolved_at_ms, Date.parse("2026-09-29T01:10:00.000Z"));
  assert.equal(recovery.alerts[0].updated_at_ms, Date.parse("2026-09-29T01:10:00.000Z"));
  assert.ok(recovery.alerts[0].updated_at_ms > reminder.alerts[0].updated_at_ms);
  assert.equal(recovery.alerts[0].alert_id, reminder.alerts[0].alert_id);
  assert.equal(recovery.alerts[0].fingerprint, reminder.alerts[0].fingerprint);
  assert.notEqual(recovery.batch_id, reminder.batch_id);
});

test("every resource type maps to a contract entity.type with string-only maps", () => {
  const cases: Array<Partial<IncidentEntity>> = [
    {
      type: "DRIVER_UNHEALTHY",
      severity: IncidentSeverity.WARNING,
      resourceType: "DRIVER",
      resourceKey: "node-id:docker",
      resourceName: "nomadclientwest2/docker",
      contextJson: { nodeId: "node-id", nodeName: "nomadclientwest2", nodeAddress: "10.30.0.22", driver: "docker", Healthy: false },
    },
    {
      type: "ALLOCATION_FAILED",
      severity: IncidentSeverity.MAJOR,
      resourceType: "ALLOCATION",
      resourceKey: "default:web:app:0",
      resourceName: "web.app[0]",
      contextJson: {
        logicalAllocation: { namespace: "default", jobId: "web", taskGroup: "app", slot: "0" },
        currentAllocation: { ID: "alloc-1", NodeName: "nomadclientwest2", ClientStatus: "failed", TaskStates: {} },
        observedAllocationIds: ["alloc-1"],
      },
    },
    {
      type: "EVALUATION_BLOCKED",
      severity: IncidentSeverity.MAJOR,
      resourceType: "EVALUATION",
      resourceKey: "eval-1",
      resourceName: "web",
      contextJson: { ID: "eval-1", JobID: "web", Namespace: "default", Status: "blocked" },
    },
    {
      source: "SSL",
      type: "SSL_CERTIFICATE_EXPIRING",
      severity: IncidentSeverity.WARNING,
      resourceType: "CLUSTER_SSL_CERTIFICATE",
      resourceKey: "1",
      resourceName: "Cluster WEST",
      contextJson: { endpoint: "https://cluster.example", daysRemaining: 10, expiresAt: "2026-10-09T00:00:00.000Z" },
    },
  ];

  const expected = [
    { type: "nomad_node", hostKey: "nomadclientwest2", ip: "10.30.0.22" },
    { type: "other", hostKey: "", ip: undefined },
    { type: "other", hostKey: "", ip: undefined },
    { type: "cluster", hostKey: "", ip: undefined },
  ];

  cases.forEach((overrides, index) => {
    const alert = buildAlertWebhookPayload({ kind: "INITIAL", incident: incident(overrides) }, cluster).alerts[0];
    assert.ok(ENTITY_TYPES.includes(alert.entity.type));
    assert.equal(alert.entity.type, expected[index].type);
    assert.equal(alert.entity.host_key, expected[index].hostKey);
    // Optional fields are omitted, never null.
    if (expected[index].ip === undefined) assert.equal("ip" in alert.entity, false);
    else assert.equal((alert.entity as { ip?: string }).ip, expected[index].ip);
    assertStringMap(alert.dimensions);
    assertStringMap(alert.context);
  });

  const ssl = buildAlertWebhookPayload({ kind: "INITIAL", incident: incident(cases[3]) }, cluster).alerts[0];
  assert.deepEqual(ssl.context, {
    endpoint: "https://cluster.example",
    expires_at: "2026-10-09T00:00:00.000Z",
    days_remaining: "10",
  });
});

test("long values are truncated to contract limits", () => {
  const payload = buildAlertWebhookPayload(
    {
      kind: "INITIAL",
      incident: incident({ message: "x".repeat(5000), resourceName: "n".repeat(600) }),
    },
    { ...cluster, clusterName: "c".repeat(300) },
  );
  const [alert] = payload.alerts;

  assert.equal(payload.collector.source_instance.length, 120);
  assert.equal(alert.description.length, 4096);
  assert.equal(alert.title.length, 512);
  assert.equal(alert.entity.name.length, 256);
  assert.ok(alert.entity.host_key.length <= 256);
  assert.equal(alert.dimensions.cluster.length, 256);
});

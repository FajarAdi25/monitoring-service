import assert from "node:assert/strict";
import test from "node:test";
import type { IncidentEntity } from "../src/modules/incidents/incident.entity";
import { IncidentSeverity, IncidentStatus } from "../src/modules/incidents/incident.enums";
import { HttpWebhookAlertNotifier } from "../src/modules/alerting/alerting.notifier";
import type { AlertNotificationKind } from "../src/modules/alerting/alerting.types";
import { fakeClusterRepository } from "./test-fixtures";

function makeIncident(overrides: Partial<IncidentEntity> = {}): IncidentEntity {
  return {
    id: "1",
    publicId: "INC-00123",
    clusterId: "1",
    source: "NOMAD",
    type: "DRIVER_UNHEALTHY",
    severity: IncidentSeverity.WARNING,
    resourceType: "DRIVER",
    resourceKey: "node-id:docker",
    resourceName: "nomadworker-east-4/docker",
    fingerprint: "fingerprint",
    activeFingerprint: "fingerprint",
    status: IncidentStatus.OPEN,
    message: "Docker driver unhealthy",
    contextJson: null,
    openedAt: new Date("2026-08-19T03:00:00.000Z"),
    lastDetectedAt: new Date("2026-08-19T03:00:00.000Z"),
    lastNotificationAt: null,
    nextNotificationAt: null,
    reminderCount: 1,
    acknowledgedAt: null,
    acknowledgedBy: null,
    acknowledgedByUserName: null,
    acknowledgedByUsername: null,
    acknowledgementNote: null,
    postponedAt: null,
    postponedBy: null,
    postponedByUserName: null,
    postponedByUsername: null,
    postponeUntil: null,
    postponeRemark: null,
    resolvedAt: null,
    createdAt: new Date("2026-08-19T03:00:00.000Z"),
    updatedAt: new Date("2026-08-19T03:00:00.000Z"),
    ...overrides
  };
}

async function sendAndReadPayload(
  kind: AlertNotificationKind,
  incident: IncidentEntity,
  clusters = fakeClusterRepository()
) {
  const originalFetch = globalThis.fetch;
  let body: string | undefined;

  globalThis.fetch = async (_input, init) => {
    body = init?.body as string | undefined;
    return new Response(null, { status: 200 });
  };

  try {
    const notifier = new HttpWebhookAlertNotifier(clusters, "http://telegram.test/webhooks/alerts");
    await notifier.send({ kind, incident });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(body, "webhook request body should be present");
  return JSON.parse(body) as { incident: Record<string, unknown> };
}

test("REMINDER includes ACK and POSTPONE metadata when incident has both actions", async () => {
  const incident = makeIncident({
    acknowledgedAt: new Date("2026-08-19T03:05:00.000Z"),
    acknowledgedBy: "101",
    acknowledgedByUserName: "Budi Santoso",
    acknowledgementNote: "Sedang dicek",
    postponedAt: new Date("2026-08-19T03:10:00.000Z"),
    postponedBy: "101",
    postponedByUserName: "Budi Santoso",
    postponeUntil: new Date("2026-08-19T04:00:00.000Z"),
    postponeRemark: "Menunggu maintenance selesai"
  });

  const payload = await sendAndReadPayload("REMINDER", incident);

  assert.equal(payload.incident.acknowledgedAt, "2026-08-19T03:05:00.000Z");
  assert.equal(payload.incident.acknowledgedByUserName, "Budi Santoso");
  assert.equal(payload.incident.acknowledgementNote, "Sedang dicek");
  assert.equal(payload.incident.postponedAt, "2026-08-19T03:10:00.000Z");
  assert.equal(payload.incident.postponedByUserName, "Budi Santoso");
  assert.equal(payload.incident.postponeUntil, "2026-08-19T04:00:00.000Z");
  assert.equal(payload.incident.postponeRemark, "Menunggu maintenance selesai");
  assert.equal(payload.incident.reminderCount, 2);
});

test("RESOLVED includes persisted ACK and POSTPONE metadata", async () => {
  const incident = makeIncident({
    status: IncidentStatus.RESOLVED,
    resolvedAt: new Date("2026-08-19T03:17:30.000Z"),
    acknowledgedAt: new Date("2026-08-19T03:05:00.000Z"),
    acknowledgedByUserName: "Budi Santoso",
    acknowledgementNote: "Sedang dicek",
    postponedAt: new Date("2026-08-19T03:10:00.000Z"),
    postponedByUserName: "Budi Santoso",
    postponeUntil: new Date("2026-08-19T04:00:00.000Z"),
    postponeRemark: "Menunggu maintenance selesai"
  });

  const payload = await sendAndReadPayload("RESOLVED", incident);

  assert.equal(payload.incident.acknowledgedAt, "2026-08-19T03:05:00.000Z");
  assert.equal(payload.incident.postponeUntil, "2026-08-19T04:00:00.000Z");
  assert.equal(payload.incident.reminderCount, 1);
});

test("INITIAL without ACK or POSTPONE keeps action metadata out of payload", async () => {
  const payload = await sendAndReadPayload("INITIAL", makeIncident());

  assert.equal("acknowledgedAt" in payload.incident, false);
  assert.equal("acknowledgedByUserName" in payload.incident, false);
  assert.equal("acknowledgementNote" in payload.incident, false);
  assert.equal("postponedAt" in payload.incident, false);
  assert.equal("postponedByUserName" in payload.incident, false);
  assert.equal("postponeUntil" in payload.incident, false);
  assert.equal("postponeRemark" in payload.incident, false);
});

for (const kind of ["INITIAL", "REMINDER", "RESOLVED"] as const) {
  test(`${kind} includes approved cluster metadata`, async () => {
    const payload = await sendAndReadPayload(kind, makeIncident());
    assert.equal(payload.incident.clusterName, "Cluster EAST");
    assert.equal(payload.incident.site, "cawang");
    assert.equal(payload.incident.appName, "Nomad East Lab App");
    assert.equal(payload.incident.env, "PRODUCTION");
    assert.equal("url" in payload.incident, false);
    assert.equal("token" in payload.incident, false);
    assert.equal("clusterId" in payload.incident, false);
  });
}

test("notification fails when incident cluster metadata is missing", async () => {
  const notifier = new HttpWebhookAlertNotifier(
    fakeClusterRepository({ clusters: [] }),
    "http://telegram.test/webhooks/alerts"
  );
  await assert.rejects(
    notifier.send({ kind: "INITIAL", incident: makeIncident({ clusterId: "99" }) }),
    /Cluster metadata missing/
  );
});

// Version: 2.7.1
import assert from "node:assert/strict";
import test from "node:test";
import type { AlertDeliveryEntity } from "../src/modules/alerting/alert-delivery.entity";
import type { AlertDeliveryRepositoryPort } from "../src/modules/alerting/alert-delivery.repository";
import { AlertDeliverySender } from "../src/modules/alerting/alert-delivery.sender";
import type { AlertWebhookResponse, AlertWebhookTransport } from "../src/modules/alerting/alerting.notifier";

const NOW = new Date("2026-09-29T01:00:00.000Z");

function delivery(): AlertDeliveryEntity {
  return {
    id: "1",
    incidentId: "10",
    kind: "RESOLVED",
    batchId: "0191f4b1-2a3c-4d4e-8f50-112233445566",
    payloadJson: { batch_id: "0191f4b1-2a3c-4d4e-8f50-112233445566" },
    status: "PENDING",
    attemptCount: 0,
    lastStatusCode: null,
    lastError: null,
    nextAttemptAt: NOW,
    sentAt: null,
  } as AlertDeliveryEntity;
}

async function run(respond: () => Promise<AlertWebhookResponse>) {
  const row = delivery();
  const sentPayloads: Array<Record<string, unknown>> = [];
  const repository: AlertDeliveryRepositoryPort = {
    create: input => input as AlertDeliveryEntity,
    save: async entity => entity,
    findDue: async () => [row],
  };
  const transport: AlertWebhookTransport = {
    post: async payload => {
      sentPayloads.push(payload);
      return respond();
    },
  };

  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = () => {};
  console.error = () => {};
  try {
    await new AlertDeliverySender(repository, transport).processDue(NOW);
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
  return { row, sentPayloads };
}

test("202 marks the delivery SENT", async () => {
  const { row, sentPayloads } = await run(async () => ({
    statusCode: 202,
    body: JSON.stringify({ accepted: 1, rejected: 0, duplicate: false, errors: [] }),
  }));
  assert.equal(row.status, "SENT");
  assert.equal(row.sentAt, NOW);
  assert.equal(row.lastError, null);
  assert.equal(row.attemptCount, 1);
  assert.deepEqual(sentPayloads[0], { batch_id: "0191f4b1-2a3c-4d4e-8f50-112233445566" });
});

test("202 with rejected records is SENT and keeps the errors", async () => {
  const errors = [{ index: 0, field: "alerts[0].severity", reason: "unknown severity 'HIGH'" }];
  const { row } = await run(async () => ({
    statusCode: 202,
    body: JSON.stringify({ accepted: 0, rejected: 1, duplicate: false, errors }),
  }));
  assert.equal(row.status, "SENT");
  assert.equal(row.lastError, JSON.stringify(errors));
});

test("200 duplicate is SENT", async () => {
  const { row } = await run(async () => ({ statusCode: 200, body: '{"duplicate":true}' }));
  assert.equal(row.status, "SENT");
});

test("503 stays PENDING and retries after Retry-After", async () => {
  const { row } = await run(async () => ({ statusCode: 503, body: "busy", retryAfterSec: 7 }));
  assert.equal(row.status, "PENDING");
  assert.equal(row.nextAttemptAt.getTime(), NOW.getTime() + 7000);
});

test("500 stays PENDING with backoff", async () => {
  const { row } = await run(async () => ({ statusCode: 500, body: "boom" }));
  assert.equal(row.status, "PENDING");
  assert.equal(row.nextAttemptAt.getTime(), NOW.getTime() + 5000);
});

test("transport error stays PENDING with backoff", async () => {
  const { row } = await run(async () => {
    throw new Error("ECONNREFUSED");
  });
  assert.equal(row.status, "PENDING");
  assert.equal(row.lastError, "ECONNREFUSED");
  assert.equal(row.nextAttemptAt.getTime(), NOW.getTime() + 5000);
});

for (const statusCode of [400, 401, 403, 413, 415]) {
  test(`${statusCode} is FAILED without retry`, async () => {
    const { row } = await run(async () => ({ statusCode, body: '{"error":"x"}' }));
    assert.equal(row.status, "FAILED");
    assert.equal(row.lastStatusCode, statusCode);
  });
}

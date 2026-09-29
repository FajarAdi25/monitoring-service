// Version: 2.7.1
import type { AlertDeliveryEntity } from "./alert-delivery.entity";
import type { AlertDeliveryRepositoryPort } from "./alert-delivery.repository";
import type { AlertWebhookResponse, AlertWebhookTransport } from "./alerting.notifier";

const DEFAULT_RETRY_AFTER_SEC = 5;
const BACKOFF_BASE_MS = 5000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;

function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(attempt - 1, 0), BACKOFF_MAX_MS);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Sends queued alert batches to REINTAKE following contract v1.0 section 7.4:
 * - 202 / 200 duplicate: sent
 * - 503: retry after Retry-After (default 5s) with the same batch_id
 * - 500 or transport error: retry with backoff with the same batch_id
 * - any other status: failed, no retry
 */
export class AlertDeliverySender {
  constructor(
    private readonly deliveries: AlertDeliveryRepositoryPort,
    private readonly transport: AlertWebhookTransport,
  ) {}

  async processDue(now = new Date()): Promise<void> {
    const due = await this.deliveries.findDue(now, 100);
    for (const delivery of due) {
      await this.attempt(delivery, now);
    }
  }

  private async attempt(delivery: AlertDeliveryEntity, now: Date): Promise<void> {
    delivery.attemptCount += 1;

    try {
      const response = await this.transport.post(delivery.payloadJson);
      this.applyResponse(delivery, response, now);
    } catch (error) {
      delivery.lastStatusCode = null;
      delivery.lastError = errorMessage(error);
      delivery.nextAttemptAt = new Date(now.getTime() + backoffMs(delivery.attemptCount));
      console.error(
        `[ALERT:DELIVERY] batch=${delivery.batchId} kind=${delivery.kind} transport error; retrying`,
        error,
      );
    }

    await this.deliveries.save(delivery);
  }

  private applyResponse(
    delivery: AlertDeliveryEntity,
    response: AlertWebhookResponse,
    now: Date,
  ): void {
    const { statusCode, body } = response;
    delivery.lastStatusCode = statusCode;

    if (statusCode === 202 || statusCode === 200) {
      delivery.status = "SENT";
      delivery.sentAt = now;
      delivery.lastError = this.rejectedRecords(body);
      if (delivery.lastError) {
        console.warn(
          `[ALERT:DELIVERY] batch=${delivery.batchId} kind=${delivery.kind} record rejected: ${delivery.lastError}`,
        );
      }
      return;
    }

    delivery.lastError = body.slice(0, 4000) || `HTTP ${statusCode}`;

    if (statusCode === 503) {
      const retryAfterSec = response.retryAfterSec ?? DEFAULT_RETRY_AFTER_SEC;
      delivery.nextAttemptAt = new Date(now.getTime() + retryAfterSec * 1000);
      console.warn(
        `[ALERT:DELIVERY] batch=${delivery.batchId} kind=${delivery.kind} HTTP 503; retry in ${retryAfterSec}s`,
      );
      return;
    }

    if (statusCode === 500) {
      delivery.nextAttemptAt = new Date(now.getTime() + backoffMs(delivery.attemptCount));
      console.warn(
        `[ALERT:DELIVERY] batch=${delivery.batchId} kind=${delivery.kind} HTTP 500; retrying with backoff`,
      );
      return;
    }

    delivery.status = "FAILED";
    console.error(
      `[ALERT:DELIVERY] batch=${delivery.batchId} kind=${delivery.kind} HTTP ${statusCode}; not retried: ${delivery.lastError}`,
    );
  }

  /** Returns the REINTAKE `errors` list when a 202 response rejected records, otherwise null. */
  private rejectedRecords(body: string): string | null {
    try {
      const parsed = JSON.parse(body) as { rejected?: unknown; errors?: unknown };
      if (typeof parsed.rejected === "number" && parsed.rejected > 0) {
        return JSON.stringify(parsed.errors ?? []).slice(0, 4000);
      }
    } catch {
      // Non-JSON 2xx body: nothing to record.
    }
    return null;
  }
}

// Version: 2.9.0
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import type {
  ClusterMetadata,
  ClusterRepositoryPort,
} from "../clusters/cluster.types";
import type { IncidentEntity } from "../incidents/incident.entity";
import type { AlertDeliveryRepositoryPort } from "./alert-delivery.repository";
import type { AlertNotification } from "./alerting.types";

/** Queues an INITIAL, REMINDER, or RESOLVED alert for delivery to REINTAKE. */
export interface AlertNotifier {
  send(notification: AlertNotification): Promise<void>;
}

const METRIC_SOURCE = "hashicorp";
const COLLECTOR_NAME = "hashicorp-metric-collector";
const COLLECTOR_VERSION = readServiceVersion();
const MAX_MAP_KEYS = 20;

// REINTAKE contract v1.0 length limits.
const LIMIT = {
  collectorField: 120,
  fingerprint: 512,
  title: 512,
  description: 4096,
  entityName: 256,
  hostKey: 256,
  sourceId: 256,
  ip: 64,
  mapValue: 256,
} as const;

// REINTAKE entity.type enum only allows nomad_node among Nomad resources.
const ENTITY_TYPE: Record<string, string> = {
  NODE: "nomad_node",
  DRIVER: "nomad_node",
  ALLOCATION: "other",
  EVALUATION: "other",
  CLUSTER_SSL_CERTIFICATE: "cluster",
};

function readServiceVersion(): string {
  try {
    // dist/modules/alerting (or src/modules/alerting) -> project root package.json
    const packageJson = JSON.parse(
      readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"),
    ) as { version?: string };
    return packageJson.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function contextString(
  context: Record<string, unknown>,
  key: string,
): string | null {
  const value = context[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/** Builds a REINTAKE string -> string map: primitives only, max 20 keys, values max 256 chars. */
function stringMap(entries: Array<[string, unknown]>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (Object.keys(map).length >= MAX_MAP_KEYS) break;
    let text: string | null = null;
    if (typeof value === "string") text = value;
    else if (typeof value === "number" && Number.isFinite(value)) text = String(value);
    else if (typeof value === "boolean") text = String(value);
    if (text === null || text === "") continue;
    map[key] = truncate(text, LIMIT.mapValue);
  }
  return map;
}

function hostKey(incident: IncidentEntity): string {
  const context = asRecord(incident.contextJson);
  const nodeName = incident.resourceType === "NODE"
    ? incident.resourceName
    : incident.resourceType === "DRIVER"
      ? contextString(context, "nodeName")
      : null;
  if (!nodeName) return "";
  return truncate(nodeName.split(".")[0].toLowerCase(), LIMIT.hostKey);
}

function entityIp(incident: IncidentEntity): string | null {
  const context = asRecord(incident.contextJson);
  if (incident.resourceType === "NODE") return contextString(context, "Address");
  if (incident.resourceType === "DRIVER") return contextString(context, "nodeAddress");
  return null;
}

/**
 * `[<site>/<cluster>] <type> - <resource name>`.
 * ALLOCATION: `[<site>/<cluster>] ALLOCATION_FAILED - job <failed|degraded> - alloc fail <x> of <y> - <allocation> on <node>`.
 */
function alertTitle(incident: IncidentEntity, cluster: ClusterMetadata): string {
  const prefix = `[${cluster.site}/${cluster.clusterName}] ${incident.type}`;
  if (incident.resourceType !== "ALLOCATION") {
    return `${prefix} - ${incident.resourceName ?? incident.resourceKey}`;
  }

  const context = asRecord(incident.contextJson);
  const current = asRecord(context.currentAllocation);
  const summary = asRecord(context.jobSummary);
  const nodeName = contextString(current, "NodeName");
  const status = contextString(summary, "status");

  let title = prefix;
  if (status) {
    title += ` - job ${status.toLowerCase()} - alloc fail ${summary.failed} of ${summary.total}`;
    title += ` - ${contextString(current, "Name") ?? incident.resourceName ?? incident.resourceKey}`;
  } else {
    // Per-slot incidents created before alerts were grouped per job.
    title += ` - ${incident.resourceName ?? incident.resourceKey}`;
  }
  if (nodeName) title += ` on ${nodeName}`;
  return title;
}

function contextEntries(incident: IncidentEntity): Array<[string, unknown]> {
  const context = asRecord(incident.contextJson);
  switch (incident.resourceType) {
    case "NODE":
      return [
        ["node_id", context.ID],
        ["status", context.Status],
        ["status_description", context.StatusDescription],
      ];
    case "DRIVER":
      return [
        ["node_id", context.nodeId],
        ["node_name", context.nodeName],
        ["driver", context.driver],
        ["health_description", context.HealthDescription],
      ];
    case "ALLOCATION": {
      const logical = asRecord(context.logicalAllocation);
      const current = asRecord(context.currentAllocation);
      const summary = asRecord(context.jobSummary);
      return [
        ["namespace", logical.namespace],
        ["job_id", logical.jobId],
        ["job_status", summary.status],
        ["failed_allocations", summary.failed],
        ["running_allocations", summary.running],
        ["total_allocations", summary.total],
        ["task_group", logical.taskGroup],
        ["slot", logical.slot],
        ["allocation_id", current.ID],
        ["node_name", current.NodeName],
        ["client_status", current.ClientStatus],
        ["client_description", current.ClientDescription],
      ];
    }
    case "EVALUATION":
      return [
        ["evaluation_id", context.ID],
        ["job_id", context.JobID],
        ["namespace", context.Namespace],
        ["status", context.Status],
        ["status_description", context.StatusDescription],
      ];
    case "CLUSTER_SSL_CERTIFICATE":
      return [
        ["endpoint", context.endpoint],
        ["valid_from", context.validFrom],
        ["expires_at", context.expiresAt],
        ["days_remaining", context.daysRemaining],
        ["subject_cn", context.subjectCn],
        ["issuer_cn", context.issuerCn],
        ["certificate_fingerprint256", context.certificateFingerprint256],
      ];
    default:
      return [];
  }
}

/** Stable per incident so INITIAL, REMINDER, and RESOLVED share the same alert_id. */
function alertId(incident: IncidentEntity): string {
  const hex = createHash("sha256")
    .update(incident.publicId)
    .digest("hex")
    .slice(0, 24);
  return `HCP-A-${hex}`;
}

export function buildAlertWebhookPayload(
  notification: AlertNotification,
  cluster: ClusterMetadata,
  options: { batchId?: string; sentAtMs?: number } = {},
) {
  const { incident, kind } = notification;
  const resolved = kind === "RESOLVED";
  const entityType = ENTITY_TYPE[incident.resourceType] ?? "other";
  const context = asRecord(incident.contextJson);
  const ip = entityIp(incident);
  const startedAtMs = incident.openedAt.getTime();
  const resolvedAtMs = resolved
    ? (incident.resolvedAt ?? incident.lastDetectedAt).getTime()
    : null;

  return {
    schema_version: "1.0",
    batch_id: options.batchId ?? randomUUID(),
    metric_source: METRIC_SOURCE,
    collector: {
      name: COLLECTOR_NAME,
      version: truncate(COLLECTOR_VERSION, 40),
      source_instance: truncate(cluster.clusterName, LIMIT.collectorField),
      runtime_host: truncate(hostname(), LIMIT.collectorField),
    },
    delivery_mode: kind === "REMINDER" ? "poll_reconcile" : "push",
    sent_at_ms: options.sentAtMs ?? Date.now(),
    record_count: 1,
    alerts: [
      {
        alert_id: alertId(incident),
        fingerprint: truncate(
          [
            METRIC_SOURCE,
            entityType,
            incident.resourceKey,
            incident.type.toLowerCase(),
          ].join("|"),
          LIMIT.fingerprint,
        ),
        metric_source: METRIC_SOURCE,
        source_alert_id: incident.publicId,
        status: resolved ? "resolved" : "firing",
        severity: incident.severity.toLowerCase(),
        category: "platform",
        title: truncate(alertTitle(incident, cluster), LIMIT.title),
        description: truncate(incident.message, LIMIT.description),
        started_at_ms: startedAtMs,
        // RESOLVED must carry a newer updated_at_ms than the last firing record.
        updated_at_ms: Math.max(
          resolvedAtMs ?? incident.lastDetectedAt.getTime(),
          startedAtMs,
        ),
        resolved_at_ms: resolvedAtMs,
        entity: {
          type: entityType,
          name: truncate(
            incident.resourceName ?? incident.resourceKey,
            LIMIT.entityName,
          ),
          host_key: hostKey(incident),
          source_id: truncate(incident.resourceKey, LIMIT.sourceId),
          ...(ip ? { ip: truncate(ip, LIMIT.ip) } : {}),
        },
        trigger: null,
        dimensions: stringMap([
          ["cluster", cluster.clusterName],
          ["site", cluster.site],
          ["app", cluster.appName],
          ["env", cluster.env],
          ...(incident.resourceType === "NODE"
            ? ([
                ["datacenter", context.Datacenter],
                ["node_pool", context.NodePool],
              ] as Array<[string, unknown]>)
            : []),
        ]),
        context: stringMap(contextEntries(incident)),
      },
    ],
  };
}

export type AlertWebhookPayload = ReturnType<typeof buildAlertWebhookPayload>;

async function metadataFor(
  clusters: ClusterRepositoryPort,
  notification: AlertNotification,
): Promise<ClusterMetadata> {
  const cluster = await clusters.findMetadataById(
    notification.incident.clusterId,
  );
  if (!cluster) {
    throw new Error(
      `Cluster metadata missing for cluster ${notification.incident.clusterId}.`,
    );
  }
  return cluster;
}

/** Stores the alert batch in alert_deliveries; AlertDeliverySender sends it. */
export class QueuedAlertNotifier implements AlertNotifier {
  constructor(
    private readonly clusters: ClusterRepositoryPort,
    private readonly deliveries: AlertDeliveryRepositoryPort,
  ) {}

  async send(notification: AlertNotification): Promise<void> {
    const cluster = await metadataFor(this.clusters, notification);
    const payload = buildAlertWebhookPayload(notification, cluster);
    await this.deliveries.save(
      this.deliveries.create({
        incidentId: notification.incident.id,
        kind: notification.kind,
        batchId: payload.batch_id,
        payloadJson: payload,
        status: "PENDING",
        attemptCount: 0,
        lastStatusCode: null,
        lastError: null,
        nextAttemptAt: new Date(),
        sentAt: null,
      }),
    );
  }
}

export interface AlertWebhookResponse {
  statusCode: number;
  body: string;
  retryAfterSec?: number;
}

export interface AlertWebhookTransport {
  post(payload: Record<string, unknown>): Promise<AlertWebhookResponse>;
}

export class HttpAlertWebhookTransport implements AlertWebhookTransport {
  constructor(
    private readonly webhookUrl: string,
    private readonly token?: string,
    private readonly timeoutMs = 10000,
  ) {}

  async post(payload: Record<string, unknown>): Promise<AlertWebhookResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const retryAfter = Number(response.headers.get("retry-after"));
      return {
        statusCode: response.status,
        body: await response.text(),
        ...(Number.isFinite(retryAfter) && retryAfter > 0
          ? { retryAfterSec: retryAfter }
          : {}),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Used when ALERT_WEBHOOK_URL is empty: logs the batch and reports it as accepted. */
export class ConsoleAlertWebhookTransport implements AlertWebhookTransport {
  async post(payload: Record<string, unknown>): Promise<AlertWebhookResponse> {
    console.log(`[ALERT:WEBHOOK] ${JSON.stringify(payload)}`);
    return {
      statusCode: 202,
      body: JSON.stringify({ accepted: 1, rejected: 0, duplicate: false, errors: [] }),
    };
  }
}

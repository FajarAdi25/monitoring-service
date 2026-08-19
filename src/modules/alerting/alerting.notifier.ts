import type { ClusterMetadata, ClusterRepositoryPort } from "../clusters/cluster.types";
import type { AlertNotification } from "./alerting.types";

export interface AlertNotifier {
  send(notification: AlertNotification): Promise<void>;
}

function toWebhookPayload(notification: AlertNotification, cluster: ClusterMetadata) {
  const { incident, kind } = notification;
  return {
    event: "INCIDENT_ALERT",
    kind,
    incident: {
      id: incident.publicId,
      status: incident.status,
      source: incident.source,
      type: incident.type,
      severity: incident.severity,
      resource: {
        type: incident.resourceType,
        key: incident.resourceKey,
        name: incident.resourceName
      },
      message: incident.message,
      clusterName: cluster.clusterName,
      site: cluster.site,
      appName: cluster.appName,
      env: cluster.env,
      openedAt: incident.openedAt.toISOString(),
      resolvedAt: incident.resolvedAt?.toISOString() ?? null,
      reminderCount: kind === "REMINDER"
        ? incident.reminderCount + 1
        : incident.reminderCount,
      ...(incident.acknowledgedAt !== null
        ? {
            acknowledgedAt: incident.acknowledgedAt.toISOString(),
            acknowledgedByUserName: incident.acknowledgedByUserName,
            acknowledgementNote: incident.acknowledgementNote
          }
        : {}),
      ...(incident.postponedAt !== null
        ? {
            postponedAt: incident.postponedAt.toISOString(),
            postponedByUserName: incident.postponedByUserName,
            postponeUntil: incident.postponeUntil?.toISOString() ?? null,
            postponeRemark: incident.postponeRemark
          }
        : {})
    }
  };
}

async function metadataFor(
  clusters: ClusterRepositoryPort,
  notification: AlertNotification
): Promise<ClusterMetadata> {
  const cluster = await clusters.findMetadataById(notification.incident.clusterId);
  if (!cluster) {
    throw new Error(`Cluster metadata missing for cluster ${notification.incident.clusterId}.`);
  }
  return cluster;
}

export class ConsoleAlertNotifier implements AlertNotifier {
  constructor(private readonly clusters: ClusterRepositoryPort) {}

  async send(notification: AlertNotification): Promise<void> {
    const cluster = await metadataFor(this.clusters, notification);
    console.log(`[ALERT:${notification.kind}] ${JSON.stringify(toWebhookPayload(notification, cluster))}`);
  }
}

export class HttpWebhookAlertNotifier implements AlertNotifier {
  constructor(
    private readonly clusters: ClusterRepositoryPort,
    private readonly webhookUrl: string,
    private readonly timeoutMs = 5000
  ) {}

  async send(notification: AlertNotification): Promise<void> {
    const cluster = await metadataFor(this.clusters, notification);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toWebhookPayload(notification, cluster)),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Webhook returned HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

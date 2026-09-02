// Version: 2.5.2
import type { ClusterRepositoryPort } from "../clusters/cluster.types";
import type { IncidentEntity } from "../incidents/incident.entity";

export interface IncidentWebhookNotifier {
  sendOpened(incident: IncidentEntity): Promise<void>;
  sendResolved(incident: IncidentEntity): Promise<void>;
}

function payload(incident: IncidentEntity, appName: string, eventType: string) {
  return {
    event_type: eventType,
    incident_id: incident.id,
    title: `${incident.type} - ${incident.resourceName ?? ""} - ${appName}`,
    description: incident.message,
    severity: incident.severity,
    source_service: incident.resourceName,
    detected_at: incident.openedAt,
  };
}

export class HttpIncidentWebhookNotifier implements IncidentWebhookNotifier {
  constructor(
    private readonly clusters: ClusterRepositoryPort,
    private readonly webhookUrl: string,
    private readonly apiKey?: string,
    private readonly timeoutMs = 5000,
  ) {}

  async sendOpened(incident: IncidentEntity): Promise<void> {
    await this.send(incident, "incident.opened");
  }

  async sendResolved(incident: IncidentEntity): Promise<void> {
    await this.send(incident, "incident.resolved");
  }

  private async send(incident: IncidentEntity, eventType: string): Promise<void> {
    const cluster = await this.clusters.findMetadataById(incident.clusterId);
    if (!cluster) {
      throw new Error(`Cluster metadata missing for cluster ${incident.clusterId}.`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
        },
        body: JSON.stringify(payload(incident, cluster.appName, eventType)),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Incident webhook returned HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

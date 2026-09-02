// Version: 2.5.2
import type { ClusterRepositoryPort } from "../clusters/cluster.types";
import type { IncidentEntity } from "../incidents/incident.entity";

export interface IncidentWebhookNotifier {
  sendOpened(incident: IncidentEntity): Promise<void>;
  sendResolved(incident: IncidentEntity): Promise<void>;
}

function payload(incident: IncidentEntity, _appName: string, eventType: string) {
  return {
    incident_id: incident.publicId,
    status: eventType,
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
    await this.send(incident, "OPEN");
  }

  async sendResolved(incident: IncidentEntity): Promise<void> {
    await this.send(incident, "RESOLVED");
  }

  private async send(
    incident: IncidentEntity,
    eventType: string,
  ): Promise<void> {
    const cluster = await this.clusters.findMetadataById(incident.clusterId);
    if (!cluster) {
      throw new Error(
        `Cluster metadata missing for cluster ${incident.clusterId}.`,
      );
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

      console.log(
        `Incident webhook sent for incident ${incident.id} with event type ${eventType}.`,
      );
      if (!response.ok) {
        throw new Error(`Incident webhook returned HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

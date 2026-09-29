import { IncidentRepository } from "../incidents/incident.repository";
import type { AlertDeliverySender } from "./alert-delivery.sender";
import type { AlertNotifier } from "./alerting.notifier";

export class AlertingWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly incidentRepository: IncidentRepository,
    private readonly notifier: AlertNotifier,
    private readonly sender: AlertDeliverySender,
    private readonly pollIntervalMs: number,
    private readonly openReminderIntervalMs: number
  ) {}

  start(): void {
    if (this.timer) return;

    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      await this.processOpenNotifications(now);
      await this.sender.processDue(now);
    } finally {
      this.running = false;
    }
  }

  private async processOpenNotifications(now: Date): Promise<void> {
    const incidents = await this.incidentRepository.findDueOpenNotifications(now, 100);

    for (const incident of incidents) {
      try {
        const kind = incident.lastNotificationAt === null
          ? "INITIAL" as const
          : "REMINDER" as const;

        await this.notifier.send({ kind, incident });

        const nextNotificationAt = new Date(now.getTime() + this.getReminderIntervalMs(incident));

        await this.incidentRepository.markNotificationSent(
          incident.publicId,
          now,
          nextNotificationAt,
          kind === "REMINDER"
        );
      } catch (error) {
        console.error(`Failed to queue alert for incident ${incident.publicId}`, error);
      }
    }
  }

  private getReminderIntervalMs(incident: { type: string; severity: string }): number {
    if (incident.type === "SSL_CERTIFICATE_EXPIRING") return 24 * 60 * 60 * 1000;
    if (incident.severity === "CRITICAL") return 60 * 1000;
    return 5 * 60 * 1000;
  }
}

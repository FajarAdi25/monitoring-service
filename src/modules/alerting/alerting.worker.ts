import { IncidentRepository } from "../incidents/incident.repository";
import type { AlertNotifier } from "./alerting.notifier";

export class AlertingWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly incidentRepository: IncidentRepository,
    private readonly notifier: AlertNotifier,
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

        const regularNextNotificationAt = new Date(now.getTime() + this.getReminderIntervalMs(incident));
        const nextNotificationAt = incident.postponeUntil !== null
          && incident.postponeUntil.getTime() > now.getTime()
          ? incident.postponeUntil
          : regularNextNotificationAt;

        await this.incidentRepository.markNotificationSent(
          incident.publicId,
          now,
          nextNotificationAt,
          kind === "REMINDER"
        );
      } catch (error) {
        console.error(`Failed to send alert for incident ${incident.publicId}`, error);
      }
    }
  }

  private getReminderIntervalMs(incident: { type: string; severity: string; acknowledgedAt: Date | null }): number {
    if (incident.type === "SSL_CERTIFICATE_EXPIRING") return 24 * 60 * 60 * 1000;
    if (incident.acknowledgedAt !== null) return 3 * 60 * 1000;
    if (incident.severity === "CRITICAL") return 60 * 1000;
    return 5 * 60 * 1000;
  }
}

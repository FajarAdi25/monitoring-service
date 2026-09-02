import { randomBytes } from "node:crypto";
import { IncidentEntity } from "../incidents/incident.entity";
import { IncidentStatus } from "../incidents/incident.enums";
import { IncidentRepository } from "../incidents/incident.repository";
import { IncidentService } from "../incidents/incident.service";
import type { FailureSignal, RecoverySignal } from "./alerting.types";
import type { AlertNotifier } from "./alerting.notifier";
import type { IncidentWebhookNotifier } from "./incident-webhook.notifier";

export class AlertingService {
  constructor(
    private readonly incidentRepository: IncidentRepository,
    private readonly incidentService: IncidentService,
    private readonly notifier: AlertNotifier,
    private readonly incidentWebhook?: IncidentWebhookNotifier
  ) {}

  async processFailure(
    signal: FailureSignal,
    options?: { legacyFingerprints?: string[] }
  ): Promise<IncidentEntity> {
    const detectedAt = signal.detectedAt ?? new Date();
    const existing = await this.incidentRepository.findOpenByActiveFingerprint(signal.fingerprint);

    if (existing) {
      existing.lastDetectedAt = detectedAt;
      existing.severity = signal.severity;
      existing.resourceKey = signal.resourceKey;
      existing.resourceName = signal.resourceName ?? existing.resourceName;
      existing.message = signal.message;
      existing.contextJson = signal.context ?? existing.contextJson;
      return this.incidentRepository.save(existing);
    }

    const legacyMatch = await this.findLegacyOpenIncident(
      options?.legacyFingerprints ?? [],
      signal.fingerprint
    );
    if (legacyMatch) {
      const { incident: legacy, fingerprint: legacyFingerprint } = legacyMatch;
      legacy.resourceKey = signal.resourceKey;
      legacy.severity = signal.severity;
      legacy.resourceName = signal.resourceName ?? legacy.resourceName;
      legacy.fingerprint = signal.fingerprint;
      legacy.activeFingerprint = signal.fingerprint;
      legacy.message = signal.message;
      legacy.contextJson = signal.context ?? legacy.contextJson;
      legacy.lastDetectedAt = detectedAt;

      try {
        return await this.incidentRepository.save(legacy);
      } catch (error) {
        if (this.isDuplicateKey(error)) {
          const concurrent = await this.incidentRepository.findOpenByActiveFingerprint(signal.fingerprint);
          if (concurrent) {
            await this.incidentService.resolveActiveByFingerprint(legacyFingerprint, detectedAt);
            concurrent.lastDetectedAt = detectedAt;
            concurrent.severity = signal.severity;
            return this.incidentRepository.save(concurrent);
          }
        }
        throw error;
      }
    }

    const incident = this.incidentRepository.create({
      publicId: this.generatePublicId(),
      clusterId: signal.clusterId,
      source: signal.source,
      type: signal.type,
      severity: signal.severity,
      resourceType: signal.resourceType,
      resourceKey: signal.resourceKey,
      resourceName: signal.resourceName ?? null,
      fingerprint: signal.fingerprint,
      activeFingerprint: signal.fingerprint,
      status: IncidentStatus.OPEN,
      message: signal.message,
      contextJson: signal.context ?? null,
      openedAt: detectedAt,
      lastDetectedAt: detectedAt,
      lastNotificationAt: null,
      nextNotificationAt: detectedAt,
      reminderCount: 0,
      acknowledgedAt: null,
      acknowledgedBy: null,
      acknowledgementNote: null,
      postponedAt: null,
      postponedBy: null,
      postponeUntil: null,
      postponeRemark: null,
      resolvedAt: null
    });

    try {
      const saved = await this.incidentRepository.save(incident);
      if (this.incidentWebhook) {
        try {
          await this.incidentWebhook.sendOpened(saved);
        } catch (error) {
          console.error(`Failed to send incident.opened webhook for incident ${saved.id}`, error);
        }
      }
      return saved;
    } catch (error) {
      if (this.isDuplicateKey(error)) {
        const concurrent = await this.incidentRepository.findOpenByActiveFingerprint(signal.fingerprint);
        if (concurrent) {
          concurrent.lastDetectedAt = detectedAt;
          concurrent.severity = signal.severity;
          return this.incidentRepository.save(concurrent);
        }
      }
      throw error;
    }
  }

  async processRecovery(signal: RecoverySignal): Promise<IncidentEntity | null> {
    const resolvedAt = signal.detectedAt ?? new Date();
    const incident = await this.incidentService.resolveActiveByFingerprint(
      signal.fingerprint,
      resolvedAt
    );

    if (!incident) return null;

    if (this.incidentWebhook) {
      try {
        await this.incidentWebhook.sendResolved(incident);
      } catch (error) {
        console.error(`Failed to send incident.resolved webhook for incident ${incident.id}`, error);
      }
    }

    try {
      await this.notifier.send({ kind: "RESOLVED", incident });
    } catch (error) {
      console.error(`Failed to send RESOLVED alert for incident ${incident.publicId}`, error);
    }

    return incident;
  }

  private async findLegacyOpenIncident(
    fingerprints: string[],
    currentFingerprint: string
  ): Promise<{ incident: IncidentEntity; fingerprint: string } | null> {
    for (const fingerprint of new Set(fingerprints)) {
      if (!fingerprint || fingerprint === currentFingerprint) continue;
      const incident = await this.incidentRepository.findOpenByActiveFingerprint(fingerprint);
      if (incident) return { incident, fingerprint };
    }
    return null;
  }

  private generatePublicId(): string {
    return `INC-${Date.now()}-${randomBytes(3).toString("hex").toUpperCase()}`;
  }

  private isDuplicateKey(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const candidate = error as { code?: string; errno?: number };
    return candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062;
  }
}

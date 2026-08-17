import type { IncidentEntity } from "../incidents/incident.entity";
import type { IncidentSeverity } from "../incidents/incident.enums";

export interface FailureSignal {
  clusterId: string;
  source: string;
  type: string;
  severity: IncidentSeverity;
  resourceType: string;
  resourceKey: string;
  resourceName?: string | null;
  fingerprint: string;
  message: string;
  context?: Record<string, unknown> | null;
  detectedAt?: Date;
}

export interface RecoverySignal {
  fingerprint: string;
  detectedAt?: Date;
}

export type AlertNotificationKind =
  | "INITIAL"
  | "REMINDER"
  | "RESOLVED";

export interface AlertNotification {
  kind: AlertNotificationKind;
  incident: IncidentEntity;
}

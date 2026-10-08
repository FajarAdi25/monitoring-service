import { IncidentSeverity } from "../incidents/incident.enums";

export const NOMAD_INCIDENT_SEVERITY = {
  NODE_DOWN: IncidentSeverity.CRITICAL,
  ALLOCATION_JOB_FAILED: IncidentSeverity.MAJOR,
  ALLOCATION_JOB_DEGRADED: IncidentSeverity.WARNING,
  EVALUATION_BLOCKED: IncidentSeverity.MAJOR,
  DRIVER_UNHEALTHY: IncidentSeverity.CRITICAL
} as const;

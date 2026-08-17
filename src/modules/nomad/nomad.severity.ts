import { IncidentSeverity } from "../incidents/incident.enums";

export const NOMAD_INCIDENT_SEVERITY = {
  NODE_DOWN: IncidentSeverity.CRITICAL,
  ALLOCATION_FAILED: IncidentSeverity.MAJOR,
  EVALUATION_BLOCKED: IncidentSeverity.MAJOR,
  DRIVER_UNHEALTHY: IncidentSeverity.WARNING
} as const;

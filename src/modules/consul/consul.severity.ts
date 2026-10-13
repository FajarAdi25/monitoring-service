import { IncidentSeverity } from "../incidents/incident.enums";

export const CONSUL_INCIDENT_SEVERITY = {
  NO_LEADER: IncidentSeverity.CRITICAL,
  SERVER_UNHEALTHY: IncidentSeverity.CRITICAL,
  NODE_CRITICAL: IncidentSeverity.CRITICAL,
  SERVICE_FAILED: IncidentSeverity.MAJOR,
  SERVICE_DEGRADED: IncidentSeverity.WARNING
} as const;

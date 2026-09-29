import type { IncidentSeverity, IncidentStatus } from "./incident.enums";

export interface IncidentListFilters {
  cluster?: string;
  site?: string;
  source?: string;
  type?: string;
  severity?: IncidentSeverity;
  status?: IncidentStatus;
  resourceType?: string;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
}

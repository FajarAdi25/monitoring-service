import type { IncidentSeverity, IncidentStatus } from "./incident.enums";

export interface IncidentListFilters {
  cluster?: string;
  source?: string;
  type?: string;
  severity?: IncidentSeverity;
  status?: IncidentStatus;
  acknowledged?: boolean;
  resourceType?: string;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
}

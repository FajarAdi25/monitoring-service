export interface MonitoringCurrentStateFilters {
  clusterId?: string;
  site?: string;
  source?: string;
  resourceType?: string;
  resourceKey?: string;
  state?: string;
  from?: Date;
  to?: Date;
  limit: number;
}

export interface MonitoringCurrentStateFilters {
  clusterId?: string;
  source?: string;
  resourceType?: string;
  resourceKey?: string;
  state?: string;
  from?: Date;
  to?: Date;
  limit: number;
}

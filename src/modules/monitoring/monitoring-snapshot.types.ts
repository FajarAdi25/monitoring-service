export interface SaveMonitoringSnapshotInput {
  clusterId: string;
  source: string;
  resourceType: string;
  resourceKey: string;
  resourceName?: string | null;
  state: string;
  payload?: Record<string, unknown> | null;
  observedAt?: Date;
}

export interface MonitoringSnapshotFilters {
  clusterId?: string;
  source?: string;
  resourceType?: string;
  resourceKey?: string;
  limit: number;
}

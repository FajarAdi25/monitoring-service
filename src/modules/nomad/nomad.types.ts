export interface NomadDriverState {
  Attributes?: Record<string, string> | null;
  Detected?: boolean;
  Healthy?: boolean;
  HealthDescription?: string;
  UpdateTime?: string;
  [key: string]: unknown;
}

export interface NomadNode {
  ID: string;
  Name: string;
  Status: string;
  StatusDescription?: string;
  Datacenter?: string;
  Drivers?: Record<string, NomadDriverState> | null;
  [key: string]: unknown;
}

export interface NomadAllocation {
  ID: string;
  Name?: string;
  Namespace?: string;
  NodeID?: string;
  NodeName?: string;
  JobID?: string;
  TaskGroup?: string;
  DesiredStatus?: string;
  ClientStatus?: string;
  ClientDescription?: string;
  CreateIndex?: number;
  ModifyIndex?: number;
  CreateTime?: number;
  ModifyTime?: number;
  [key: string]: unknown;
}

export interface NomadEvaluation {
  ID?: string;
  Status?: string;
  JobID?: string;
  Namespace?: string;
  [key: string]: unknown;
}

export interface NomadPullResult {
  startedAt: string;
  finishedAt: string;
  nodes: number;
  allocations: number;
  blockedEvaluations: number;
  snapshotChanges: number;
  failuresProcessed: number;
  recoveriesProcessed: number;
}

import type { ClusterEntity } from "../clusters/cluster.entity";
import type { ClusterEnvironment } from "../clusters/cluster.enums";

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

export interface NomadClientPort {
  getNodes(): Promise<NomadNode[]>;
  getNode(nodeId: string): Promise<NomadNode>;
  getAllocations(): Promise<NomadAllocation[]>;
  getFailedAllocations(): Promise<NomadAllocation[]>;
  getAllocation(allocationId: string): Promise<NomadAllocation>;
  getJobSummary(jobId: string): Promise<Record<string, unknown>>;
  getBlockedEvaluations(): Promise<NomadEvaluation[]>;
}

export type NomadClientFactory = (cluster: ClusterEntity) => NomadClientPort;

export interface NomadClusterApiMetadata {
  clusterId: string | number;
  clusterName: string;
  site: string;
  appName: string;
  env: ClusterEnvironment;
}

export type NomadClusterItem<T> = T & NomadClusterApiMetadata;

export type NomadPullSuccessOutcome = NomadClusterApiMetadata & {
  success: true;
  result: NomadPullResult;
};

export type NomadPullFailureOutcome = NomadClusterApiMetadata & {
  success: false;
  error: { code: string; message: string };
};

export type NomadPullOutcome = NomadPullSuccessOutcome | NomadPullFailureOutcome;
export type ScopedNomadPullResult = NomadClusterApiMetadata & NomadPullResult;

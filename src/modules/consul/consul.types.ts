import type { ClusterEntity } from "../clusters/cluster.entity";
import type { ClusterEnvironment } from "../clusters/cluster.enums";

/** One entry of `GET /v1/health/state/:state`. `ServiceID` is empty for node-level checks. */
export interface ConsulHealthCheck {
  Node: string;
  CheckID: string;
  Name: string;
  Status: string;
  Notes?: string;
  Output?: string;
  ServiceID?: string;
  ServiceName?: string;
  ServiceTags?: string[] | null;
  Namespace?: string;
  [key: string]: unknown;
}

export interface ConsulHealthChecksResult {
  checks: ConsulHealthCheck[];
  /** `X-Consul-KnownLeader` header; null when the header is missing. */
  knownLeader: boolean | null;
}

export interface ConsulAutopilotServer {
  ID: string;
  Name: string;
  Address?: string;
  SerfStatus?: string;
  Version?: string;
  Leader?: boolean;
  LastContact?: string;
  LastTerm?: number;
  LastIndex?: number;
  Healthy?: boolean;
  Voter?: boolean;
  StableSince?: string;
  [key: string]: unknown;
}

export interface ConsulAutopilotHealth {
  Healthy: boolean;
  FailureTolerance: number;
  Servers: ConsulAutopilotServer[];
  [key: string]: unknown;
}

export type ConsulHealthState = "any" | "passing" | "warning" | "critical";

export interface ConsulPullResult {
  startedAt: string;
  finishedAt: string;
  datacenters: number;
  servers: number;
  nodes: number;
  services: number;
  snapshotChanges: number;
  failuresProcessed: number;
  recoveriesProcessed: number;
}

export interface ConsulClientPort {
  getDatacenters(): Promise<string[]>;
  /** Raft leader address of the datacenter; empty string when there is no leader. */
  getLeader(datacenter?: string): Promise<string>;
  getHealthChecks(state: ConsulHealthState, datacenter?: string): Promise<ConsulHealthChecksResult>;
  getAutopilotHealth(datacenter?: string): Promise<ConsulAutopilotHealth>;
}

export type ConsulClientFactory = (cluster: ClusterEntity) => ConsulClientPort;

export interface ConsulClusterApiMetadata {
  clusterId: string | number;
  clusterName: string;
  site: string;
  appName: string;
  env: ClusterEnvironment;
}

export type ConsulClusterItem<T> = T & ConsulClusterApiMetadata;

export type ConsulPullSuccessOutcome = ConsulClusterApiMetadata & {
  success: true;
  result: ConsulPullResult;
};

export type ConsulPullFailureOutcome = ConsulClusterApiMetadata & {
  success: false;
  error: { code: string; message: string };
};

export type ConsulPullOutcome = ConsulPullSuccessOutcome | ConsulPullFailureOutcome;
export type ScopedConsulPullResult = ConsulClusterApiMetadata & ConsulPullResult;

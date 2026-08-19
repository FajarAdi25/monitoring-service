import type { ClusterEntity } from "./cluster.entity";
import type { ClusterEnvironment } from "./cluster.enums";

export interface ClusterMetadata {
  clusterId: string;
  clusterName: string;
  site: string;
  appName: string;
  env: ClusterEnvironment;
}

export interface ClusterRepositoryPort {
  findAll(): Promise<ClusterEntity[]>;
  findById(clusterId: string): Promise<ClusterEntity | null>;
  findMetadataById(clusterId: string): Promise<ClusterMetadata | null>;
  findMetadataByIds(clusterIds: readonly string[]): Promise<Map<string, ClusterMetadata>>;
}

export function toClusterMetadata(cluster: ClusterEntity): ClusterMetadata {
  return {
    clusterId: cluster.clusterId,
    clusterName: cluster.clusterName,
    site: cluster.site,
    appName: cluster.appName,
    env: cluster.env
  };
}

export function serializeClusterId(clusterId: string): string | number {
  const numeric = Number(clusterId);
  return Number.isSafeInteger(numeric) ? numeric : clusterId;
}

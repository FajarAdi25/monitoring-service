import { ClusterEnvironment } from "../src/modules/clusters/cluster.enums";
import type { ClusterEntity } from "../src/modules/clusters/cluster.entity";
import type { ClusterRepositoryPort } from "../src/modules/clusters/cluster.types";
import { toClusterMetadata } from "../src/modules/clusters/cluster.types";

export const eastCluster = {
  clusterId: "1",
  url: "https://10.11.39.32:4646",
  clusterName: "Cluster EAST",
  site: "cawang",
  appName: "Nomad East Lab App",
  env: ClusterEnvironment.PRODUCTION,
  token: "f61f7a1e-57e6-fe85-90d8-e94fd311b298",
  createdAt: new Date("2026-08-19T00:00:00.000Z"),
  updatedAt: new Date("2026-08-19T00:00:00.000Z")
} as ClusterEntity;

export const westCluster = {
  clusterId: "2",
  url: "https://10.11.39.40:4646",
  clusterName: "Cluster WEST",
  site: "tebet",
  appName: "Nomad West Lab App",
  env: ClusterEnvironment.PRODUCTION,
  token: "f61f7a1e-57e6-fe85-90d8-e94fd311b298",
  createdAt: new Date("2026-08-19T00:00:00.000Z"),
  updatedAt: new Date("2026-08-19T00:00:00.000Z")
} as ClusterEntity;

export function fakeClusterRepository(input: {
  clusters?: ClusterEntity[];
  onBulkLookup?: () => void;
} = {}): ClusterRepositoryPort {
  const clusters = input.clusters ?? [eastCluster, westCluster];
  return {
    async findAll() {
      return [...clusters].sort((a, b) => Number(a.clusterId) - Number(b.clusterId));
    },
    async findById(clusterId: string) {
      return clusters.find(cluster => cluster.clusterId === clusterId) ?? null;
    },
    async findMetadataById(clusterId: string) {
      const cluster = clusters.find(item => item.clusterId === clusterId);
      return cluster ? toClusterMetadata(cluster) : null;
    },
    async findMetadataByIds(clusterIds: readonly string[]) {
      input.onBulkLookup?.();
      const wanted = new Set(clusterIds);
      return new Map(
        clusters
          .filter(cluster => wanted.has(cluster.clusterId))
          .map(cluster => [cluster.clusterId, toClusterMetadata(cluster)])
      );
    }
  };
}

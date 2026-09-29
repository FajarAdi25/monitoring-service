import { DataSource, In, Repository } from "typeorm";
import { ClusterEntity } from "./cluster.entity";
import type { ClusterMetadata, ClusterRepositoryPort } from "./cluster.types";
import { toClusterMetadata } from "./cluster.types";

export class ClusterRepository implements ClusterRepositoryPort {
  private readonly repository: Repository<ClusterEntity>;

  constructor(dataSource: DataSource) {
    this.repository = dataSource.getRepository(ClusterEntity);
  }

  findActive(): Promise<ClusterEntity[]> {
    return this.repository.find({
      where: { isActive: true },
      order: { clusterId: "ASC" }
    });
  }

  /** Active clusters with ssl_monitoring enabled, excluding those whose ssl_monitoring row is inactive. */
  findSslMonitoringEnabled(): Promise<ClusterEntity[]> {
    return this.repository.createQueryBuilder("cluster")
      .leftJoin("ssl_monitoring", "ssl", "ssl.cluster_id = cluster.cluster_id")
      .where("cluster.ssl_monitoring = TRUE")
      .andWhere("cluster.is_active = TRUE")
      .andWhere("(ssl.id IS NULL OR ssl.is_active = TRUE)")
      .orderBy("cluster.clusterId", "ASC")
      .getMany();
  }

  findById(clusterId: string): Promise<ClusterEntity | null> {
    return this.repository.findOne({ where: { clusterId } });
  }

  async findMetadataById(clusterId: string): Promise<ClusterMetadata | null> {
    const cluster = await this.findById(clusterId);
    return cluster ? toClusterMetadata(cluster) : null;
  }

  async findMetadataByIds(clusterIds: readonly string[]): Promise<Map<string, ClusterMetadata>> {
    const ids = [...new Set(clusterIds)];
    if (ids.length === 0) return new Map();
    const clusters = await this.repository.find({ where: { clusterId: In(ids) } });
    return new Map(clusters.map(cluster => [cluster.clusterId, toClusterMetadata(cluster)]));
  }
}

import { DataSource, In, Repository } from "typeorm";
import { ClusterEntity } from "./cluster.entity";
import type { ClusterMetadata, ClusterRepositoryPort } from "./cluster.types";
import { toClusterMetadata } from "./cluster.types";

export class ClusterRepository implements ClusterRepositoryPort {
  private readonly repository: Repository<ClusterEntity>;

  constructor(dataSource: DataSource) {
    this.repository = dataSource.getRepository(ClusterEntity);
  }

  findAll(): Promise<ClusterEntity[]> {
    return this.repository.find({ order: { clusterId: "ASC" } });
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

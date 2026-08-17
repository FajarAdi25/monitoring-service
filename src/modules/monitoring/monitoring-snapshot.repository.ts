import type { DataSource, Repository } from "typeorm";
import { MonitoringSnapshotEntity } from "./monitoring-snapshot.entity";
import type { MonitoringSnapshotFilters, SaveMonitoringSnapshotInput } from "./monitoring-snapshot.types";

export class MonitoringSnapshotRepository {
  private readonly repository: Repository<MonitoringSnapshotEntity>;

  constructor(dataSource: DataSource) {
    this.repository = dataSource.getRepository(MonitoringSnapshotEntity);
  }

  async saveIfChanged(input: SaveMonitoringSnapshotInput): Promise<{
    changed: boolean;
    previous: MonitoringSnapshotEntity | null;
    snapshot: MonitoringSnapshotEntity;
  }> {
    const previous = await this.repository.findOne({
      where: {
        clusterId: input.clusterId,
        source: input.source,
        resourceType: input.resourceType,
        resourceKey: input.resourceKey
      },
      order: { id: "DESC" }
    });

    if (previous?.state === input.state) {
      return { changed: false, previous, snapshot: previous };
    }

    const snapshot = this.repository.create({
      clusterId: input.clusterId,
      source: input.source,
      resourceType: input.resourceType,
      resourceKey: input.resourceKey,
      resourceName: input.resourceName ?? null,
      state: input.state,
      payloadJson: input.payload ?? null,
      observedAt: input.observedAt ?? new Date()
    });

    const saved = await this.repository.save(snapshot);
    return { changed: true, previous, snapshot: saved };
  }

  async list(filters: MonitoringSnapshotFilters): Promise<MonitoringSnapshotEntity[]> {
    const qb = this.repository.createQueryBuilder("snapshot");
    if (filters.clusterId) qb.andWhere("snapshot.cluster_id = :clusterId", { clusterId: filters.clusterId });
    if (filters.source) qb.andWhere("snapshot.source = :source", { source: filters.source });
    if (filters.resourceType) qb.andWhere("snapshot.resource_type = :resourceType", { resourceType: filters.resourceType });
    if (filters.resourceKey) qb.andWhere("snapshot.resource_key = :resourceKey", { resourceKey: filters.resourceKey });
    return qb.orderBy("snapshot.observed_at", "DESC").addOrderBy("snapshot.id", "DESC").take(filters.limit).getMany();
  }

  async latestStates(input: {
    clusterId: string;
    source: string;
    resourceType: string;
  }): Promise<Array<{ resourceKey: string; state: string }>> {
    const rows = await this.repository.query(
      `
        SELECT s.resource_key AS resourceKey, s.state AS state
        FROM monitoring_snapshots s
        INNER JOIN (
          SELECT resource_key, MAX(id) AS max_id
          FROM monitoring_snapshots
          WHERE cluster_id = ? AND source = ? AND resource_type = ?
          GROUP BY resource_key
        ) latest ON latest.max_id = s.id
      `,
      [input.clusterId, input.source, input.resourceType]
    ) as Array<{ resourceKey: string; state: string }>;

    return rows;
  }
}

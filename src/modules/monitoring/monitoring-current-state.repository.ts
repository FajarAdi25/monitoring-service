import type { DataSource, Repository } from "typeorm";
import { MonitoringCurrentStateEntity } from "./monitoring-current-state.entity";
import type { MonitoringCurrentStateFilters } from "./monitoring-current-state.types";

export class MonitoringCurrentStateRepository {
  private readonly repository: Repository<MonitoringCurrentStateEntity>;

  constructor(dataSource: DataSource) {
    this.repository = dataSource.getRepository(MonitoringCurrentStateEntity);
  }

  async list(filters: MonitoringCurrentStateFilters): Promise<MonitoringCurrentStateEntity[]> {
    const qb = this.repository.createQueryBuilder("current")
      .leftJoin("clusters", "cluster", "cluster.cluster_id = current.cluster_id");

    if (filters.clusterId) qb.andWhere("current.cluster_id = :clusterId", { clusterId: filters.clusterId });
    if (filters.site) qb.andWhere("cluster.site = :site", { site: filters.site });
    if (filters.source) qb.andWhere("current.source = :source", { source: filters.source });
    if (filters.resourceType) qb.andWhere("current.resource_type = :resourceType", { resourceType: filters.resourceType });
    if (filters.resourceKey) qb.andWhere("current.resource_key = :resourceKey", { resourceKey: filters.resourceKey });
    if (filters.state) qb.andWhere("current.state = :state", { state: filters.state });
    if (filters.from) qb.andWhere("current.last_checked_at >= :from", { from: filters.from });
    if (filters.to) qb.andWhere("current.last_checked_at <= :to", { to: filters.to });

    return qb
      .orderBy("current.last_checked_at", "DESC")
      .addOrderBy("current.id", "DESC")
      .take(filters.limit)
      .getMany();
  }
  async aggregateByState(input: {
    source: string;
    clusterId?: string;
    site?: string;
  }): Promise<{
    rows: Array<{ resourceType: string; state: string; count: number }>;
    lastCheckedAt: Date | null;
  }> {
    const qb = this.repository.createQueryBuilder("current")
      .leftJoin("clusters", "cluster", "cluster.cluster_id = current.cluster_id")
      .select("current.resource_type", "resourceType")
      .addSelect("current.state", "state")
      .addSelect("COUNT(*)", "count")
      .where("current.source = :source", { source: input.source });

    if (input.clusterId) {
      qb.andWhere("current.cluster_id = :clusterId", { clusterId: input.clusterId });
    }
    if (input.site) {
      qb.andWhere("cluster.site = :site", { site: input.site });
    }

    qb.groupBy("current.resource_type")
      .addGroupBy("current.state");

    const rawRows = await qb.getRawMany<{ resourceType: string; state: string; count: string }>();

    const latestQb = this.repository.createQueryBuilder("current")
      .select("MAX(current.last_checked_at)", "lastCheckedAt")
      .where("current.source = :source", { source: input.source });

    if (input.clusterId) {
      latestQb.andWhere("current.cluster_id = :clusterId", { clusterId: input.clusterId });
    }
    if (input.site) {
      latestQb.leftJoin("clusters", "cluster", "cluster.cluster_id = current.cluster_id")
        .andWhere("cluster.site = :site", { site: input.site });
    }

    const latest = await latestQb.getRawOne<{ lastCheckedAt: Date | string | null }>();
    const lastCheckedAt = latest?.lastCheckedAt
      ? new Date(latest.lastCheckedAt)
      : null;

    return {
      rows: rawRows.map(row => ({
        resourceType: row.resourceType,
        state: row.state,
        count: Number(row.count)
      })),
      lastCheckedAt
    };
  }

}

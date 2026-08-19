import { DataSource, DeepPartial, LessThanOrEqual, Repository } from "typeorm";
import { IncidentEntity } from "./incident.entity";
import { IncidentSeverity, IncidentStatus } from "./incident.enums";
import type { IncidentListFilters } from "./incident.types";

export class IncidentRepository {
  private readonly repository: Repository<IncidentEntity>;

  constructor(dataSource: DataSource) {
    this.repository = dataSource.getRepository(IncidentEntity);
  }

  findByPublicId(publicId: string): Promise<IncidentEntity | null> {
    return this.repository.findOne({ where: { publicId } });
  }

  findOpenByActiveFingerprint(fingerprint: string): Promise<IncidentEntity | null> {
    return this.repository.findOne({
      where: { activeFingerprint: fingerprint, status: IncidentStatus.OPEN }
    });
  }

  create(input: DeepPartial<IncidentEntity>): IncidentEntity {
    return this.repository.create(input);
  }

  save(incident: IncidentEntity): Promise<IncidentEntity> {
    return this.repository.save(incident);
  }

  findDueOpenNotifications(now: Date, limit: number): Promise<IncidentEntity[]> {
    return this.repository.find({
      where: {
        status: IncidentStatus.OPEN,
        nextNotificationAt: LessThanOrEqual(now)
      },
      order: { nextNotificationAt: "ASC" },
      take: limit
    });
  }

  async markNotificationSent(
    publicId: string,
    sentAt: Date,
    nextNotificationAt: Date,
    incrementReminder: boolean
  ): Promise<void> {
    const qb = this.repository.createQueryBuilder()
      .update(IncidentEntity)
      .set({
        lastNotificationAt: sentAt,
        nextNotificationAt,
        ...(incrementReminder
          ? { reminderCount: () => "reminder_count + 1" }
          : {})
      })
      .where("public_id = :publicId", { publicId })
      .andWhere("status = :status", { status: IncidentStatus.OPEN });

    await qb.execute();
  }

  async list(filters: IncidentListFilters): Promise<{ items: IncidentEntity[]; total: number }> {
    const qb = this.repository.createQueryBuilder("incident");

    if (filters.cluster) qb.andWhere("incident.cluster_id = :cluster", { cluster: filters.cluster });
    if (filters.source) qb.andWhere("incident.source = :source", { source: filters.source });
    if (filters.type) qb.andWhere("incident.type = :type", { type: filters.type });
    if (filters.severity) qb.andWhere("incident.severity = :severity", { severity: filters.severity });
    if (filters.status) qb.andWhere("incident.status = :status", { status: filters.status });
    if (filters.resourceType) qb.andWhere("incident.resource_type = :resourceType", { resourceType: filters.resourceType });
    if (filters.acknowledged !== undefined) {
      qb.andWhere(filters.acknowledged ? "incident.acknowledged_at IS NOT NULL" : "incident.acknowledged_at IS NULL");
    }
    if (filters.from) qb.andWhere("incident.opened_at >= :from", { from: filters.from });
    if (filters.to) qb.andWhere("incident.opened_at <= :to", { to: filters.to });

    qb.orderBy("incident.opened_at", "DESC")
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit);

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  async recent(input: {
    cluster?: string;
    source?: string;
    status?: IncidentStatus;
    severity?: IncidentSeverity;
    type?: string;
    acknowledged?: boolean;
    postponed?: boolean;
    limit: number;
    now: Date;
  }): Promise<IncidentEntity[]> {
    const qb = this.repository.createQueryBuilder("incident");

    if (input.cluster) qb.andWhere("incident.cluster_id = :cluster", { cluster: input.cluster });
    if (input.source) qb.andWhere("incident.source = :source", { source: input.source });
    if (input.status) qb.andWhere("incident.status = :status", { status: input.status });
    if (input.severity) qb.andWhere("incident.severity = :severity", { severity: input.severity });
    if (input.type) qb.andWhere("incident.type = :type", { type: input.type });
    if (input.acknowledged !== undefined) {
      qb.andWhere(input.acknowledged ? "incident.acknowledged_at IS NOT NULL" : "incident.acknowledged_at IS NULL");
    }
    if (input.postponed === true) {
      qb.andWhere("incident.status = :postponedStatus", { postponedStatus: IncidentStatus.OPEN });
      qb.andWhere("incident.postpone_until IS NOT NULL");
      qb.andWhere("incident.postpone_until > :postponeNow", { postponeNow: input.now });
    } else if (input.postponed === false) {
      qb.andWhere(
        "(incident.status <> :postponedStatus OR incident.postpone_until IS NULL OR incident.postpone_until <= :postponeNow)",
        { postponedStatus: IncidentStatus.OPEN, postponeNow: input.now }
      );
    }

    return qb.orderBy("incident.opened_at", "DESC").take(input.limit).getMany();
  }

  async resolvedHistory(input: {
    cluster?: string;
    source?: string;
    severity?: IncidentSeverity;
    type?: string;
    from?: Date;
    to?: Date;
    page: number;
    limit: number;
  }): Promise<{ items: IncidentEntity[]; total: number }> {
    const qb = this.repository.createQueryBuilder("incident")
      .where("incident.status = :status", { status: IncidentStatus.RESOLVED });

    if (input.cluster) qb.andWhere("incident.cluster_id = :cluster", { cluster: input.cluster });
    if (input.source) qb.andWhere("incident.source = :source", { source: input.source });
    if (input.severity) qb.andWhere("incident.severity = :severity", { severity: input.severity });
    if (input.type) qb.andWhere("incident.type = :type", { type: input.type });
    if (input.from) qb.andWhere("incident.resolved_at >= :from", { from: input.from });
    if (input.to) qb.andWhere("incident.resolved_at <= :to", { to: input.to });

    qb.orderBy("incident.resolved_at", "DESC")
      .skip((input.page - 1) * input.limit)
      .take(input.limit);

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  async countSummary(clusterId?: string, now = new Date()): Promise<{
    activeTotal: number;
    acknowledged: number;
    unacknowledged: number;
    postponed: number;
    resolvedToday: number;
    resolvedLast24Hours: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
  }> {
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0
    );
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const activeQb = this.repository.createQueryBuilder("i")
      .where("i.status = :s", { s: IncidentStatus.OPEN });
    const acknowledgedQb = this.repository.createQueryBuilder("i")
      .where("i.status = :s", { s: IncidentStatus.OPEN })
      .andWhere("i.acknowledged_at IS NOT NULL");
    const unacknowledgedQb = this.repository.createQueryBuilder("i")
      .where("i.status = :s", { s: IncidentStatus.OPEN })
      .andWhere("i.acknowledged_at IS NULL");
    const postponedQb = this.repository.createQueryBuilder("i")
      .where("i.status = :s", { s: IncidentStatus.OPEN })
      .andWhere("i.postpone_until IS NOT NULL")
      .andWhere("i.postpone_until > :now", { now });
    const resolvedTodayQb = this.repository.createQueryBuilder("i")
      .where("i.status = :s", { s: IncidentStatus.RESOLVED })
      .andWhere("i.resolved_at >= :start", { start: startOfToday });
    const resolvedLast24Qb = this.repository.createQueryBuilder("i")
      .where("i.status = :s", { s: IncidentStatus.RESOLVED })
      .andWhere("i.resolved_at >= :start", { start: last24Hours });

    if (clusterId) {
      for (const qb of [activeQb, acknowledgedQb, unacknowledgedQb, postponedQb, resolvedTodayQb, resolvedLast24Qb]) {
        qb.andWhere("i.cluster_id = :clusterId", { clusterId });
      }
    }

    const [activeTotal, acknowledged, unacknowledged, postponed, resolvedToday, resolvedLast24Hours] = await Promise.all([
      activeQb.getCount(),
      acknowledgedQb.getCount(),
      unacknowledgedQb.getCount(),
      postponedQb.getCount(),
      resolvedTodayQb.getCount(),
      resolvedLast24Qb.getCount()
    ]);

    const severityQb = this.repository.createQueryBuilder("i")
      .select("i.severity", "key")
      .addSelect("COUNT(*)", "count")
      .where("i.status = :s", { s: IncidentStatus.OPEN });
    const typeQb = this.repository.createQueryBuilder("i")
      .select("i.type", "key")
      .addSelect("COUNT(*)", "count")
      .where("i.status = :s", { s: IncidentStatus.OPEN });

    if (clusterId) {
      severityQb.andWhere("i.cluster_id = :clusterId", { clusterId });
      typeQb.andWhere("i.cluster_id = :clusterId", { clusterId });
    }

    const severityRows = await severityQb
      .groupBy("i.severity")
      .getRawMany<{ key: string; count: string }>();
    const typeRows = await typeQb
      .groupBy("i.type")
      .getRawMany<{ key: string; count: string }>();

    const toRecord = (rows: Array<{ key: string; count: string }>) =>
      Object.fromEntries(rows.map(row => [row.key, Number(row.count)]));

    return {
      activeTotal,
      acknowledged,
      unacknowledged,
      postponed,
      resolvedToday,
      resolvedLast24Hours,
      bySeverity: toRecord(severityRows),
      byType: toRecord(typeRows)
    };
  }

}

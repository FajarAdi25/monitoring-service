// Version: 2.3.0
import type { DataSource, Repository } from "typeorm";
import { SslMonitoringEntity } from "./ssl-monitoring.entity";

export interface SaveSslMonitoringInput {
  clusterId: string;
  validFrom: Date;
  expiresAt: Date;
  daysRemaining: number;
  subjectCn: string | null;
  issuerCn: string | null;
  certificateFingerprint256: string | null;
  lastCheckedAt: Date;
}

export class SslMonitoringRepository {
  private readonly repository: Repository<SslMonitoringEntity>;

  constructor(dataSource: DataSource) {
    this.repository = dataSource.getRepository(SslMonitoringEntity);
  }

  list(): Promise<SslMonitoringEntity[]> {
    return this.repository.find({
      order: { expiresAt: "ASC", clusterId: "ASC" }
    });
  }

  async saveLatest(input: SaveSslMonitoringInput): Promise<void> {
    const existing = await this.repository.findOne({
      where: { clusterId: input.clusterId }
    });

    if (existing) {
      existing.validFrom = input.validFrom;
      existing.expiresAt = input.expiresAt;
      existing.daysRemaining = input.daysRemaining;
      existing.subjectCn = input.subjectCn;
      existing.issuerCn = input.issuerCn;
      existing.certificateFingerprint256 = input.certificateFingerprint256;
      existing.lastCheckedAt = input.lastCheckedAt;
      await this.repository.save(existing);
      return;
    }

    await this.repository.save(this.repository.create(input));
  }
}

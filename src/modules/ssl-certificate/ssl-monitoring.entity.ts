// Version: 2.2.0
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from "typeorm";
import type { Timestamp } from "../../common/types/timestamp";

@Entity({ name: "ssl_monitoring" })
@Index("uq_ssl_monitoring_cluster", ["clusterId"], { unique: true })
export class SslMonitoringEntity {
  @PrimaryGeneratedColumn({ type: "bigint", unsigned: true })
  id!: string;

  @Column({ name: "cluster_id", type: "bigint", unsigned: true })
  clusterId!: string;

  @Column({ name: "valid_from", type: "timestamp", precision: 3 })
  validFrom!: Timestamp;

  @Column({ name: "expires_at", type: "timestamp", precision: 3 })
  expiresAt!: Timestamp;

  @Column({ name: "days_remaining", type: "int" })
  daysRemaining!: number;

  @Column({ name: "subject_cn", type: "varchar", length: 255, nullable: true })
  subjectCn!: string | null;

  @Column({ name: "issuer_cn", type: "varchar", length: 255, nullable: true })
  issuerCn!: string | null;

  @Column({ name: "certificate_fingerprint256", type: "varchar", length: 128, nullable: true })
  certificateFingerprint256!: string | null;

  @Column({ name: "last_checked_at", type: "timestamp", precision: 3 })
  lastCheckedAt!: Timestamp;

  @CreateDateColumn({ name: "created_at", type: "timestamp", precision: 3 })
  createdAt!: Timestamp;

  @UpdateDateColumn({ name: "updated_at", type: "timestamp", precision: 3 })
  updatedAt!: Timestamp;
}

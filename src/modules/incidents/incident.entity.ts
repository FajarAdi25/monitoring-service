// Version: 2.7.0
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  OneToOne
} from "typeorm";
import type { Timestamp } from "../../common/types/timestamp";
import { IncidentSeverity, IncidentStatus } from "./incident.enums";
import { ResolutionTimeEntity } from "./resolution-time.entity";

@Entity({ name: "incidents" })
@Index("uq_incidents_public_id", ["publicId"], { unique: true })
@Index("uq_incidents_active_fingerprint", ["activeFingerprint"], { unique: true })
@Index("idx_incidents_status_opened_at", ["status", "openedAt"])
@Index("idx_incidents_resolved_at", ["resolvedAt"])
export class IncidentEntity {
  @PrimaryGeneratedColumn({ type: "bigint" })
  id!: string;

  @Column({ name: "public_id", type: "varchar", length: 32 })
  publicId!: string;

  @Column({ name: "cluster_id", type: "bigint" })
  clusterId!: string;

  @Column({ type: "varchar", length: 32 })
  source!: string;

  @Column({ type: "varchar", length: 64 })
  type!: string;

  @Column({ type: "varchar", length: 32 })
  severity!: IncidentSeverity;

  @Column({ name: "resource_type", type: "varchar", length: 32 })
  resourceType!: string;

  @Column({ name: "resource_key", type: "varchar", length: 255 })
  resourceKey!: string;

  @Column({ name: "resource_name", type: "varchar", length: 255, nullable: true })
  resourceName!: string | null;

  @Column({ type: "char", length: 64 })
  fingerprint!: string;

  @Column({ name: "active_fingerprint", type: "char", length: 64, nullable: true })
  activeFingerprint!: string | null;

  @Column({ type: "varchar", length: 32 })
  status!: IncidentStatus;

  @Column({ type: "text" })
  message!: string;

  @Column({ name: "context_json", type: "json", nullable: true })
  contextJson!: Record<string, unknown> | null;

  @Column({ name: "opened_at", type: "timestamp", precision: 3 })
  openedAt!: Timestamp;

  @Column({ name: "last_detected_at", type: "timestamp", precision: 3 })
  lastDetectedAt!: Timestamp;

  @Column({ name: "last_notification_at", type: "timestamp", precision: 3, nullable: true })
  lastNotificationAt!: Timestamp | null;

  @Column({ name: "next_notification_at", type: "timestamp", precision: 3, nullable: true })
  nextNotificationAt!: Timestamp | null;

  @Column({ name: "reminder_count", type: "int", default: 0 })
  reminderCount!: number;

  @Column({ name: "resolved_at", type: "timestamp", precision: 3, nullable: true })
  resolvedAt!: Timestamp | null;

  @CreateDateColumn({ name: "created_at", type: "timestamp", precision: 3 })
  createdAt!: Timestamp;

  @UpdateDateColumn({ name: "updated_at", type: "timestamp", precision: 3 })
  updatedAt!: Timestamp;

  @OneToOne(() => ResolutionTimeEntity, resolutionTime => resolutionTime.incident)
  resolutionTime?: ResolutionTimeEntity;
}

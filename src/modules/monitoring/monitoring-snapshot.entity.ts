import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn
} from "typeorm";
import type { Timestamp } from "../../common/types/timestamp";

@Entity({ name: "monitoring_snapshots" })
@Index("idx_monitoring_snapshots_lookup", ["clusterId", "source", "resourceType", "resourceKey", "id"])
@Index("idx_monitoring_snapshots_observed_at", ["observedAt"])
export class MonitoringSnapshotEntity {
  @PrimaryGeneratedColumn({ type: "bigint", unsigned: true })
  id!: string;

  @Column({ name: "cluster_id", type: "bigint", unsigned: true })
  clusterId!: string;

  @Column({ type: "varchar", length: 32 })
  source!: string;

  @Column({ name: "resource_type", type: "varchar", length: 32 })
  resourceType!: string;

  @Column({ name: "resource_key", type: "varchar", length: 255 })
  resourceKey!: string;

  @Column({ name: "resource_name", type: "varchar", length: 255, nullable: true })
  resourceName!: string | null;

  @Column({ type: "varchar", length: 64 })
  state!: string;

  @Column({ name: "payload_json", type: "json", nullable: true })
  payloadJson!: Record<string, unknown> | null;

  @Column({ name: "observed_at", type: "timestamp", precision: 3 })
  observedAt!: Timestamp;

  @CreateDateColumn({ name: "created_at", type: "timestamp", precision: 3 })
  createdAt!: Timestamp;
}

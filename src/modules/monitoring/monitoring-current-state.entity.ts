import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from "typeorm";
import type { Timestamp } from "../../common/types/timestamp";

@Entity({ name: "monitoring_current_states" })
@Index(
  "uq_monitoring_current_states_resource",
  ["clusterId", "source", "resourceType", "resourceKey"],
  { unique: true }
)
@Index("idx_monitoring_current_states_filter", ["clusterId", "source", "resourceType", "state"])
@Index("idx_monitoring_current_states_last_checked", ["lastCheckedAt"])
export class MonitoringCurrentStateEntity {
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

  @Column({ name: "last_checked_at", type: "timestamp", precision: 3 })
  lastCheckedAt!: Timestamp;

  @Column({ name: "last_changed_at", type: "timestamp", precision: 3 })
  lastChangedAt!: Timestamp;

  @CreateDateColumn({ name: "created_at", type: "timestamp", precision: 3 })
  createdAt!: Timestamp;

  @UpdateDateColumn({ name: "updated_at", type: "timestamp", precision: 3 })
  updatedAt!: Timestamp;
}

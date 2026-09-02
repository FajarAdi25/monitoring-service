import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "relay_deliveries" })
@Index("idx_relay_delivery_retry", ["status", "nextRetryAt"])
@Index("idx_relay_delivery_incident_event", ["incidentId", "eventType"], { unique: true })
export class RelayDeliveryEntity {
  @PrimaryGeneratedColumn({ type: "bigint", unsigned: true })
  id!: string;

  @Column({ name: "incident_id", type: "bigint", unsigned: true })
  incidentId!: string;

  @Column({ name: "event_type", type: "varchar", length: 16 })
  eventType!: "OPEN" | "RESOLVED";

  @Column({ type: "varchar", length: 16 })
  status!: "PENDING" | "FAILED" | "SUCCESS" | "CANCELLED";

  @Column({ name: "retry_count", type: "int", unsigned: true, default: 0 })
  retryCount!: number;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError!: string | null;

  @Column({ name: "next_retry_at", type: "timestamp", precision: 3, nullable: true })
  nextRetryAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamp", precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamp", precision: 3 })
  updatedAt!: Date;
}

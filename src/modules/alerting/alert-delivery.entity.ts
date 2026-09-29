// Version: 2.7.1
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from "typeorm";
import type { Timestamp } from "../../common/types/timestamp";
import type { AlertNotificationKind } from "./alerting.types";

export type AlertDeliveryStatus = "PENDING" | "SENT" | "FAILED";

/**
 * Outbox row for one REINTAKE alert batch. The stored payload (including batch_id)
 * is resent unchanged on retry, as required by the REINTAKE contract.
 */
@Entity({ name: "alert_deliveries" })
@Index("uq_alert_deliveries_batch_id", ["batchId"], { unique: true })
@Index("idx_alert_deliveries_due", ["status", "nextAttemptAt"])
export class AlertDeliveryEntity {
  @PrimaryGeneratedColumn({ type: "bigint" })
  id!: string;

  @Column({ name: "incident_id", type: "bigint" })
  incidentId!: string;

  @Column({ type: "varchar", length: 16 })
  kind!: AlertNotificationKind;

  @Column({ name: "batch_id", type: "varchar", length: 36 })
  batchId!: string;

  @Column({ name: "payload_json", type: "json" })
  payloadJson!: Record<string, unknown>;

  @Column({ type: "varchar", length: 16 })
  status!: AlertDeliveryStatus;

  @Column({ name: "attempt_count", type: "int", default: 0 })
  attemptCount!: number;

  @Column({ name: "last_status_code", type: "int", nullable: true })
  lastStatusCode!: number | null;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError!: string | null;

  @Column({ name: "next_attempt_at", type: "timestamp", precision: 3 })
  nextAttemptAt!: Timestamp;

  @Column({ name: "sent_at", type: "timestamp", precision: 3, nullable: true })
  sentAt!: Timestamp | null;

  @CreateDateColumn({ name: "created_at", type: "timestamp", precision: 3 })
  createdAt!: Timestamp;

  @UpdateDateColumn({ name: "updated_at", type: "timestamp", precision: 3 })
  updatedAt!: Timestamp;
}

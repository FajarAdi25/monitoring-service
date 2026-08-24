import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from "typeorm";
import { IncidentEntity } from "./incident.entity";

@Entity({ name: "resolution_time" })
export class ResolutionTimeEntity {
  @PrimaryGeneratedColumn({ type: "bigint", unsigned: true })
  id!: string;

  @Column({ name: "incident_id", type: "bigint", unsigned: true })
  incidentId!: string;

  @OneToOne(() => IncidentEntity)
  @JoinColumn({ name: "incident_id" })
  incident!: IncidentEntity;

  @Column({ name: "detected_at", type: "timestamp", precision: 3 })
  detectedAt!: Date;

  @Column({ name: "resolved_at", type: "timestamp", precision: 3, nullable: true })
  resolvedAt!: Date | null;

  @Column({ name: "duration_seconds", type: "int", unsigned: true, nullable: true })
  durationSeconds!: number | null;

  @Column({ name: "created_at", type: "timestamp", precision: 3, default: () => "CURRENT_TIMESTAMP(3)" })
  createdAt!: Date;

  @Column({ name: "updated_at", type: "timestamp", precision: 3, default: () => "CURRENT_TIMESTAMP(3)", onUpdate: "CURRENT_TIMESTAMP(3)" })
  updatedAt!: Date;
}

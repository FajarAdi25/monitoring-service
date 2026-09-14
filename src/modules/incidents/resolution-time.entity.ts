// Version: 2.6.0
import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { IncidentEntity } from "./incident.entity";

@Entity({ name: "resolution_time" })
export class ResolutionTimeEntity {
  @PrimaryGeneratedColumn({ type: "bigint" })
  id!: string;

  @Column({ name: "incident_id", type: "bigint" })
  incidentId!: string;

  @OneToOne(() => IncidentEntity)
  @JoinColumn({ name: "incident_id" })
  incident!: IncidentEntity;

  @Column({ name: "detected_at", type: "timestamp", precision: 3 })
  detectedAt!: Date;

  @Column({ name: "resolved_at", type: "timestamp", precision: 3, nullable: true })
  resolvedAt!: Date | null;

  @Column({ name: "duration_seconds", type: "int", nullable: true })
  durationSeconds!: number | null;

  @CreateDateColumn({ name: "created_at", type: "timestamp", precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamp", precision: 3 })
  updatedAt!: Date;
}

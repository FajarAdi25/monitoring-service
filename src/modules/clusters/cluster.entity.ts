import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";
import type { Timestamp } from "../../common/types/timestamp";
import { ClusterEnvironment } from "./cluster.enums";

@Entity({ name: "clusters" })
export class ClusterEntity {
  @PrimaryColumn({ name: "cluster_id", type: "bigint", unsigned: true })
  clusterId!: string;

  @Column({ type: "varchar", length: 512 })
  url!: string;

  @Column({ name: "cluster_name", type: "varchar", length: 255 })
  clusterName!: string;

  @Column({ type: "varchar", length: 255 })
  site!: string;

  @Column({ name: "app_name", type: "varchar", length: 255 })
  appName!: string;

  @Column({ type: "enum", enum: ClusterEnvironment })
  env!: ClusterEnvironment;

  @Column({ type: "varchar", length: 512 })
  token!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamp", precision: 3 })
  createdAt!: Timestamp;

  @UpdateDateColumn({ name: "updated_at", type: "timestamp", precision: 3 })
  updatedAt!: Timestamp;
}

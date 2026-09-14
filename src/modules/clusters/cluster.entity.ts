// Version: 2.6.0
import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";
import type { Timestamp } from "../../common/types/timestamp";
import { ClusterEnvironment } from "./cluster.enums";

@Entity({ name: "clusters" })
export class ClusterEntity {
  @PrimaryColumn({ name: "cluster_id", type: "bigint" })
  clusterId!: string;

  @Column({ type: "varchar", length: 512 })
  url!: string;

  @Column({ name: "cluster_name", type: "varchar", length: 255 })
  clusterName!: string;

  @Column({ type: "varchar", length: 255 })
  site!: string;

  @Column({ name: "app_name", type: "varchar", length: 255 })
  appName!: string;

  @Column({ type: "enum", enum: ClusterEnvironment, enumName: "clusters_env_enum" })
  env!: ClusterEnvironment;

  @Column({ type: "varchar", length: 512 })
  token!: string;

  @Column({ name: "ssl_monitoring", type: "boolean", default: false })
  sslMonitoring!: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamp", precision: 3 })
  createdAt!: Timestamp;

  @UpdateDateColumn({ name: "updated_at", type: "timestamp", precision: 3 })
  updatedAt!: Timestamp;
}

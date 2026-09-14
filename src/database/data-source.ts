// Version: 2.6.0
import "reflect-metadata";
import { DataSource } from "typeorm";
import { env } from "../config/env";
import { ClusterEntity } from "../modules/clusters/cluster.entity";
import { IncidentEntity } from "../modules/incidents/incident.entity";
import { ResolutionTimeEntity } from "../modules/incidents/resolution-time.entity";
import { MonitoringCurrentStateEntity } from "../modules/monitoring/monitoring-current-state.entity";
import { MonitoringSnapshotEntity } from "../modules/monitoring/monitoring-snapshot.entity";
import { SslMonitoringEntity } from "../modules/ssl-certificate/ssl-monitoring.entity";
import { RelayDeliveryEntity } from "../modules/alerting/relay/relay-delivery.entity";
import { CreatePostgresBaseline1789359000000 } from "./migrations/1789359000000-CreatePostgresBaseline";

export const AppDataSource = new DataSource({
  type: "postgres",
  host: env.db.host,
  port: env.db.port,
  username: env.db.username,
  password: env.db.password,
  database: env.db.database,
  entities: [
    ClusterEntity,
    IncidentEntity,
    ResolutionTimeEntity,
    MonitoringSnapshotEntity,
    MonitoringCurrentStateEntity,
    SslMonitoringEntity,
    RelayDeliveryEntity,
  ],
  migrations: [CreatePostgresBaseline1789359000000],
  synchronize: false,
  logging: false,
});

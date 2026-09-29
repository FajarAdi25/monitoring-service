// Version: 2.7.1
import "reflect-metadata";
import { DataSource } from "typeorm";
import { env } from "../config/env";
import { ClusterEntity } from "../modules/clusters/cluster.entity";
import { IncidentEntity } from "../modules/incidents/incident.entity";
import { ResolutionTimeEntity } from "../modules/incidents/resolution-time.entity";
import { MonitoringCurrentStateEntity } from "../modules/monitoring/monitoring-current-state.entity";
import { MonitoringSnapshotEntity } from "../modules/monitoring/monitoring-snapshot.entity";
import { SslMonitoringEntity } from "../modules/ssl-certificate/ssl-monitoring.entity";
import { CreatePostgresBaseline1789359000000 } from "./migrations/1789359000000-CreatePostgresBaseline";
import { AddIsActiveToClustersAndSslMonitoring1790000000000 } from "./migrations/1790000000000-AddIsActiveToClustersAndSslMonitoring";
import { DropIncidentAcknowledgePostpone1790000100000 } from "./migrations/1790000100000-DropIncidentAcknowledgePostpone";
import { DropRelayDeliveries1790000200000 } from "./migrations/1790000200000-DropRelayDeliveries";
import { CreateAlertDeliveries1790000300000 } from "./migrations/1790000300000-CreateAlertDeliveries";
import { AlertDeliveryEntity } from "../modules/alerting/alert-delivery.entity";

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
    AlertDeliveryEntity,
  ],
  migrations: [
    CreatePostgresBaseline1789359000000,
    AddIsActiveToClustersAndSslMonitoring1790000000000,
    DropIncidentAcknowledgePostpone1790000100000,
    DropRelayDeliveries1790000200000,
    CreateAlertDeliveries1790000300000,
  ],
  synchronize: false,
  logging: false,
});

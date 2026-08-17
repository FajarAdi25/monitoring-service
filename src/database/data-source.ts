import "reflect-metadata";
import { DataSource } from "typeorm";
import { env } from "../config/env";
import { IncidentEntity } from "../modules/incidents/incident.entity";
import { MonitoringCurrentStateEntity } from "../modules/monitoring/monitoring-current-state.entity";
import { MonitoringSnapshotEntity } from "../modules/monitoring/monitoring-snapshot.entity";
import { CreateIncidents1786680000000 } from "./migrations/1786680000000-CreateIncidents";
import { CreateMonitoringSnapshots1786680100000 } from "./migrations/1786680100000-CreateMonitoringSnapshots";
import { CreateMonitoringCurrentStates1786680200000 } from "./migrations/1786680200000-CreateMonitoringCurrentStates";
import { ResetNomadAllocationCurrentStates1786680300000 } from "./migrations/1786680300000-ResetNomadAllocationCurrentStates";
import { ConvertDateTimeColumnsToTimestamp1786680400000 } from "./migrations/1786680400000-ConvertDateTimeColumnsToTimestamp";
import { AddClosureReminderFields1786680500000 } from "./migrations/1786680500000-AddClosureReminderFields";
import { ReplaceCloseWithPostpone1786680600000 } from "./migrations/1786680600000-ReplaceCloseWithPostpone";
import { NormalizeNomadIncidentSeverity1786680700000 } from "./migrations/1786680700000-NormalizeNomadIncidentSeverity";
import { AddIncidentUserIdentity1786680800000 } from "./migrations/1786680800000-AddIncidentUserIdentity";

export const AppDataSource = new DataSource({
  type: "mysql",
  host: env.db.host,
  port: env.db.port,
  username: env.db.username,
  password: env.db.password,
  database: env.db.database,
  entities: [IncidentEntity, MonitoringSnapshotEntity, MonitoringCurrentStateEntity],
  migrations: [
    CreateIncidents1786680000000,
    CreateMonitoringSnapshots1786680100000,
    CreateMonitoringCurrentStates1786680200000,
    ResetNomadAllocationCurrentStates1786680300000,
    ConvertDateTimeColumnsToTimestamp1786680400000,
    AddClosureReminderFields1786680500000,
    ReplaceCloseWithPostpone1786680600000,
    NormalizeNomadIncidentSeverity1786680700000,
    AddIncidentUserIdentity1786680800000
  ],
  synchronize: false,
  logging: false,
  timezone: "Z"
});

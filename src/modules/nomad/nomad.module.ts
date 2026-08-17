import type { DataSource } from "typeorm";
import type { AlertingService } from "../alerting/alerting.service";
import { MonitoringObservationService } from "../monitoring/monitoring-observation.service";
import { NomadClient } from "./nomad.client";
import { NomadService, type NomadMonitoringConfig } from "./nomad.service";
import { NomadPullWorker } from "./nomad.worker";

export interface NomadModuleConfig extends NomadMonitoringConfig {
  baseUrl: string;
  token?: string;
  requestTimeoutMs: number;
  tlsRejectUnauthorized: boolean;
  tlsCaFile?: string;
  pullCron: string;
  pullCronTimezone: string;
  pullRunOnStart: boolean;
}

export function createNomadModule(
  dataSource: DataSource,
  alerting: AlertingService,
  config: NomadModuleConfig
) {
  const client = new NomadClient({
    baseUrl: config.baseUrl,
    token: config.token,
    requestTimeoutMs: config.requestTimeoutMs,
    tlsRejectUnauthorized: config.tlsRejectUnauthorized,
    tlsCaFile: config.tlsCaFile
  });
  const monitoring = new MonitoringObservationService(dataSource);
  const service = new NomadService(client, monitoring, alerting, config);
  return {
    service,
    worker: new NomadPullWorker(service, {
      cronExpression: config.pullCron,
      timezone: config.pullCronTimezone,
      runOnStart: config.pullRunOnStart
    })
  };
}

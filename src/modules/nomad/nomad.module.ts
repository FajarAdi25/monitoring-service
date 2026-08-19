import type { DataSource } from "typeorm";
import type { AlertingService } from "../alerting/alerting.service";
import { ClusterRepository } from "../clusters/cluster.repository";
import { MonitoringObservationService } from "../monitoring/monitoring-observation.service";
import { NomadClient } from "./nomad.client";
import { NomadService } from "./nomad.service";
import type { NomadClientFactory } from "./nomad.types";
import { NomadPullWorker } from "./nomad.worker";

export interface NomadModuleConfig {
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
  const clusters = new ClusterRepository(dataSource);
  const clientFactory: NomadClientFactory = cluster => new NomadClient({
    baseUrl: cluster.url,
    token: cluster.token,
    requestTimeoutMs: config.requestTimeoutMs,
    tlsRejectUnauthorized: config.tlsRejectUnauthorized,
    tlsCaFile: config.tlsCaFile
  });
  const monitoring = new MonitoringObservationService(dataSource);
  const service = new NomadService(clusters, clientFactory, monitoring, alerting);
  return {
    service,
    worker: new NomadPullWorker(service, {
      cronExpression: config.pullCron,
      timezone: config.pullCronTimezone,
      runOnStart: config.pullRunOnStart
    })
  };
}

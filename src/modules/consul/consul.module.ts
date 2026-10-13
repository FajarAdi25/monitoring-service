import type { DataSource } from "typeorm";
import type { AlertingService } from "../alerting/alerting.service";
import { ClusterRepository } from "../clusters/cluster.repository";
import { MonitoringObservationService } from "../monitoring/monitoring-observation.service";
import { ConsulClient } from "./consul.client";
import { ConsulService } from "./consul.service";
import type { ConsulClientFactory } from "./consul.types";
import { ConsulPullWorker } from "./consul.worker";

export interface ConsulModuleConfig {
  requestTimeoutMs: number;
  tlsRejectUnauthorized: boolean;
  tlsCaFile?: string;
  pullCron: string;
  pullCronTimezone: string;
  pullRunOnStart: boolean;
}

export function createConsulModule(
  dataSource: DataSource,
  alerting: AlertingService,
  config: ConsulModuleConfig
) {
  const clusters = new ClusterRepository(dataSource);
  const clientFactory: ConsulClientFactory = cluster => new ConsulClient({
    baseUrl: cluster.url,
    token: cluster.token,
    requestTimeoutMs: config.requestTimeoutMs,
    tlsRejectUnauthorized: config.tlsRejectUnauthorized,
    tlsCaFile: config.tlsCaFile
  });
  const monitoring = new MonitoringObservationService(dataSource);
  const service = new ConsulService(clusters, clientFactory, monitoring, alerting);
  return {
    service,
    worker: new ConsulPullWorker(service, {
      cronExpression: config.pullCron,
      timezone: config.pullCronTimezone,
      runOnStart: config.pullRunOnStart
    })
  };
}

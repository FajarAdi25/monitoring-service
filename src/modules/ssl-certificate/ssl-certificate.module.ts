// Version: 2.2.0
import type { DataSource } from "typeorm";
import type { AlertingService } from "../alerting/alerting.service";
import { ClusterRepository } from "../clusters/cluster.repository";
import { SslCertificateClient } from "./ssl-certificate.client";
import { SslCertificateService } from "./ssl-certificate.service";
import { SslCertificateWorker } from "./ssl-certificate.worker";
import { SslMonitoringRepository } from "./ssl-monitoring.repository";

export function createSslCertificateModule(
  dataSource: DataSource,
  alerting: AlertingService,
  requestTimeoutMs: number
) {
  const clusters = new ClusterRepository(dataSource);
  const client = new SslCertificateClient(requestTimeoutMs);
  const sslMonitoring = new SslMonitoringRepository(dataSource);
  const service = new SslCertificateService(clusters, client, alerting, sslMonitoring);

  return {
    service,
    worker: new SslCertificateWorker(service)
  };
}

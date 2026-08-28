// Version: 2.2.0
import { createHash } from "node:crypto";
import type { AlertingService } from "../alerting/alerting.service";
import type { ClusterEntity } from "../clusters/cluster.entity";
import type { ClusterRepositoryPort } from "../clusters/cluster.types";
import { IncidentSeverity } from "../incidents/incident.enums";
import { SslCertificateClient } from "./ssl-certificate.client";
import type { SslMonitoringRepository } from "./ssl-monitoring.repository";

const EXPIRY_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;
const INCIDENT_TYPE = "SSL_CERTIFICATE_EXPIRING";
const RESOURCE_TYPE = "CLUSTER_SSL_CERTIFICATE";

export interface SslCertificateCheckResult {
  checked: number;
  expiring: number;
  healthy: number;
  failed: number;
}

export class SslCertificateService {
  constructor(
    private readonly clusters: ClusterRepositoryPort,
    private readonly client: SslCertificateClient,
    private readonly alerting: AlertingService,
    private readonly sslMonitoring: SslMonitoringRepository,
  ) {}

  async checkOnce(now = new Date()): Promise<SslCertificateCheckResult> {
    const clusters = await this.clusters.findSslMonitoringEnabled();
    const result: SslCertificateCheckResult = {
      checked: clusters.length,
      expiring: 0,
      healthy: 0,
      failed: 0,
    };

    for (const cluster of clusters) {
      try {
        const certificate = await this.client.inspect(cluster.url);
        const remainingMs = certificate.expiresAt.getTime() - now.getTime();
        const daysRemaining = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
        const fingerprint = this.createFingerprint(cluster);

        try {
          await this.sslMonitoring.saveLatest({
            clusterId: cluster.clusterId,
            validFrom: certificate.validFrom,
            expiresAt: certificate.expiresAt,
            daysRemaining,
            subjectCn: certificate.subjectCn,
            issuerCn: certificate.issuerCn,
            certificateFingerprint256: certificate.fingerprint256,
            lastCheckedAt: now,
          });
        } catch (error) {
          console.error(
            `[SSL:MONITORING] cluster=${cluster.clusterId} persistence failed`,
            error,
          );
        }

        if (remainingMs <= EXPIRY_THRESHOLD_MS) {
          await this.alerting.processFailure({
            clusterId: cluster.clusterId,
            source: "SSL",
            type: INCIDENT_TYPE,
            severity: IncidentSeverity.WARNING,
            resourceType: RESOURCE_TYPE,
            resourceKey: cluster.clusterId,
            resourceName: cluster.clusterName,
            fingerprint,
            message: this.buildAlertMessage(
              cluster,
              certificate.expiresAt,
              daysRemaining,
            ),
            context: {
              endpoint: cluster.url,
              validFrom: certificate.validFrom.toISOString(),
              expiresAt: certificate.expiresAt.toISOString(),
              daysRemaining,
              subjectCn: certificate.subjectCn,
              issuerCn: certificate.issuerCn,
              certificateFingerprint256: certificate.fingerprint256,
            },
            detectedAt: now,
          });
          result.expiring += 1;
        } else {
          await this.alerting.processRecovery({ fingerprint, detectedAt: now });
          result.healthy += 1;
        }
      } catch (error) {
        result.failed += 1;
        console.error(
          `[SSL:CERTIFICATE] cluster=${cluster.clusterId} check failed`,
          error,
        );
      }
    }

    return result;
  }

  private createFingerprint(cluster: ClusterEntity): string {
    return createHash("sha256")
      .update(
        [
          cluster.clusterId,
          "SSL",
          INCIDENT_TYPE,
          RESOURCE_TYPE,
          cluster.clusterId,
        ].join("|"),
      )
      .digest("hex");
  }

  private buildAlertMessage(
    cluster: ClusterEntity,
    expiresAt: Date,
    daysRemaining: number,
  ): string {
    if (daysRemaining <= 0) {
      return `SSL certificate for cluster ${cluster.clusterName} expired on ${expiresAt.toISOString()}.`;
    }

    return `SSL certificate for cluster ${cluster.clusterName} expires on ${expiresAt.toISOString()} (${daysRemaining} day(s) remaining).`;
  }
}

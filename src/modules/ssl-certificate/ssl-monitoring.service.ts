// Version: 2.3.0
import type { ClusterRepositoryPort } from "../clusters/cluster.types";
import { SslMonitoringRepository } from "./ssl-monitoring.repository";

const EXPIRY_THRESHOLD_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type SslMonitoringStatus = "EXPIRED" | "EXPIRING_SOON" | "VALID";

export class SslMonitoringService {
  constructor(
    private readonly repository: SslMonitoringRepository,
    private readonly clusters: ClusterRepositoryPort
  ) {}

  async list(now = new Date()) {
    const items = await this.repository.list();
    const metadataById = await this.clusters.findMetadataByIds(items.map(item => item.clusterId));

    return items.map(item => {
      const metadata = metadataById.get(item.clusterId);
      if (!metadata) throw new Error(`Cluster metadata missing for cluster ${item.clusterId}.`);

      const remainingMs = item.expiresAt.getTime() - now.getTime();
      const daysRemaining = Math.ceil(remainingMs / DAY_MS);
      const status: SslMonitoringStatus = remainingMs <= 0
        ? "EXPIRED"
        : daysRemaining <= EXPIRY_THRESHOLD_DAYS
          ? "EXPIRING_SOON"
          : "VALID";

      return {
        id: item.id,
        clusterId: item.clusterId,
        clusterName: metadata.clusterName,
        site: metadata.site,
        appName: metadata.appName,
        env: metadata.env,
        status,
        validFrom: item.validFrom.toISOString(),
        expiresAt: item.expiresAt.toISOString(),
        daysRemaining,
        subjectCn: item.subjectCn,
        issuerCn: item.issuerCn,
        certificateFingerprint256: item.certificateFingerprint256,
        lastCheckedAt: item.lastCheckedAt.toISOString()
      };
    });
  }
}

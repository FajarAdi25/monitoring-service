import type { ClusterRepositoryPort } from "../clusters/cluster.types";
import { AppError } from "../../common/errors/app-error";
import { IncidentEntity } from "./incident.entity";
import { IncidentRepository } from "./incident.repository";
import { IncidentStatus } from "./incident.enums";
import type { IncidentListFilters } from "./incident.types";
import { mapIncidentDetail, mapIncidentListItem } from "./incident.mapper";

export class IncidentService {
  constructor(
    private readonly repository: IncidentRepository,
    private readonly clusters: ClusterRepositoryPort
  ) {}

  async list(filters: IncidentListFilters) {
    const { items, total } = await this.repository.list(filters);
    const metadataById = await this.clusters.findMetadataByIds(items.map(item => item.clusterId));
    return {
      items: items.map(item => {
        const metadata = metadataById.get(item.clusterId);
        if (!metadata) throw new Error(`Cluster metadata missing for cluster ${item.clusterId}.`);
        return mapIncidentListItem(item, metadata);
      }),
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total
      }
    };
  }

  async detail(publicId: string) {
    const incident = await this.getOrFail(publicId);
    const metadata = await this.clusters.findMetadataById(incident.clusterId);
    if (!metadata) throw new Error(`Cluster metadata missing for cluster ${incident.clusterId}.`);
    return mapIncidentDetail(incident, metadata);
  }

  /** Internal monitoring-engine operation. This is intentionally not exposed by an HTTP route. */
  async resolveActiveByFingerprint(
    fingerprint: string,
    resolvedAt = new Date()
  ): Promise<IncidentEntity | null> {
    const incident = await this.repository.findOpenByActiveFingerprint(fingerprint);
    if (!incident) return null;

    incident.status = IncidentStatus.RESOLVED;
    incident.resolvedAt = resolvedAt;
    incident.activeFingerprint = null;
    incident.nextNotificationAt = null;
    return this.repository.save(incident);
  }

  private async getOrFail(publicId: string): Promise<IncidentEntity> {
    const incident = await this.repository.findByPublicId(publicId);
    if (!incident) {
      throw new AppError(404, "INCIDENT_NOT_FOUND", "Incident not found.");
    }
    return incident;
  }
}

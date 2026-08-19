import type { User } from "../../common/types/user";
import type { ClusterRepositoryPort } from "../clusters/cluster.types";
import { AppError } from "../../common/errors/app-error";
import { IncidentEntity } from "./incident.entity";
import { IncidentRepository } from "./incident.repository";
import { IncidentStatus } from "./incident.enums";
import type { IncidentListFilters } from "./incident.types";
import {
  mapAcknowledgeResponse,
  mapIncidentDetail,
  mapIncidentListItem,
  mapPostponeResponse
} from "./incident.mapper";
import { parsePostponeBody } from "./incident.validation";

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

  async detail(publicId: string, user?: User) {
    const incident = await this.getOrFail(publicId);
    const metadata = await this.clusters.findMetadataById(incident.clusterId);
    if (!metadata) throw new Error(`Cluster metadata missing for cluster ${incident.clusterId}.`);
    return mapIncidentDetail(incident, metadata, user);
  }

  async acknowledge(publicId: string, user: User, note?: string) {
    const incident = await this.getOrFail(publicId);

    if (incident.acknowledgedAt !== null) {
      return mapAcknowledgeResponse(incident, user);
    }

    incident.acknowledgedAt = new Date();
    incident.acknowledgedBy = user.id;
    incident.acknowledgedByUserName = user.name;
    incident.acknowledgedByUsername = user.username ?? null;
    incident.acknowledgementNote = note?.trim() || null;
    const saved = await this.repository.save(incident);
    return mapAcknowledgeResponse(saved, user);
  }

  async postpone(publicId: string, user: User, body: unknown) {
    const incident = await this.getOrFail(publicId);

    if (incident.status !== IncidentStatus.OPEN) {
      throw new AppError(409, "INCIDENT_NOT_OPEN", "Only OPEN incidents can be postponed.");
    }

    const input = parsePostponeBody(body);
    const requestedAt = new Date();

    if (input.postponeUntil.getTime() <= requestedAt.getTime()) {
      throw new AppError(400, "INVALID_POSTPONE_UNTIL", "postponeUntil must be in the future.");
    }

    incident.postponedAt = requestedAt;
    incident.postponedBy = user.id;
    incident.postponedByUserName = user.name;
    incident.postponedByUsername = user.username ?? null;
    incident.postponeUntil = input.postponeUntil;
    incident.postponeRemark = input.remark?.trim() || null;

    // POSTPONE suppresses only OPEN reminders. The monitoring engine still
    // observes the incident and can resolve it immediately on recovery.
    // INITIAL is never postponed. If INITIAL has already been delivered,
    // move the next OPEN reminder to the requested postpone datetime.
    if (incident.lastNotificationAt !== null) {
      incident.nextNotificationAt = input.postponeUntil;
    }

    const saved = await this.repository.save(incident);
    return mapPostponeResponse(saved, user);
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

import type { ClusterMetadata } from "../clusters/cluster.types";
import { serializeClusterId } from "../clusters/cluster.types";
import { IncidentEntity } from "./incident.entity";

function clusterFields(metadata: ClusterMetadata) {
  return {
    clusterId: serializeClusterId(metadata.clusterId),
    clusterName: metadata.clusterName,
    site: metadata.site,
    appName: metadata.appName,
    env: metadata.env,
  };
}

export function mapIncidentListItem(
  entity: IncidentEntity,
  metadata: ClusterMetadata,
) {
  return {
    id: entity.publicId,
    ...clusterFields(metadata),
    source: entity.source,
    type: entity.type,
    severity: entity.severity,
    status: entity.status,
    resource: {
      type: entity.resourceType,
      id: entity.resourceKey,
      name: entity.resourceName,
    },
    message: entity.message,
    openedAt: entity.openedAt,
    lastDetectedAt: entity.lastDetectedAt,
    resolvedAt: entity.resolvedAt,
    durationSeconds: entity.resolutionTime?.durationSeconds ?? null,
  };
}

export function mapIncidentDetail(
  entity: IncidentEntity,
  metadata: ClusterMetadata,
) {
  return {
    id: entity.publicId,
    ...clusterFields(metadata),
    source: entity.source,
    type: entity.type,
    severity: entity.severity,
    status: entity.status,
    resource: {
      type: entity.resourceType,
      id: entity.resourceKey,
      name: entity.resourceName,
    },
    message: entity.message,
    context: entity.contextJson,
    openedAt: entity.openedAt,
    lastDetectedAt: entity.lastDetectedAt,
    resolvedAt: entity.resolvedAt,
    durationSeconds: entity.resolutionTime?.durationSeconds ?? null,
  };
}

import type { ClusterMetadata } from "../clusters/cluster.types";
import { serializeClusterId } from "../clusters/cluster.types";
import type { User } from "../../common/types/user";
import { IncidentEntity } from "./incident.entity";
import { IncidentStatus } from "./incident.enums";

function serializeId(id: string | null): string | number | null {
  if (id === null) return null;
  const numeric = Number(id);
  return Number.isSafeInteger(numeric) ? numeric : id;
}

function clusterFields(metadata: ClusterMetadata) {
  return {
    clusterId: serializeClusterId(metadata.clusterId),
    clusterName: metadata.clusterName,
    site: metadata.site,
    appName: metadata.appName,
    env: metadata.env,
  };
}

function userRef(
  id: string | null,
  name: string | null,
  username: string | null,
  currentUser?: User,
): {
  id: string | number;
  name: string | null;
  username: string | null;
} | null {
  if (!id) return null;
  const sameCurrentUser = currentUser?.id === id ? currentUser : undefined;
  return {
    id: serializeId(id) as string | number,
    name: name ?? sameCurrentUser?.name ?? null,
    username: username ?? sameCurrentUser?.username ?? null,
  };
}

function isPostponed(entity: IncidentEntity, now = new Date()): boolean {
  return (
    entity.status === IncidentStatus.OPEN &&
    entity.postponeUntil !== null &&
    entity.postponeUntil.getTime() > now.getTime()
  );
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
    acknowledged: entity.acknowledgedAt !== null,
    acknowledgedAt: entity.acknowledgedAt,
    postponed: isPostponed(entity),
    postponedAt: entity.postponedAt,
    postponeUntil: entity.postponeUntil,
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
  currentUser?: User,
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
    acknowledgement: {
      acknowledged: entity.acknowledgedAt !== null,
      acknowledgedAt: entity.acknowledgedAt,
      acknowledgedBy: userRef(
        entity.acknowledgedBy,
        entity.acknowledgedByUserName,
        entity.acknowledgedByUsername,
        currentUser,
      ),
      note: entity.acknowledgementNote,
    },
    postpone: {
      postponed: isPostponed(entity),
      postponedAt: entity.postponedAt,
      postponedBy: userRef(
        entity.postponedBy,
        entity.postponedByUserName,
        entity.postponedByUsername,
        currentUser,
      ),
      postponeUntil: entity.postponeUntil,
      remark: entity.postponeRemark,
    },
    resolvedAt: entity.resolvedAt,
    durationSeconds: entity.resolutionTime?.durationSeconds ?? null,
  };
}

export function mapAcknowledgeResponse(
  entity: IncidentEntity,
  currentUser?: User,
) {
  return {
    id: entity.publicId,
    status: entity.status,
    acknowledged: entity.acknowledgedAt !== null,
    acknowledgedAt: entity.acknowledgedAt,
    acknowledgedBy: userRef(
      entity.acknowledgedBy,
      entity.acknowledgedByUserName,
      entity.acknowledgedByUsername,
      currentUser,
    ),
    acknowledgementNote: entity.acknowledgementNote,
  };
}

export function mapPostponeResponse(
  entity: IncidentEntity,
  currentUser?: User,
) {
  return {
    id: entity.publicId,
    status: entity.status,
    postponed: isPostponed(entity),
    postponedAt: entity.postponedAt,
    postponedBy: userRef(
      entity.postponedBy,
      entity.postponedByUserName,
      entity.postponedByUsername,
      currentUser,
    ),
    postponeUntil: entity.postponeUntil,
    postponeRemark: entity.postponeRemark,
    nextNotificationAt: entity.nextNotificationAt,
  };
}

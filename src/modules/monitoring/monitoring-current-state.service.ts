import { AppError } from "../../common/errors/app-error";
import type { ClusterRepositoryPort } from "../clusters/cluster.types";
import { MonitoringCurrentStateRepository } from "./monitoring-current-state.repository";

function stringQuery(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : undefined;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export class MonitoringCurrentStateService {
  constructor(
    private readonly repository: MonitoringCurrentStateRepository,
    private readonly clusters: ClusterRepositoryPort
  ) {}

  async list(query: Record<string, unknown>) {
    const rawLimit = stringQuery(query.limit);
    const limit = rawLimit === undefined ? 100 : Number(rawLimit);

    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new AppError(400, "INVALID_LIMIT", "limit must be an integer between 1 and 500.");
    }

    const items = await this.repository.list({
      clusterId: stringQuery(query.cluster),
      source: stringQuery(query.source),
      resourceType: stringQuery(query.resourceType),
      resourceKey: stringQuery(query.resourceKey),
      state: stringQuery(query.state),
      from: query.from ? new Date(String(query.from)) : undefined,
      to: query.to ? new Date(String(query.to)) : undefined,
      limit
    });

    const metadataById = await this.clusters.findMetadataByIds(items.map(item => item.clusterId));

    return items.map(item => {
      const metadata = metadataById.get(item.clusterId);
      if (!metadata) throw new Error(`Cluster metadata missing for cluster ${item.clusterId}.`);
      return {
        id: item.id,
        clusterId: item.clusterId,
        clusterName: metadata.clusterName,
        site: metadata.site,
        appName: metadata.appName,
        env: metadata.env,
        source: item.source,
        resourceType: item.resourceType,
        resourceKey: item.resourceKey,
        resourceName: item.resourceName,
        state: item.state,
        payload: item.payloadJson,
        lastCheckedAt: item.lastCheckedAt.toISOString(),
        lastChangedAt: item.lastChangedAt.toISOString()
      };
    });
  }
}

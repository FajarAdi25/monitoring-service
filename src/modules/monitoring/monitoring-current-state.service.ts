import { AppError } from "../../common/errors/app-error";
import { MonitoringCurrentStateRepository } from "./monitoring-current-state.repository";

function stringQuery(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : undefined;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export class MonitoringCurrentStateService {
  constructor(private readonly repository: MonitoringCurrentStateRepository) {}

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
      limit
    });

    return items.map(item => ({
      id: item.id,
      clusterId: item.clusterId,
      source: item.source,
      resourceType: item.resourceType,
      resourceKey: item.resourceKey,
      resourceName: item.resourceName,
      state: item.state,
      payload: item.payloadJson,
      lastCheckedAt: item.lastCheckedAt.toISOString(),
      lastChangedAt: item.lastChangedAt.toISOString()
    }));
  }
}

import type { ClusterRepositoryPort } from "../clusters/cluster.types";
import { IncidentSeverity } from "../incidents/incident.enums";
import { mapIncidentListItem } from "../incidents/incident.mapper";
import { IncidentRepository } from "../incidents/incident.repository";
import { MonitoringCurrentStateRepository } from "../monitoring/monitoring-current-state.repository";
import {
  parseDashboardOverviewQuery,
  parseDashboardRecentQuery,
  parseDashboardResolvedQuery
} from "./dashboard.validation";

const NOMAD_INCIDENT_TYPES = [
  "NODE_DOWN",
  "ALLOCATION_FAILED",
  "EVALUATION_BLOCKED",
  "DRIVER_UNHEALTHY"
] as const;

export class DashboardService {
  constructor(
    private readonly incidents: IncidentRepository,
    private readonly currentStates: MonitoringCurrentStateRepository,
    private readonly clusters: ClusterRepositoryPort
  ) {}

  async overview(query: Record<string, unknown>) {
    const filters = parseDashboardOverviewQuery(query);
    const nomad = await this.nomadCurrentSummary(filters.cluster, filters.site);

    return { nomad };
  }

  async health(query: Record<string, unknown>) {
    const filters = parseDashboardOverviewQuery(query);
    const nomad = await this.nomadCurrentSummary(filters.cluster, filters.site);
    const issues = {
      nodesDown: nomad.nodes.down,
      driversUnhealthy: nomad.drivers.unhealthy,
      allocationsFailed: nomad.allocations.failed,
      evaluationsBlocked: nomad.evaluations.blocked
    };

    return {
      nomad: {
        healthy: nomad.lastCheckedAt === null
          ? null
          : Object.values(issues).every(value => value === 0),
        issues,
        lastCheckedAt: nomad.lastCheckedAt
      }
    };
  }

  async summary(query: Record<string, unknown>) {
    const filters = parseDashboardOverviewQuery(query);
    const result = await this.incidents.countSummary({ clusterId: filters.cluster, site: filters.site, from: filters.from, to: filters.to });

    return {
      open: {
        total: result.activeTotal,
        unacknowledged: result.unacknowledged,
        acknowledged: result.acknowledged,
        postponed: result.postponed
      },
      resolved: {
        today: result.resolvedToday,
        last24Hours: result.resolvedLast24Hours
      },
      bySeverity: {
        [IncidentSeverity.CRITICAL]: result.bySeverity[IncidentSeverity.CRITICAL] ?? 0,
        [IncidentSeverity.MAJOR]: result.bySeverity[IncidentSeverity.MAJOR] ?? 0,
        [IncidentSeverity.WARNING]: result.bySeverity[IncidentSeverity.WARNING] ?? 0
      },
      byType: {
        ...Object.fromEntries(NOMAD_INCIDENT_TYPES.map(type => [type, 0])),
        ...result.byType
      }
    };
  }

  async recent(query: Record<string, unknown>) {
    const filters = parseDashboardRecentQuery(query);
    const items = await this.incidents.recent({
      ...filters,
      now: new Date()
    });

    const metadataById = await this.clusters.findMetadataByIds(items.map(item => item.clusterId));
    return items.map(item => {
      const metadata = metadataById.get(item.clusterId);
      if (!metadata) throw new Error(`Cluster metadata missing for cluster ${item.clusterId}.`);
      return mapIncidentListItem(item, metadata);
    });
  }

  async resolved(query: Record<string, unknown>) {
    const filters = parseDashboardResolvedQuery(query);
    const { items, total } = await this.incidents.resolvedHistory(filters);

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

  private async nomadCurrentSummary(clusterId?: string, site?: string) {
    const aggregate = await this.currentStates.aggregateByState({
      source: "NOMAD",
      clusterId,
      site
    });

    const count = (resourceType: string, state?: string): number =>
      aggregate.rows
        .filter(row => row.resourceType === resourceType && (state === undefined || row.state === state))
        .reduce((total, row) => total + row.count, 0);

    return {
      nodes: {
        total: count("NODE"),
        ready: count("NODE", "READY"),
        down: count("NODE", "DOWN")
      },
      drivers: {
        healthy: count("DRIVER", "HEALTHY"),
        unhealthy: count("DRIVER", "UNHEALTHY")
      },
      allocations: {
        running: count("ALLOCATION", "RUNNING"),
        failed: count("ALLOCATION", "FAILED")
      },
      evaluations: {
        blocked: count("EVALUATION", "BLOCKED")
      },
      lastCheckedAt: aggregate.lastCheckedAt?.toISOString() ?? null
    };
  }
}

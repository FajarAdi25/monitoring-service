import { AppError } from "../../common/errors/app-error";
import { AlertingService } from "../alerting/alerting.service";
import type { ClusterEntity } from "../clusters/cluster.entity";
import { ClusterType } from "../clusters/cluster.enums";
import type { ClusterRepositoryPort } from "../clusters/cluster.types";
import { serializeClusterId, toClusterMetadata } from "../clusters/cluster.types";
import { MonitoringObservationService } from "../monitoring/monitoring-observation.service";
import { createConsulFingerprint } from "./consul.fingerprint";
import { CONSUL_INCIDENT_SEVERITY } from "./consul.severity";
import type {
  ConsulAutopilotHealth,
  ConsulAutopilotServer,
  ConsulClientFactory,
  ConsulClusterApiMetadata,
  ConsulClusterItem,
  ConsulHealthCheck,
  ConsulHealthState,
  ConsulPullOutcome,
  ConsulPullResult,
  ScopedConsulPullResult
} from "./consul.types";

const SOURCE = "CONSUL";

const TYPE = {
  NO_LEADER: "CONSUL_NO_LEADER",
  SERVER_UNHEALTHY: "CONSUL_SERVER_UNHEALTHY",
  NODE_CRITICAL: "CONSUL_NODE_CRITICAL",
  SERVICE_CRITICAL: "CONSUL_SERVICE_CRITICAL"
} as const;

const RESOURCE = {
  CLUSTER: "CONSUL_CLUSTER",
  SERVER: "CONSUL_SERVER",
  NODE: "CONSUL_NODE",
  SERVICE: "CONSUL_SERVICE"
} as const;

/** Consul's built-in node check; critical when the agent stops answering gossip. */
const SERF_HEALTH_CHECK_ID = "serfHealth";

const CHECK_OUTPUT_MAX = 512;

/**
 * An open CONSUL_SERVICE_CRITICAL incident is only resolved after every
 * instance of the service has been healthy for this long, so an instance
 * that flaps does not resolve and reopen the alert.
 */
const RECOVERY_HOLD_MS = 2 * 60 * 1000;

interface Counters {
  snapshotChanges: number;
  failuresProcessed: number;
  recoveriesProcessed: number;
}

/** Fingerprints of incidents that stay open after this pull. */
interface FailingSets {
  [TYPE.NO_LEADER]: Set<string>;
  [TYPE.SERVER_UNHEALTHY]: Set<string>;
  [TYPE.NODE_CRITICAL]: Set<string>;
  [TYPE.SERVICE_CRITICAL]: Set<string>;
}

interface ServiceInstance {
  node: string;
  serviceId: string;
  checks: ConsulHealthCheck[];
}

interface ServiceObservation {
  state: string;
  since: Date;
}

export class ConsulService {
  private pulling = false;

  constructor(
    private readonly clusters: ClusterRepositoryPort,
    private readonly clientFactory: ConsulClientFactory,
    private readonly monitoring: MonitoringObservationService,
    private readonly alerting: AlertingService
  ) {}

  async getDatacenters(clusterId?: string): Promise<Array<ConsulClusterItem<{ datacenters: string[] }>>> {
    const selected = await this.selectedClusters(clusterId);
    return Promise.all(selected.map(async cluster => ({
      datacenters: await this.clientFactory(cluster).getDatacenters(),
      ...this.apiMetadata(cluster)
    })));
  }

  async getHealthChecks(
    state: ConsulHealthState,
    datacenter?: string,
    clusterId?: string
  ): Promise<Array<ConsulClusterItem<ConsulHealthCheck>>> {
    const selected = await this.selectedClusters(clusterId);
    const resultSets = await Promise.all(selected.map(async cluster => {
      const { checks } = await this.clientFactory(cluster).getHealthChecks(state, datacenter);
      return checks.map(check => ({ ...check, ...this.apiMetadata(cluster) }));
    }));
    return resultSets.flat();
  }

  async getAutopilotHealth(
    datacenter?: string,
    clusterId?: string
  ): Promise<Array<ConsulClusterItem<ConsulAutopilotHealth>>> {
    const selected = await this.selectedClusters(clusterId);
    return Promise.all(selected.map(async cluster => ({
      ...(await this.clientFactory(cluster).getAutopilotHealth(datacenter)),
      ...this.apiMetadata(cluster)
    })));
  }

  async pullOnce(
    clusterId?: string,
    now = new Date()
  ): Promise<ScopedConsulPullResult | ConsulPullOutcome[]> {
    if (this.pulling) {
      throw new AppError(409, "CONSUL_PULL_IN_PROGRESS", "Consul pull is already running.");
    }

    this.pulling = true;
    try {
      const selected = await this.selectedClusters(clusterId);
      if (clusterId) {
        const cluster = selected[0];
        const result = await this.pullCluster(cluster, now);
        return { ...this.apiMetadata(cluster), ...result };
      }

      const outcomes: ConsulPullOutcome[] = [];
      for (const cluster of selected) {
        try {
          outcomes.push({
            ...this.apiMetadata(cluster),
            success: true,
            result: await this.pullCluster(cluster, now)
          });
        } catch (error) {
          outcomes.push({
            ...this.apiMetadata(cluster),
            success: false,
            error: this.pullError(error)
          });
        }
      }
      return outcomes;
    } finally {
      this.pulling = false;
    }
  }

  private async selectedClusters(clusterId?: string): Promise<ClusterEntity[]> {
    if (!clusterId) return this.clusters.findActive(ClusterType.CONSUL);
    const cluster = await this.clusters.findById(clusterId);
    if (!cluster || !cluster.isActive || cluster.type !== ClusterType.CONSUL) {
      throw new AppError(404, "CLUSTER_NOT_FOUND", `Consul cluster ${clusterId} was not found or is inactive.`);
    }
    return [cluster];
  }

  private apiMetadata(cluster: ClusterEntity): ConsulClusterApiMetadata {
    const metadata = toClusterMetadata(cluster);
    return {
      clusterId: serializeClusterId(metadata.clusterId),
      clusterName: metadata.clusterName,
      site: metadata.site,
      appName: metadata.appName,
      env: metadata.env
    };
  }

  private pullError(error: unknown): { code: string; message: string } {
    if (error instanceof AppError) {
      return { code: error.code, message: error.message };
    }
    return {
      code: "INTERNAL_SERVER_ERROR",
      message: error instanceof Error ? error.message : String(error)
    };
  }

  private async pullCluster(cluster: ClusterEntity, now: Date): Promise<ConsulPullResult> {
    const client = this.clientFactory(cluster);
    const clusterId = cluster.clusterId;
    const counters: Counters = { snapshotChanges: 0, failuresProcessed: 0, recoveriesProcessed: 0 };
    const failing: FailingSets = {
      [TYPE.NO_LEADER]: new Set(),
      [TYPE.SERVER_UNHEALTHY]: new Set(),
      [TYPE.NODE_CRITICAL]: new Set(),
      [TYPE.SERVICE_CRITICAL]: new Set()
    };
    /** Datacenters without a leader: autopilot cannot be read, so their server incidents are kept as they are. */
    const leaderlessDatacenters = new Set<string>();
    const services = new Map<string, ServiceObservation>();
    let servers = 0;
    let nodes = 0;

    const datacenters = await client.getDatacenters();

    for (const datacenter of datacenters) {
      const [leader, health] = await Promise.all([
        client.getLeader(datacenter),
        client.getHealthChecks("any", datacenter)
      ]);
      const hasLeader = leader !== "" && health.knownLeader !== false;

      await this.processLeader(clusterId, datacenter, leader, hasLeader, now, counters, failing);

      if (hasLeader) {
        const autopilot = await client.getAutopilotHealth(datacenter);
        servers += autopilot.Servers?.length ?? 0;
        await this.processServers(clusterId, datacenter, autopilot, now, counters, failing);
      } else {
        leaderlessDatacenters.add(datacenter);
      }

      const criticalNodes = await this.processNodes(clusterId, datacenter, health.checks, now, counters, failing);
      nodes += criticalNodes.total;
      await this.processServices(
        clusterId,
        datacenter,
        health.checks,
        criticalNodes.serfCritical,
        now,
        counters,
        failing,
        services
      );
    }

    await this.resolveRecovered(clusterId, TYPE.NO_LEADER, failing, now, counters);
    await this.resolveRecovered(clusterId, TYPE.SERVER_UNHEALTHY, failing, now, counters, incident =>
      leaderlessDatacenters.has(this.datacenterOf(incident.resourceKey))
    );
    await this.resolveRecovered(clusterId, TYPE.NODE_CRITICAL, failing, now, counters);
    // A recovered service stays open until it has been healthy for RECOVERY_HOLD_MS.
    // A service that is no longer registered is resolved immediately.
    await this.resolveRecovered(clusterId, TYPE.SERVICE_CRITICAL, failing, now, counters, incident => {
      const observed = services.get(incident.resourceKey);
      return observed !== undefined && now.getTime() - observed.since.getTime() < RECOVERY_HOLD_MS;
    });

    await this.markMissingServices(clusterId, services, now, counters);

    return {
      startedAt: now.toISOString(),
      finishedAt: new Date().toISOString(),
      datacenters: datacenters.length,
      servers,
      nodes,
      services: services.size,
      ...counters
    };
  }

  private async processLeader(
    clusterId: string,
    datacenter: string,
    leader: string,
    hasLeader: boolean,
    observedAt: Date,
    counters: Counters,
    failing: FailingSets
  ): Promise<void> {
    const payload = { datacenter, leader: leader || null };
    const snapshot = await this.monitoring.record({
      clusterId,
      source: SOURCE,
      resourceType: RESOURCE.CLUSTER,
      resourceKey: datacenter,
      resourceName: datacenter,
      state: hasLeader ? "LEADER_OK" : "NO_LEADER",
      payload,
      observedAt
    });
    if (snapshot.changed) counters.snapshotChanges += 1;
    if (hasLeader) return;

    const fingerprint = this.fingerprint(clusterId, TYPE.NO_LEADER, RESOURCE.CLUSTER, datacenter);
    failing[TYPE.NO_LEADER].add(fingerprint);
    await this.alerting.processFailure({
      clusterId,
      source: SOURCE,
      type: TYPE.NO_LEADER,
      severity: CONSUL_INCIDENT_SEVERITY.NO_LEADER,
      resourceType: RESOURCE.CLUSTER,
      resourceKey: datacenter,
      resourceName: datacenter,
      fingerprint,
      message: `Consul datacenter ${datacenter} has no cluster leader.`,
      context: payload,
      detectedAt: observedAt
    });
    counters.failuresProcessed += 1;
  }

  private async processServers(
    clusterId: string,
    datacenter: string,
    autopilot: ConsulAutopilotHealth,
    observedAt: Date,
    counters: Counters,
    failing: FailingSets
  ): Promise<void> {
    for (const server of autopilot.Servers ?? []) {
      const resourceKey = `${datacenter}:${server.ID}`;
      const healthy = server.Healthy === true;
      const payload = { datacenter, ...this.asPayload(server) };
      const snapshot = await this.monitoring.record({
        clusterId,
        source: SOURCE,
        resourceType: RESOURCE.SERVER,
        resourceKey,
        resourceName: server.Name,
        state: healthy ? "HEALTHY" : "UNHEALTHY",
        payload,
        observedAt
      });
      if (snapshot.changed) counters.snapshotChanges += 1;
      if (healthy) continue;

      const fingerprint = this.fingerprint(clusterId, TYPE.SERVER_UNHEALTHY, RESOURCE.SERVER, resourceKey);
      failing[TYPE.SERVER_UNHEALTHY].add(fingerprint);
      await this.alerting.processFailure({
        clusterId,
        source: SOURCE,
        type: TYPE.SERVER_UNHEALTHY,
        severity: CONSUL_INCIDENT_SEVERITY.SERVER_UNHEALTHY,
        resourceType: RESOURCE.SERVER,
        resourceKey,
        resourceName: server.Name,
        fingerprint,
        message: this.serverMessage(datacenter, server),
        context: payload,
        detectedAt: observedAt
      });
      counters.failuresProcessed += 1;
    }
  }

  private serverMessage(datacenter: string, server: ConsulAutopilotServer): string {
    const serf = server.SerfStatus ? ` (serf ${server.SerfStatus})` : "";
    return `Consul server ${server.Name} in ${datacenter} is unhealthy${serf}.`;
  }

  /** Node state is the worst status of its node-level checks (checks without a service). */
  private async processNodes(
    clusterId: string,
    datacenter: string,
    checks: ConsulHealthCheck[],
    observedAt: Date,
    counters: Counters,
    failing: FailingSets
  ): Promise<{ total: number; serfCritical: Set<string> }> {
    const nodeChecks = new Map<string, ConsulHealthCheck[]>();
    for (const check of checks) {
      if (check.ServiceID) continue;
      const group = nodeChecks.get(check.Node) ?? [];
      group.push(check);
      nodeChecks.set(check.Node, group);
    }

    const serfCritical = new Set<string>();

    for (const [node, group] of nodeChecks.entries()) {
      const resourceKey = `${datacenter}:${node}`;
      const state = this.worstStatus(group);
      const snapshot = await this.monitoring.record({
        clusterId,
        source: SOURCE,
        resourceType: RESOURCE.NODE,
        resourceKey,
        resourceName: node,
        state,
        payload: { datacenter, node, checks: group.map(check => this.checkSummary(check)) },
        observedAt
      });
      if (snapshot.changed) counters.snapshotChanges += 1;

      if (group.some(check => check.CheckID === SERF_HEALTH_CHECK_ID && this.isCritical(check))) {
        serfCritical.add(node);
      }
      if (state !== "CRITICAL") continue;

      const critical = group.filter(check => this.isCritical(check));
      const fingerprint = this.fingerprint(clusterId, TYPE.NODE_CRITICAL, RESOURCE.NODE, resourceKey);
      failing[TYPE.NODE_CRITICAL].add(fingerprint);
      await this.alerting.processFailure({
        clusterId,
        source: SOURCE,
        type: TYPE.NODE_CRITICAL,
        severity: CONSUL_INCIDENT_SEVERITY.NODE_CRITICAL,
        resourceType: RESOURCE.NODE,
        resourceKey,
        resourceName: node,
        fingerprint,
        message: `Consul node ${node} in ${datacenter} is critical: ${critical.map(check => check.Name).join(", ")}.`,
        context: { datacenter, node, checks: critical.map(check => this.checkSummary(check)) },
        detectedAt: observedAt
      });
      counters.failuresProcessed += 1;
    }

    return { total: nodeChecks.size, serfCritical };
  }

  /**
   * CONSUL_SERVICE_CRITICAL is raised once per service. An instance is
   * unhealthy when one of its checks is critical or its node's serfHealth is
   * critical (Consul keeps the service checks of a dead node at their last status).
   */
  private async processServices(
    clusterId: string,
    datacenter: string,
    checks: ConsulHealthCheck[],
    serfCriticalNodes: Set<string>,
    observedAt: Date,
    counters: Counters,
    failing: FailingSets,
    observations: Map<string, ServiceObservation>
  ): Promise<void> {
    const services = new Map<string, Map<string, ServiceInstance>>();
    for (const check of checks) {
      if (!check.ServiceID) continue;
      const serviceName = check.ServiceName || check.ServiceID;
      const instances = services.get(serviceName) ?? new Map<string, ServiceInstance>();
      const instanceKey = `${check.Node}/${check.ServiceID}`;
      const instance = instances.get(instanceKey) ?? { node: check.Node, serviceId: check.ServiceID, checks: [] };
      instance.checks.push(check);
      instances.set(instanceKey, instance);
      services.set(serviceName, instances);
    }

    for (const [serviceName, instanceMap] of services.entries()) {
      const resourceKey = `${datacenter}:${serviceName}`;
      const instances = [...instanceMap.values()];
      const unhealthy = instances
        .map(instance => {
          const nodeDown = serfCriticalNodes.has(instance.node);
          const criticalChecks = instance.checks.filter(check => this.isCritical(check));
          if (!nodeDown && criticalChecks.length === 0) return null;
          return {
            serviceId: instance.serviceId,
            node: instance.node,
            reason: nodeDown ? "NODE_DOWN" : "SERVICE_CHECK",
            checks: criticalChecks.map(check => this.checkSummary(check))
          };
        })
        .filter(instance => instance !== null);

      const total = instances.length;
      const status = unhealthy.length === 0
        ? null
        : unhealthy.length === total ? "FAILED" : "DEGRADED";
      const state = status
        ?? (instances.some(instance => instance.checks.some(check => this.statusOf(check) === "WARNING"))
          ? "WARNING"
          : "HEALTHY");

      const context = {
        datacenter,
        service: serviceName,
        status: state,
        total,
        unhealthy: unhealthy.length,
        instances: unhealthy
      };

      const snapshot = await this.monitoring.record({
        clusterId,
        source: SOURCE,
        resourceType: RESOURCE.SERVICE,
        resourceKey,
        resourceName: serviceName,
        state,
        payload: context,
        observedAt
      });
      if (snapshot.changed) counters.snapshotChanges += 1;
      observations.set(resourceKey, { state, since: snapshot.lastChangedAt });
      if (!status) continue;

      const fingerprint = this.fingerprint(clusterId, TYPE.SERVICE_CRITICAL, RESOURCE.SERVICE, resourceKey);
      failing[TYPE.SERVICE_CRITICAL].add(fingerprint);
      await this.alerting.processFailure({
        clusterId,
        source: SOURCE,
        type: TYPE.SERVICE_CRITICAL,
        severity: status === "FAILED"
          ? CONSUL_INCIDENT_SEVERITY.SERVICE_FAILED
          : CONSUL_INCIDENT_SEVERITY.SERVICE_DEGRADED,
        resourceType: RESOURCE.SERVICE,
        resourceKey,
        resourceName: serviceName,
        fingerprint,
        message: `Consul service ${serviceName} in ${datacenter} ${status.toLowerCase()}: `
          + `${unhealthy.length} of ${total} instances unhealthy.`,
        context,
        detectedAt: observedAt
      });
      counters.failuresProcessed += 1;
    }
  }

  /**
   * Resolves the open incidents of `type` that were not raised in this pull,
   * except those `keepOpen` returns true for.
   */
  private async resolveRecovered(
    clusterId: string,
    type: keyof FailingSets,
    failing: FailingSets,
    observedAt: Date,
    counters: Counters,
    keepOpen: (incident: { resourceKey: string }) => boolean = () => false
  ): Promise<void> {
    const openIncidents = await this.alerting.findOpenIncidents(clusterId, type);
    for (const incident of openIncidents) {
      if (!incident.activeFingerprint || failing[type].has(incident.activeFingerprint)) continue;
      if (keepOpen(incident)) continue;

      const resolved = await this.alerting.processRecovery({
        fingerprint: incident.activeFingerprint,
        detectedAt: observedAt
      });
      if (resolved) counters.recoveriesProcessed += 1;
    }
  }

  /** Services that are no longer registered are marked NOT_FOUND in the current state. */
  private async markMissingServices(
    clusterId: string,
    services: Map<string, ServiceObservation>,
    observedAt: Date,
    counters: Counters
  ): Promise<void> {
    const latestStates = await this.monitoring.latestStates({
      clusterId,
      source: SOURCE,
      resourceType: RESOURCE.SERVICE
    });

    for (const latest of latestStates) {
      if (latest.state === "NOT_FOUND" || services.has(latest.resourceKey)) continue;

      const snapshot = await this.monitoring.record({
        clusterId,
        source: SOURCE,
        resourceType: RESOURCE.SERVICE,
        resourceKey: latest.resourceKey,
        state: "NOT_FOUND",
        payload: null,
        observedAt
      });
      if (snapshot.changed) counters.snapshotChanges += 1;
    }
  }

  private datacenterOf(resourceKey: string): string {
    const separator = resourceKey.indexOf(":");
    return separator === -1 ? resourceKey : resourceKey.slice(0, separator);
  }

  private worstStatus(checks: ConsulHealthCheck[]): string {
    const statuses = checks.map(check => this.statusOf(check));
    if (statuses.includes("CRITICAL")) return "CRITICAL";
    if (statuses.includes("WARNING")) return "WARNING";
    return "PASSING";
  }

  private isCritical(check: ConsulHealthCheck): boolean {
    return this.statusOf(check) === "CRITICAL";
  }

  private statusOf(check: ConsulHealthCheck): string {
    return String(check.Status ?? "").toUpperCase();
  }

  private checkSummary(check: ConsulHealthCheck): Record<string, unknown> {
    const output = check.Output ?? "";
    return {
      checkId: check.CheckID,
      name: check.Name,
      status: check.Status,
      output: output.length > CHECK_OUTPUT_MAX ? output.slice(0, CHECK_OUTPUT_MAX) : output
    };
  }

  private fingerprint(clusterId: string, type: string, resourceType: string, resourceKey: string): string {
    return createConsulFingerprint({ clusterId, type, resourceType, resourceKey });
  }

  private asPayload(value: object): Record<string, unknown> {
    return value as Record<string, unknown>;
  }
}

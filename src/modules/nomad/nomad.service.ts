import { AppError } from "../../common/errors/app-error";
import { AlertingService } from "../alerting/alerting.service";
import type { ClusterEntity } from "../clusters/cluster.entity";
import type { ClusterRepositoryPort } from "../clusters/cluster.types";
import { serializeClusterId, toClusterMetadata } from "../clusters/cluster.types";
import { MonitoringObservationService } from "../monitoring/monitoring-observation.service";
import {
  getNomadAllocationLogicalIdentity,
  type NomadAllocationLogicalIdentity
} from "./nomad-allocation-key";
import { createNomadFingerprint } from "./nomad.fingerprint";
import { NOMAD_INCIDENT_SEVERITY } from "./nomad.severity";
import type {
  NomadAllocation,
  NomadClientFactory,
  NomadClusterApiMetadata,
  NomadClusterItem,
  NomadEvaluation,
  NomadJob,
  NomadNode,
  NomadPullOutcome,
  NomadPullResult,
  ScopedNomadPullResult
} from "./nomad.types";

interface AllocationSlotResult {
  identity: NomadAllocationLogicalIdentity;
  state: string;
  /** Most recent failed allocation when the slot counts as failed, otherwise null. */
  failedAllocation: NomadAllocation | null;
  payload: Record<string, unknown>;
  snapshotChanged: boolean;
}

export class NomadService {
  private pulling = false;

  constructor(
    private readonly clusters: ClusterRepositoryPort,
    private readonly clientFactory: NomadClientFactory,
    private readonly monitoring: MonitoringObservationService,
    private readonly alerting: AlertingService
  ) {}

  async getNodes(clusterId?: string): Promise<Array<NomadClusterItem<NomadNode>>> {
    return this.listAcrossClusters(clusterId, client => client.getNodes());
  }

  async getNode(nodeId: string, clusterId?: string): Promise<NomadClusterItem<NomadNode>> {
    return this.detailAcrossClusters(clusterId, client => client.getNode(nodeId));
  }

  async getAllocations(clusterId?: string): Promise<Array<NomadClusterItem<NomadAllocation>>> {
    return this.listAcrossClusters(clusterId, client => client.getAllocations());
  }

  async getFailedAllocations(clusterId?: string): Promise<Array<NomadClusterItem<NomadAllocation>>> {
    return this.listAcrossClusters(clusterId, client => client.getFailedAllocations());
  }

  async getAllocation(allocationId: string, clusterId?: string): Promise<NomadClusterItem<NomadAllocation>> {
    return this.detailAcrossClusters(clusterId, client => client.getAllocation(allocationId));
  }

  async getJobSummary(jobId: string, clusterId?: string): Promise<NomadClusterItem<Record<string, unknown>>> {
    return this.detailAcrossClusters(clusterId, client => client.getJobSummary(jobId));
  }

  async getBlockedEvaluations(clusterId?: string): Promise<Array<NomadClusterItem<NomadEvaluation>>> {
    return this.listAcrossClusters(clusterId, client => client.getBlockedEvaluations());
  }

  async pullOnce(
    clusterId?: string,
    now = new Date()
  ): Promise<ScopedNomadPullResult | NomadPullOutcome[]> {
    if (this.pulling) {
      throw new AppError(409, "NOMAD_PULL_IN_PROGRESS", "Nomad pull is already running.");
    }

    this.pulling = true;
    try {
      const selected = await this.selectedClusters(clusterId);
      if (clusterId) {
        const cluster = selected[0];
        const result = await this.pullCluster(cluster, now);
        return { ...this.apiMetadata(cluster), ...result };
      }

      const outcomes: NomadPullOutcome[] = [];
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
    if (!clusterId) return this.clusters.findActive();
    const cluster = await this.clusters.findById(clusterId);
    if (!cluster || !cluster.isActive) {
      throw new AppError(404, "CLUSTER_NOT_FOUND", `Cluster ${clusterId} was not found or is inactive.`);
    }
    return [cluster];
  }

  private apiMetadata(cluster: ClusterEntity): NomadClusterApiMetadata {
    const metadata = toClusterMetadata(cluster);
    return {
      clusterId: serializeClusterId(metadata.clusterId),
      clusterName: metadata.clusterName,
      site: metadata.site,
      appName: metadata.appName,
      env: metadata.env
    };
  }

  private enrich<T extends Record<string, unknown>>(value: T, cluster: ClusterEntity): NomadClusterItem<T> {
    return {
      ...value,
      ...this.apiMetadata(cluster)
    };
  }

  private async listAcrossClusters<T extends Record<string, unknown>>(
    clusterId: string | undefined,
    read: (client: ReturnType<NomadClientFactory>) => Promise<T[]>
  ): Promise<Array<NomadClusterItem<T>>> {
    const selected = await this.selectedClusters(clusterId);
    const resultSets = await Promise.all(selected.map(async cluster => {
      const items = await read(this.clientFactory(cluster));
      return items.map(item => this.enrich(item, cluster));
    }));
    return resultSets.flat();
  }

  private async detailAcrossClusters<T extends Record<string, unknown>>(
    clusterId: string | undefined,
    read: (client: ReturnType<NomadClientFactory>) => Promise<T>
  ): Promise<NomadClusterItem<T>> {
    const selected = await this.selectedClusters(clusterId);
    if (clusterId) {
      const cluster = selected[0];
      return this.enrich(await read(this.clientFactory(cluster)), cluster);
    }

    const matches: Array<NomadClusterItem<T>> = [];
    for (const cluster of selected) {
      try {
        matches.push(this.enrich(await read(this.clientFactory(cluster)), cluster));
      } catch (error) {
        if (error instanceof AppError && error.code === "NOMAD_RESOURCE_NOT_FOUND") continue;
        throw error;
      }
    }

    if (matches.length === 0) {
      throw new AppError(404, "NOMAD_RESOURCE_NOT_FOUND", "Nomad resource was not found.");
    }
    if (matches.length > 1) {
      throw new AppError(
        409,
        "NOMAD_RESOURCE_CLUSTER_AMBIGUOUS",
        "Nomad resource exists in more than one cluster; specify the cluster query parameter."
      );
    }
    return matches[0];
  }

  private async pullCluster(cluster: ClusterEntity, now: Date): Promise<NomadPullResult> {
    const client = this.clientFactory(cluster);
    const startedAt = now;
    let snapshotChanges = 0;
    let failuresProcessed = 0;
    let recoveriesProcessed = 0;

    const [nodes, allocations, failedAllocations, blockedEvaluations, jobs] = await Promise.all([
      client.getNodes(),
      client.getAllocations(),
      client.getFailedAllocations(),
      client.getBlockedEvaluations(),
      client.getJobs()
    ]);

    for (const node of nodes) {
      const result = await this.processNode(cluster.clusterId, node, now);
      snapshotChanges += result.snapshotChanges;
      failuresProcessed += result.failuresProcessed;
      recoveriesProcessed += result.recoveriesProcessed;
    }

    const allocationResult = await this.processAllocations(
      cluster.clusterId,
      allocations,
      failedAllocations,
      jobs,
      now
    );
    snapshotChanges += allocationResult.snapshotChanges;
    failuresProcessed += allocationResult.failuresProcessed;
    recoveriesProcessed += allocationResult.recoveriesProcessed;

    const evaluationResult = await this.processBlockedEvaluations(cluster.clusterId, blockedEvaluations, now);
    snapshotChanges += evaluationResult.snapshotChanges;
    failuresProcessed += evaluationResult.failuresProcessed;
    recoveriesProcessed += evaluationResult.recoveriesProcessed;

    return {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      nodes: nodes.length,
      allocations: allocations.length,
      blockedEvaluations: blockedEvaluations.length,
      snapshotChanges,
      failuresProcessed,
      recoveriesProcessed
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

  private async processNode(clusterId: string, node: NomadNode, observedAt: Date) {
    let snapshotChanges = 0;
    let failuresProcessed = 0;
    let recoveriesProcessed = 0;

    const nodeState = String(node.Status ?? "").toUpperCase();
    const nodeSnapshot = await this.monitoring.record({
      clusterId: clusterId,
      source: "NOMAD",
      resourceType: "NODE",
      resourceKey: node.ID,
      resourceName: node.Name,
      state: nodeState,
      payload: this.asPayload(node),
      observedAt
    });
    if (nodeSnapshot.changed) snapshotChanges += 1;

    const nodeFingerprint = createNomadFingerprint({
      clusterId: clusterId,
      type: "NODE_DOWN",
      resourceType: "NODE",
      resourceKey: node.ID
    });

    if (nodeState === "DOWN") {
      await this.alerting.processFailure({
        clusterId: clusterId,
        source: "NOMAD",
        type: "NODE_DOWN",
        severity: NOMAD_INCIDENT_SEVERITY.NODE_DOWN,
        resourceType: "NODE",
        resourceKey: node.ID,
        resourceName: node.Name,
        fingerprint: nodeFingerprint,
        message: node.StatusDescription || `Nomad node ${node.Name} is down.`,
        context: this.asPayload(node),
        detectedAt: observedAt
      });
      failuresProcessed += 1;
    } else if (nodeState === "READY") {
      const resolved = await this.alerting.processRecovery({ fingerprint: nodeFingerprint, detectedAt: observedAt });
      if (resolved) recoveriesProcessed += 1;
    }

    for (const [driverName, driver] of Object.entries(node.Drivers ?? {})) {
      const detected = driver.Detected === true;
      const healthy = driver.Healthy === true;
      const driverState = !detected ? "NOT_DETECTED" : healthy ? "HEALTHY" : "UNHEALTHY";
      const resourceKey = `${node.ID}:${driverName}`;
      const driverSnapshot = await this.monitoring.record({
        clusterId: clusterId,
        source: "NOMAD",
        resourceType: "DRIVER",
        resourceKey,
        resourceName: `${node.Name}/${driverName}`,
        state: driverState,
        payload: this.asPayload(driver),
        observedAt
      });
      if (driverSnapshot.changed) snapshotChanges += 1;

      const fingerprint = createNomadFingerprint({
        clusterId: clusterId,
        type: "DRIVER_UNHEALTHY",
        resourceType: "DRIVER",
        resourceKey
      });

      if (detected && !healthy) {
        await this.alerting.processFailure({
          clusterId: clusterId,
          source: "NOMAD",
          type: "DRIVER_UNHEALTHY",
          severity: NOMAD_INCIDENT_SEVERITY.DRIVER_UNHEALTHY,
          resourceType: "DRIVER",
          resourceKey,
          resourceName: `${node.Name}/${driverName}`,
          fingerprint,
          message: driver.HealthDescription || `Nomad driver ${driverName} on ${node.Name} is unhealthy.`,
          context: {
            nodeId: node.ID,
            nodeName: node.Name,
            nodeAddress: node.Address ?? null,
            driver: driverName,
            ...this.asPayload(driver)
          },
          detectedAt: observedAt
        });
        failuresProcessed += 1;
      } else if (driverState === "HEALTHY" || driverState === "NOT_DETECTED") {
        const resolved = await this.alerting.processRecovery({ fingerprint, detectedAt: observedAt });
        if (resolved) recoveriesProcessed += 1;
      }
    }

    return { snapshotChanges, failuresProcessed, recoveriesProcessed };
  }

  private async processAllocations(
    clusterId: string,
    allocations: NomadAllocation[],
    failedAllocations: NomadAllocation[],
    jobs: NomadJob[],
    observedAt: Date
  ) {
    let snapshotChanges = 0;
    let failuresProcessed = 0;
    let recoveriesProcessed = 0;

    // Jobs that are stopped or no longer registered (purged) do not need an
    // ALLOCATION_FAILED alert anymore.
    const runningJobKeys = new Set(
      jobs
        .filter(job => job.Stop !== true)
        .map(job => this.jobKey(job.Namespace, job.ID))
    );

    // System and sysbatch jobs have one allocation per node, all named [0].
    const perNodeJobKeys = new Set(
      jobs
        .filter(job => ["SYSTEM", "SYSBATCH"].includes(String(job.Type ?? "").toUpperCase()))
        .map(job => this.jobKey(job.Namespace, job.ID))
    );
    const identityOf = (allocation: NomadAllocation) => getNomadAllocationLogicalIdentity(allocation, {
      perNode: perNodeJobKeys.has(this.jobKey(allocation.Namespace, String(allocation.JobID ?? "")))
    });

    const groups = new Map<string, NomadAllocation[]>();
    const failedGroups = new Map<string, NomadAllocation[]>();

    for (const allocation of allocations) {
      const identity = identityOf(allocation);
      const group = groups.get(identity.resourceKey) ?? [];
      group.push(allocation);
      groups.set(identity.resourceKey, group);
    }

    for (const allocation of failedAllocations) {
      const identity = identityOf(allocation);
      const group = failedGroups.get(identity.resourceKey) ?? [];
      group.push(allocation);
      failedGroups.set(identity.resourceKey, group);
    }

    // Slot states per job: ALLOCATION_FAILED is raised once per Nomad job.
    const jobSlots = new Map<string, { jobId: string; slots: AllocationSlotResult[] }>();

    for (const [resourceKey, group] of groups.entries()) {
      const slot = await this.processAllocationSlot(
        clusterId,
        group,
        failedGroups.get(resourceKey) ?? [],
        identityOf,
        runningJobKeys,
        observedAt
      );
      if (slot.snapshotChanged) snapshotChanges += 1;

      const { namespace, jobId } = slot.identity;
      if (jobId === null) continue;
      const key = this.jobKey(namespace, jobId);
      const entry = jobSlots.get(key) ?? { jobId, slots: [] };
      entry.slots.push(slot);
      jobSlots.set(key, entry);
    }

    const failingFingerprints = new Set<string>();

    for (const [jobKey, { jobId, slots }] of jobSlots.entries()) {
      const failedSlots = slots.filter(slot => slot.failedAllocation !== null);
      if (failedSlots.length === 0) continue;

      const running = slots.filter(slot => slot.state === "RUNNING").length;
      const total = slots.length;
      const status = running > 0 ? "DEGRADED" : "FAILED";
      const latest = [...failedSlots].sort((left, right) =>
        this.allocationOrder(right.failedAllocation!) - this.allocationOrder(left.failedAllocation!)
      )[0];
      const latestDescription = latest.failedAllocation!.ClientDescription;

      const fingerprint = createNomadFingerprint({
        clusterId: clusterId,
        type: "ALLOCATION_FAILED",
        resourceType: "ALLOCATION",
        resourceKey: jobKey
      });
      failingFingerprints.add(fingerprint);

      await this.alerting.processFailure({
        clusterId: clusterId,
        source: "NOMAD",
        type: "ALLOCATION_FAILED",
        severity: status === "FAILED"
          ? NOMAD_INCIDENT_SEVERITY.ALLOCATION_JOB_FAILED
          : NOMAD_INCIDENT_SEVERITY.ALLOCATION_JOB_DEGRADED,
        resourceType: "ALLOCATION",
        resourceKey: jobKey,
        resourceName: jobId,
        fingerprint,
        message: `Nomad job ${jobId} ${status.toLowerCase()}: ${failedSlots.length} of ${total} allocations failed.`
          + (latestDescription ? ` Latest: ${latestDescription}` : ""),
        context: {
          ...latest.payload,
          jobSummary: {
            status,
            failed: failedSlots.length,
            running,
            total
          }
        },
        detectedAt: observedAt
      });
      failuresProcessed += 1;
    }

    // Any other open ALLOCATION_FAILED incident of this cluster is resolved:
    // its job has no failed allocation anymore, is stopped or purged, or it is
    // a per-slot incident from before alerts were grouped per job.
    const openIncidents = await this.alerting.findOpenIncidents(clusterId, "ALLOCATION_FAILED");
    for (const incident of openIncidents) {
      if (!incident.activeFingerprint || failingFingerprints.has(incident.activeFingerprint)) continue;
      const resolved = await this.alerting.processRecovery({
        fingerprint: incident.activeFingerprint,
        detectedAt: observedAt
      });
      if (resolved) recoveriesProcessed += 1;
    }

    // Allocation slots that disappeared from Nomad (garbage collected, job
    // purged, or count scaled down) are marked NOT_FOUND in the current state.
    const latestStates = await this.monitoring.latestStates({
      clusterId: clusterId,
      source: "NOMAD",
      resourceType: "ALLOCATION"
    });

    for (const latest of latestStates) {
      if (latest.state !== "FAILED" || groups.has(latest.resourceKey)) continue;

      const recoverySnapshot = await this.monitoring.record({
        clusterId: clusterId,
        source: "NOMAD",
        resourceType: "ALLOCATION",
        resourceKey: latest.resourceKey,
        state: "NOT_FOUND",
        payload: null,
        observedAt
      });
      if (recoverySnapshot.changed) snapshotChanges += 1;
    }

    return { snapshotChanges, failuresProcessed, recoveriesProcessed };
  }

  private jobKey(namespace: string | null | undefined, jobId: string): string {
    return `${namespace || "default"}:${jobId}`;
  }

  /** Records the current state of one logical allocation slot. */
  private async processAllocationSlot(
    clusterId: string,
    allocations: NomadAllocation[],
    failedAllocations: NomadAllocation[],
    identityOf: (allocation: NomadAllocation) => NomadAllocationLogicalIdentity,
    runningJobKeys: Set<string>,
    observedAt: Date
  ): Promise<AllocationSlotResult> {
    const representative = this.selectAllocationRepresentative(allocations);
    const identity = identityOf(representative);
    const runningAllocation = this.selectMostRecentAllocation(
      allocations.filter(allocation => this.allocationState(allocation) === "RUNNING")
    );
    // Nomad does not set DesiredStatus=stop on allocations that were already
    // failed when the job is stopped, so the job state is checked as well.
    const jobStopped = identity.jobId !== null
      && !runningJobKeys.has(this.jobKey(identity.namespace, identity.jobId));
    const failedAllocation = jobStopped || runningAllocation
      ? null
      : this.selectMostRecentAllocation(
        failedAllocations.filter(allocation =>
          String(allocation.DesiredStatus ?? "").toUpperCase() !== "STOP"
        )
      );

    // A logical allocation slot is considered recovered when Nomad has a
    // running allocation for that slot, even if an older allocation ID remains
    // permanently FAILED in Nomad history.
    const effectiveAllocation = runningAllocation ?? failedAllocation ?? representative;
    const state = runningAllocation
      ? "RUNNING"
      : failedAllocation
        ? "FAILED"
        : this.allocationState(effectiveAllocation);

    const payload = {
      logicalAllocation: {
        resourceKey: identity.resourceKey,
        namespace: identity.namespace,
        jobId: identity.jobId,
        taskGroup: identity.taskGroup,
        slot: identity.slot
      },
      currentAllocation: this.asPayload(effectiveAllocation),
      observedAllocationIds: allocations.map(allocation => allocation.ID)
    };

    const snapshot = await this.monitoring.record({
      clusterId: clusterId,
      source: "NOMAD",
      resourceType: "ALLOCATION",
      resourceKey: identity.resourceKey,
      resourceName: identity.resourceName,
      state,
      payload,
      observedAt
    });

    return {
      identity,
      state,
      failedAllocation,
      payload,
      snapshotChanged: snapshot.changed
    };
  }

  private selectAllocationRepresentative(allocations: NomadAllocation[]): NomadAllocation {
    const selected = this.selectMostRecentAllocation(allocations);
    if (!selected) {
      throw new AppError(500, "NOMAD_ALLOCATION_GROUP_EMPTY", "Nomad allocation group is empty.");
    }
    return selected;
  }

  private selectMostRecentAllocation(allocations: NomadAllocation[]): NomadAllocation | null {
    if (allocations.length === 0) return null;
    return [...allocations].sort((left, right) => this.allocationOrder(right) - this.allocationOrder(left))[0];
  }

  private allocationOrder(allocation: NomadAllocation): number {
    return Number(allocation.CreateIndex ?? allocation.ModifyIndex ?? 0);
  }

  private allocationState(allocation: NomadAllocation): string {
    return String(allocation.ClientStatus ?? "").toUpperCase();
  }

  private async processBlockedEvaluations(clusterId: string, evaluations: NomadEvaluation[], observedAt: Date) {
    let snapshotChanges = 0;
    let failuresProcessed = 0;
    let recoveriesProcessed = 0;
    const currentBlockedKeys = new Set<string>();

    for (const evaluation of evaluations) {
      if (!evaluation.ID) continue;
      currentBlockedKeys.add(evaluation.ID);
      const snapshot = await this.monitoring.record({
        clusterId: clusterId,
        source: "NOMAD",
        resourceType: "EVALUATION",
        resourceKey: evaluation.ID,
        resourceName: evaluation.JobID ?? evaluation.ID,
        state: "BLOCKED",
        payload: this.asPayload(evaluation),
        observedAt
      });
      if (snapshot.changed) snapshotChanges += 1;

      const fingerprint = createNomadFingerprint({
        clusterId: clusterId,
        type: "EVALUATION_BLOCKED",
        resourceType: "EVALUATION",
        resourceKey: evaluation.ID
      });

      await this.alerting.processFailure({
        clusterId: clusterId,
        source: "NOMAD",
        type: "EVALUATION_BLOCKED",
        severity: NOMAD_INCIDENT_SEVERITY.EVALUATION_BLOCKED,
        resourceType: "EVALUATION",
        resourceKey: evaluation.ID,
        resourceName: evaluation.JobID ?? evaluation.ID,
        fingerprint,
        message: `Nomad evaluation ${evaluation.ID} is blocked.`,
        context: this.asPayload(evaluation),
        detectedAt: observedAt
      });
      failuresProcessed += 1;
    }

    const latestStates = await this.monitoring.latestStates({
      clusterId: clusterId,
      source: "NOMAD",
      resourceType: "EVALUATION"
    });

    for (const latest of latestStates) {
      if (latest.state !== "BLOCKED" || currentBlockedKeys.has(latest.resourceKey)) continue;

      const fingerprint = createNomadFingerprint({
        clusterId: clusterId,
        type: "EVALUATION_BLOCKED",
        resourceType: "EVALUATION",
        resourceKey: latest.resourceKey
      });
      const resolved = await this.alerting.processRecovery({ fingerprint, detectedAt: observedAt });
      const recoverySnapshot = await this.monitoring.record({
        clusterId: clusterId,
        source: "NOMAD",
        resourceType: "EVALUATION",
        resourceKey: latest.resourceKey,
        state: "NOT_BLOCKED",
        payload: null,
        observedAt
      });
      if (recoverySnapshot.changed) snapshotChanges += 1;
      if (resolved) recoveriesProcessed += 1;
    }

    return { snapshotChanges, failuresProcessed, recoveriesProcessed };
  }

  private asPayload(value: object): Record<string, unknown> {
    return value as Record<string, unknown>;
  }
}

import { AppError } from "../../common/errors/app-error";
import { AlertingService } from "../alerting/alerting.service";
import { MonitoringObservationService } from "../monitoring/monitoring-observation.service";
import { NomadClient } from "./nomad.client";
import { getNomadAllocationLogicalIdentity } from "./nomad-allocation-key";
import { createNomadFingerprint } from "./nomad.fingerprint";
import { NOMAD_INCIDENT_SEVERITY } from "./nomad.severity";
import type { NomadAllocation, NomadEvaluation, NomadNode, NomadPullResult } from "./nomad.types";

export interface NomadMonitoringConfig {
  clusterId: string;
}

export class NomadService {
  private pulling = false;

  constructor(
    private readonly client: NomadClient,
    private readonly monitoring: MonitoringObservationService,
    private readonly alerting: AlertingService,
    private readonly config: NomadMonitoringConfig
  ) {}

  getNodes(): Promise<NomadNode[]> {
    return this.client.getNodes();
  }

  getNode(nodeId: string): Promise<NomadNode> {
    return this.client.getNode(nodeId);
  }

  getAllocations(): Promise<NomadAllocation[]> {
    return this.client.getAllocations();
  }

  getFailedAllocations(): Promise<NomadAllocation[]> {
    return this.client.getFailedAllocations();
  }

  getAllocation(allocationId: string): Promise<NomadAllocation> {
    return this.client.getAllocation(allocationId);
  }

  getJobSummary(jobId: string): Promise<Record<string, unknown>> {
    return this.client.getJobSummary(jobId);
  }

  getBlockedEvaluations(): Promise<NomadEvaluation[]> {
    return this.client.getBlockedEvaluations();
  }

  async pullOnce(now = new Date()): Promise<NomadPullResult> {
    if (this.pulling) {
      throw new AppError(409, "NOMAD_PULL_IN_PROGRESS", "Nomad pull is already running.");
    }

    this.pulling = true;
    const startedAt = now;
    let snapshotChanges = 0;
    let failuresProcessed = 0;
    let recoveriesProcessed = 0;

    try {
      const [nodes, allocations, blockedEvaluations] = await Promise.all([
        this.client.getNodes(),
        this.client.getAllocations(),
        this.client.getBlockedEvaluations()
      ]);

      for (const node of nodes) {
        const result = await this.processNode(node, now);
        snapshotChanges += result.snapshotChanges;
        failuresProcessed += result.failuresProcessed;
        recoveriesProcessed += result.recoveriesProcessed;
      }

      const allocationResult = await this.processAllocations(allocations, now);
      snapshotChanges += allocationResult.snapshotChanges;
      failuresProcessed += allocationResult.failuresProcessed;
      recoveriesProcessed += allocationResult.recoveriesProcessed;

      const evaluationResult = await this.processBlockedEvaluations(blockedEvaluations, now);
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
    } finally {
      this.pulling = false;
    }
  }

  private async processNode(node: NomadNode, observedAt: Date) {
    let snapshotChanges = 0;
    let failuresProcessed = 0;
    let recoveriesProcessed = 0;

    const nodeState = String(node.Status ?? "").toUpperCase();
    const nodeSnapshot = await this.monitoring.record({
      clusterId: this.config.clusterId,
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
      clusterId: this.config.clusterId,
      type: "NODE_DOWN",
      resourceType: "NODE",
      resourceKey: node.ID
    });

    if (nodeState === "DOWN") {
      await this.alerting.processFailure({
        clusterId: this.config.clusterId,
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
        clusterId: this.config.clusterId,
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
        clusterId: this.config.clusterId,
        type: "DRIVER_UNHEALTHY",
        resourceType: "DRIVER",
        resourceKey
      });

      if (detected && !healthy) {
        await this.alerting.processFailure({
          clusterId: this.config.clusterId,
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

  private async processAllocations(allocations: NomadAllocation[], observedAt: Date) {
    let snapshotChanges = 0;
    let failuresProcessed = 0;
    let recoveriesProcessed = 0;

    const groups = new Map<string, NomadAllocation[]>();

    for (const allocation of allocations) {
      const identity = getNomadAllocationLogicalIdentity(allocation);
      const group = groups.get(identity.resourceKey) ?? [];
      group.push(allocation);
      groups.set(identity.resourceKey, group);
    }

    for (const group of groups.values()) {
      const result = await this.processAllocationGroup(group, observedAt);
      snapshotChanges += result.snapshotChanges;
      failuresProcessed += result.failuresProcessed;
      recoveriesProcessed += result.recoveriesProcessed;
    }

    return { snapshotChanges, failuresProcessed, recoveriesProcessed };
  }

  private async processAllocationGroup(allocations: NomadAllocation[], observedAt: Date) {
    const representative = this.selectAllocationRepresentative(allocations);
    const identity = getNomadAllocationLogicalIdentity(representative);
    const runningAllocation = this.selectMostRecentAllocation(
      allocations.filter(allocation => this.allocationState(allocation) === "RUNNING")
    );
    const failedAllocation = this.selectMostRecentAllocation(
      allocations.filter(allocation =>
        this.allocationState(allocation) === "FAILED" &&
        String(allocation.DesiredStatus ?? "").toUpperCase() !== "STOP"
      )
    );

    // A logical allocation slot is considered recovered when Nomad has a
    // running allocation for that slot, even if an older allocation ID remains
    // permanently FAILED in Nomad history.
    const effectiveAllocation = runningAllocation ?? failedAllocation ?? representative;
    const effectiveState = runningAllocation
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
      clusterId: this.config.clusterId,
      source: "NOMAD",
      resourceType: "ALLOCATION",
      resourceKey: identity.resourceKey,
      resourceName: identity.resourceName,
      state: effectiveState,
      payload,
      observedAt
    });

    const fingerprint = createNomadFingerprint({
      clusterId: this.config.clusterId,
      type: "ALLOCATION_FAILED",
      resourceType: "ALLOCATION",
      resourceKey: identity.resourceKey
    });

    const legacyFingerprints = allocations.map(allocation => createNomadFingerprint({
      clusterId: this.config.clusterId,
      type: "ALLOCATION_FAILED",
      resourceType: "ALLOCATION",
      resourceKey: allocation.ID
    }));

    if (runningAllocation) {
      const recoveredIncidentIds = new Set<string>();
      const resolvedCurrent = await this.alerting.processRecovery({ fingerprint, detectedAt: observedAt });
      if (resolvedCurrent) recoveredIncidentIds.add(resolvedCurrent.publicId);

      for (const legacyFingerprint of legacyFingerprints) {
        const resolvedLegacy = await this.alerting.processRecovery({
          fingerprint: legacyFingerprint,
          detectedAt: observedAt
        });
        if (resolvedLegacy) recoveredIncidentIds.add(resolvedLegacy.publicId);
      }

      return {
        snapshotChanges: snapshot.changed ? 1 : 0,
        failuresProcessed: 0,
        recoveriesProcessed: recoveredIncidentIds.size
      };
    }

    if (failedAllocation) {
      await this.alerting.processFailure({
        clusterId: this.config.clusterId,
        source: "NOMAD",
        type: "ALLOCATION_FAILED",
        severity: NOMAD_INCIDENT_SEVERITY.ALLOCATION_FAILED,
        resourceType: "ALLOCATION",
        resourceKey: identity.resourceKey,
        resourceName: identity.resourceName,
        fingerprint,
        message: failedAllocation.ClientDescription || `Nomad allocation ${identity.resourceName} failed.`,
        context: payload,
        detectedAt: observedAt
      }, { legacyFingerprints });

      return {
        snapshotChanges: snapshot.changed ? 1 : 0,
        failuresProcessed: 1,
        recoveriesProcessed: 0
      };
    }

    // Do not resolve ALLOCATION_FAILED merely because the newest state is
    // PENDING/COMPLETE/LOST/etc. Recovery requires a RUNNING replacement.
    return {
      snapshotChanges: snapshot.changed ? 1 : 0,
      failuresProcessed: 0,
      recoveriesProcessed: 0
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

  private async processBlockedEvaluations(evaluations: NomadEvaluation[], observedAt: Date) {
    let snapshotChanges = 0;
    let failuresProcessed = 0;
    let recoveriesProcessed = 0;
    const currentBlockedKeys = new Set<string>();

    for (const evaluation of evaluations) {
      if (!evaluation.ID) continue;
      currentBlockedKeys.add(evaluation.ID);
      const snapshot = await this.monitoring.record({
        clusterId: this.config.clusterId,
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
        clusterId: this.config.clusterId,
        type: "EVALUATION_BLOCKED",
        resourceType: "EVALUATION",
        resourceKey: evaluation.ID
      });

      await this.alerting.processFailure({
        clusterId: this.config.clusterId,
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
      clusterId: this.config.clusterId,
      source: "NOMAD",
      resourceType: "EVALUATION"
    });

    for (const latest of latestStates) {
      if (latest.state !== "BLOCKED" || currentBlockedKeys.has(latest.resourceKey)) continue;

      const fingerprint = createNomadFingerprint({
        clusterId: this.config.clusterId,
        type: "EVALUATION_BLOCKED",
        resourceType: "EVALUATION",
        resourceKey: latest.resourceKey
      });
      const resolved = await this.alerting.processRecovery({ fingerprint, detectedAt: observedAt });
      const recoverySnapshot = await this.monitoring.record({
        clusterId: this.config.clusterId,
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

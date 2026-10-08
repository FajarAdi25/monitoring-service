import type { NomadAllocation } from "./nomad.types";

export interface NomadAllocationLogicalIdentity {
  resourceKey: string;
  resourceName: string;
  namespace: string;
  jobId: string | null;
  taskGroup: string | null;
  slot: string | null;
}

/**
 * Nomad replaces a failed allocation with a new allocation ID. Therefore,
 * allocation ID cannot be used as the identity of the monitored workload.
 *
 * For standard service allocations Nomad keeps the allocation name stable,
 * e.g. front-end-sample.app-group[0]. The trailing index is the logical slot.
 *
 * System and sysbatch jobs run one allocation per node and all of them use
 * index [0], so `perNode` makes the node ID part of the identity instead.
 */
export function getNomadAllocationLogicalIdentity(
  allocation: NomadAllocation,
  options: { perNode?: boolean } = {}
): NomadAllocationLogicalIdentity {
  const namespace = normalizePart(allocation.Namespace) ?? "default";
  const jobId = normalizePart(allocation.JobID);
  const taskGroup = normalizePart(allocation.TaskGroup);
  const name = normalizePart(allocation.Name);
  const slot = extractAllocationSlot(name);
  const nodeId = normalizePart(allocation.NodeID);

  if (options.perNode && jobId && taskGroup && nodeId) {
    return {
      resourceKey: `${namespace}:${jobId}:${taskGroup}:${nodeId}`,
      resourceName: name ?? `${jobId}.${taskGroup}`,
      namespace,
      jobId,
      taskGroup,
      slot
    };
  }

  if (jobId && taskGroup && slot !== null) {
    return {
      resourceKey: `${namespace}:${jobId}:${taskGroup}:${slot}`,
      resourceName: name ?? `${jobId}.${taskGroup}[${slot}]`,
      namespace,
      jobId,
      taskGroup,
      slot
    };
  }

  if (name) {
    return {
      resourceKey: `${namespace}:${name}`,
      resourceName: name,
      namespace,
      jobId,
      taskGroup,
      slot
    };
  }

  return {
    resourceKey: `${namespace}:allocation:${allocation.ID}`,
    resourceName: allocation.ID,
    namespace,
    jobId,
    taskGroup,
    slot
  };
}

export function extractAllocationSlot(name?: string | null): string | null {
  const normalized = normalizePart(name);
  if (!normalized) return null;
  const match = normalized.match(/\[([^\]]+)\]$/);
  return match?.[1] ?? null;
}

function normalizePart(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

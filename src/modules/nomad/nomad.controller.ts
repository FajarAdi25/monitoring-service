import type { Request, Response } from "express";
import { NomadService } from "./nomad.service";
import { parseNomadClusterQuery } from "./nomad.validation";

type NodeParams = {
  nodeId: string;
};

type AllocationParams = {
  allocationId: string;
};

type JobParams = {
  jobId: string;
};

export class NomadController {
  constructor(private readonly service: NomadService) {}

  nodes = async (req: Request, res: Response): Promise<void> => {
    const clusterId = parseNomadClusterQuery(req.query as Record<string, unknown>);
    res.json({ success: true, data: await this.service.getNodes(clusterId) });
  };

  nodeDetail = async (req: Request<NodeParams>, res: Response): Promise<void> => {
    const clusterId = parseNomadClusterQuery(req.query as Record<string, unknown>);
    res.json({ success: true, data: await this.service.getNode(req.params.nodeId, clusterId) });
  };

  allocations = async (req: Request, res: Response): Promise<void> => {
    const clusterId = parseNomadClusterQuery(req.query as Record<string, unknown>);
    res.json({ success: true, data: await this.service.getAllocations(clusterId) });
  };

  failedAllocations = async (req: Request, res: Response): Promise<void> => {
    const clusterId = parseNomadClusterQuery(req.query as Record<string, unknown>);
    res.json({ success: true, data: await this.service.getFailedAllocations(clusterId) });
  };

  allocationDetail = async (req: Request<AllocationParams>, res: Response): Promise<void> => {
    const clusterId = parseNomadClusterQuery(req.query as Record<string, unknown>);
    res.json({ success: true, data: await this.service.getAllocation(req.params.allocationId, clusterId) });
  };

  jobSummary = async (req: Request<JobParams>, res: Response): Promise<void> => {
    const clusterId = parseNomadClusterQuery(req.query as Record<string, unknown>);
    res.json({ success: true, data: await this.service.getJobSummary(req.params.jobId, clusterId) });
  };

  blockedEvaluations = async (req: Request, res: Response): Promise<void> => {
    const clusterId = parseNomadClusterQuery(req.query as Record<string, unknown>);
    res.json({ success: true, data: await this.service.getBlockedEvaluations(clusterId) });
  };

  manualPull = async (req: Request, res: Response): Promise<void> => {
    const clusterId = parseNomadClusterQuery(req.query as Record<string, unknown>);
    res.json({ success: true, data: await this.service.pullOnce(clusterId) });
  };
}

import type { Request, Response } from "express";
import { NomadService } from "./nomad.service";

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

  nodes = async (_req: Request, res: Response): Promise<void> => {
    res.json({ success: true, data: await this.service.getNodes() });
  };

  nodeDetail = async (req: Request<NodeParams>, res: Response): Promise<void> => {
    res.json({ success: true, data: await this.service.getNode(req.params.nodeId) });
  };

  allocations = async (_req: Request, res: Response): Promise<void> => {
    res.json({ success: true, data: await this.service.getAllocations() });
  };

  failedAllocations = async (_req: Request, res: Response): Promise<void> => {
    res.json({ success: true, data: await this.service.getFailedAllocations() });
  };

  allocationDetail = async (req: Request<AllocationParams>, res: Response): Promise<void> => {
    res.json({ success: true, data: await this.service.getAllocation(req.params.allocationId) });
  };

  jobSummary = async (req: Request<JobParams>, res: Response): Promise<void> => {
    res.json({ success: true, data: await this.service.getJobSummary(req.params.jobId) });
  };

  blockedEvaluations = async (_req: Request, res: Response): Promise<void> => {
    res.json({ success: true, data: await this.service.getBlockedEvaluations() });
  };

  manualPull = async (_req: Request, res: Response): Promise<void> => {
    res.json({ success: true, data: await this.service.pullOnce() });
  };
}

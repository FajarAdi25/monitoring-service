import type { Request, Response } from "express";
import { ConsulService } from "./consul.service";
import {
  parseConsulClusterQuery,
  parseConsulDatacenterQuery,
  parseConsulHealthStateQuery
} from "./consul.validation";

export class ConsulController {
  constructor(private readonly service: ConsulService) {}

  datacenters = async (req: Request, res: Response): Promise<void> => {
    const query = req.query as Record<string, unknown>;
    res.json({ success: true, data: await this.service.getDatacenters(parseConsulClusterQuery(query)) });
  };

  health = async (req: Request, res: Response): Promise<void> => {
    const query = req.query as Record<string, unknown>;
    res.json({
      success: true,
      data: await this.service.getHealthChecks(
        parseConsulHealthStateQuery(query),
        parseConsulDatacenterQuery(query),
        parseConsulClusterQuery(query)
      )
    });
  };

  autopilot = async (req: Request, res: Response): Promise<void> => {
    const query = req.query as Record<string, unknown>;
    res.json({
      success: true,
      data: await this.service.getAutopilotHealth(parseConsulDatacenterQuery(query), parseConsulClusterQuery(query))
    });
  };

  manualPull = async (req: Request, res: Response): Promise<void> => {
    const clusterId = parseConsulClusterQuery(req.query as Record<string, unknown>);
    res.json({ success: true, data: await this.service.pullOnce(clusterId) });
  };
}

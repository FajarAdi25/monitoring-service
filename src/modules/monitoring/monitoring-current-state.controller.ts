import type { Request, Response } from "express";
import { MonitoringCurrentStateService } from "./monitoring-current-state.service";

export class MonitoringCurrentStateController {
  constructor(private readonly service: MonitoringCurrentStateService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const data = await this.service.list(req.query as Record<string, unknown>);
    res.json({ success: true, data });
  };
}

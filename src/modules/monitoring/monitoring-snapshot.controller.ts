import type { Request, Response } from "express";
import { MonitoringSnapshotService } from "./monitoring-snapshot.service";

export class MonitoringSnapshotController {
  constructor(private readonly service: MonitoringSnapshotService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const data = await this.service.list(req.query as Record<string, unknown>);
    res.json({ success: true, data });
  };
}

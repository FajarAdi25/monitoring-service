// Version: 2.3.0
import type { Request, Response } from "express";
import { SslMonitoringService } from "./ssl-monitoring.service";

export class SslMonitoringController {
  constructor(private readonly service: SslMonitoringService) {}

  list = async (_req: Request, res: Response): Promise<void> => {
    const data = await this.service.list();
    res.json({ success: true, data });
  };
}

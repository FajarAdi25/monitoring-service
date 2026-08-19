import type { Request, Response } from "express";
import { DashboardService } from "./dashboard.service";

export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  overview = async (req: Request, res: Response): Promise<void> => {
    res.json({ success: true, data: await this.service.overview(req.query as Record<string, unknown>) });
  };

  health = async (req: Request, res: Response): Promise<void> => {
    res.json({ success: true, data: await this.service.health(req.query as Record<string, unknown>) });
  };

  summary = async (req: Request, res: Response): Promise<void> => {
    res.json({ success: true, data: await this.service.summary(req.query as Record<string, unknown>) });
  };

  recent = async (req: Request, res: Response): Promise<void> => {
    res.json({ success: true, data: await this.service.recent(req.query as Record<string, unknown>) });
  };

  resolved = async (req: Request, res: Response): Promise<void> => {
    res.json({ success: true, data: await this.service.resolved(req.query as Record<string, unknown>) });
  };
}

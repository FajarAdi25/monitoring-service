import type { Request, Response } from "express";
import { IncidentService } from "./incident.service";
import { parseIncidentListFilters } from "./incident.validation";

type IncidentParams = {
  incidentId: string;
};

export class IncidentController {
  constructor(private readonly service: IncidentService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const data = await this.service.list(parseIncidentListFilters(req.query));
    res.json({ success: true, data });
  };

  detail = async (req: Request<IncidentParams>, res: Response): Promise<void> => {
    const data = await this.service.detail(req.params.incidentId);
    res.json({ success: true, data });
  };
}

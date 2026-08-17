import type { Request, Response } from "express";
import { IncidentService } from "./incident.service";
import { parseAcknowledgeBody, parseIncidentListFilters } from "./incident.validation";

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
    const data = await this.service.detail(req.params.incidentId, req.user);
    res.json({ success: true, data });
  };

  acknowledge = async (req: Request<IncidentParams>, res: Response): Promise<void> => {
    const input = parseAcknowledgeBody(req.body);
    const data = await this.service.acknowledge(req.params.incidentId, req.user, input.note);
    res.json({ success: true, data });
  };

  postpone = async (req: Request<IncidentParams>, res: Response): Promise<void> => {
    const data = await this.service.postpone(req.params.incidentId, req.user, req.body);
    res.json({ success: true, data });
  };
}

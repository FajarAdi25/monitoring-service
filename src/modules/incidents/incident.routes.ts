import { Router } from "express";
import { asyncHandler } from "../../common/middleware/async-handler";
import { IncidentController } from "./incident.controller";

export function createIncidentRouter(controller: IncidentController): Router {
  const router = Router();

  router.get("/", asyncHandler(controller.list));
  router.get("/:incidentId", asyncHandler(controller.detail));

  return router;
}

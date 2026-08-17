import { Router } from "express";
import { asyncHandler } from "../../common/middleware/async-handler";
import { requireAdmin } from "../../common/middleware/authorization.middleware";
import { NomadController } from "./nomad.controller";

export function createNomadRouter(controller: NomadController): Router {
  const router = Router();

  router.get("/nodes", asyncHandler(controller.nodes));
  router.get("/nodes/:nodeId", asyncHandler(controller.nodeDetail));
  router.get("/allocations/failed", asyncHandler(controller.failedAllocations));
  router.get("/allocations", asyncHandler(controller.allocations));
  router.get("/allocations/:allocationId", asyncHandler(controller.allocationDetail));
  router.get("/jobs/:jobId/summary", asyncHandler(controller.jobSummary));
  router.get("/evaluations/blocked", asyncHandler(controller.blockedEvaluations));
  router.post("/pull", requireAdmin, asyncHandler(controller.manualPull));

  return router;
}

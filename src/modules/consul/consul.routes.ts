import { Router } from "express";
import { asyncHandler } from "../../common/middleware/async-handler";
import { requireAdmin } from "../../common/middleware/authorization.middleware";
import { ConsulController } from "./consul.controller";

export function createConsulRouter(controller: ConsulController): Router {
  const router = Router();

  router.get("/datacenters", asyncHandler(controller.datacenters));
  router.get("/health", asyncHandler(controller.health));
  router.get("/autopilot", asyncHandler(controller.autopilot));
  router.post("/pull", requireAdmin, asyncHandler(controller.manualPull));

  return router;
}

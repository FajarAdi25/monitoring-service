import { Router } from "express";
import { asyncHandler } from "../../common/middleware/async-handler";
import { DashboardController } from "./dashboard.controller";

export function createDashboardRouter(controller: DashboardController): Router {
  const router = Router();

  router.get("/overview", asyncHandler(controller.overview));
  router.get("/health", asyncHandler(controller.health));
  router.get("/incidents/summary", asyncHandler(controller.summary));
  router.get("/incidents/recent", asyncHandler(controller.recent));
  router.get("/incidents/resolved", asyncHandler(controller.resolved));

  return router;
}

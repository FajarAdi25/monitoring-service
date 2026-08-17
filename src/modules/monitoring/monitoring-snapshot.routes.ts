import { Router } from "express";
import { asyncHandler } from "../../common/middleware/async-handler";
import { MonitoringCurrentStateController } from "./monitoring-current-state.controller";
import { MonitoringSnapshotController } from "./monitoring-snapshot.controller";

export function createMonitoringRouter(
  snapshotController: MonitoringSnapshotController,
  currentStateController: MonitoringCurrentStateController
): Router {
  const router = Router();
  router.get("/snapshots", asyncHandler(snapshotController.list));
  router.get("/current", asyncHandler(currentStateController.list));
  return router;
}

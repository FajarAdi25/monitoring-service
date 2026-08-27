// Version: 2.3.0
import { Router } from "express";
import { asyncHandler } from "../../common/middleware/async-handler";
import { MonitoringCurrentStateController } from "./monitoring-current-state.controller";
import { MonitoringSnapshotController } from "./monitoring-snapshot.controller";
import { SslMonitoringController } from "../ssl-certificate/ssl-monitoring.controller";

export function createMonitoringRouter(
  snapshotController: MonitoringSnapshotController,
  currentStateController: MonitoringCurrentStateController,
  sslMonitoringController: SslMonitoringController
): Router {
  const router = Router();
  router.get("/snapshots", asyncHandler(snapshotController.list));
  router.get("/current", asyncHandler(currentStateController.list));
  router.get("/ssl", asyncHandler(sslMonitoringController.list));
  return router;
}

// Version: 2.3.0
import express from "express";
import { AppDataSource } from "./database/data-source";
import { userMiddleware } from "./common/middleware/user.middleware";
import { errorMiddleware } from "./common/middleware/error.middleware";
import { notFoundMiddleware } from "./common/middleware/not-found.middleware";
import { ClusterRepository } from "./modules/clusters/cluster.repository";
import { IncidentRepository } from "./modules/incidents/incident.repository";
import { IncidentService } from "./modules/incidents/incident.service";
import { IncidentController } from "./modules/incidents/incident.controller";
import { createIncidentRouter } from "./modules/incidents/incident.routes";
import { DashboardService } from "./modules/dashboard/dashboard.service";
import { DashboardController } from "./modules/dashboard/dashboard.controller";
import { createDashboardRouter } from "./modules/dashboard/dashboard.routes";
import { MonitoringCurrentStateController } from "./modules/monitoring/monitoring-current-state.controller";
import { MonitoringCurrentStateRepository } from "./modules/monitoring/monitoring-current-state.repository";
import { MonitoringCurrentStateService } from "./modules/monitoring/monitoring-current-state.service";
import { MonitoringSnapshotRepository } from "./modules/monitoring/monitoring-snapshot.repository";
import { MonitoringSnapshotService } from "./modules/monitoring/monitoring-snapshot.service";
import { MonitoringSnapshotController } from "./modules/monitoring/monitoring-snapshot.controller";
import { createMonitoringRouter } from "./modules/monitoring/monitoring-snapshot.routes";
import { NomadController } from "./modules/nomad/nomad.controller";
import { createNomadRouter } from "./modules/nomad/nomad.routes";
import type { NomadService } from "./modules/nomad/nomad.service";
import { TelegramDummyWebhookController } from "./modules/webhooks/telegram-dummy.controller";
import { createWebhookRouter } from "./modules/webhooks/webhook.routes";
import { SslMonitoringRepository } from "./modules/ssl-certificate/ssl-monitoring.repository";
import { SslMonitoringService } from "./modules/ssl-certificate/ssl-monitoring.service";
import { SslMonitoringController } from "./modules/ssl-certificate/ssl-monitoring.controller";

export interface AppDependencies {
  nomadService: NomadService;
}

export function createApp(dependencies: AppDependencies) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(userMiddleware);

  const clusterRepository = new ClusterRepository(AppDataSource);
  const incidentRepository = new IncidentRepository(AppDataSource);
  const incidentService = new IncidentService(incidentRepository, clusterRepository);
  const incidentController = new IncidentController(incidentService);

  const snapshotRepository = new MonitoringSnapshotRepository(AppDataSource);
  const snapshotService = new MonitoringSnapshotService(snapshotRepository, clusterRepository);
  const snapshotController = new MonitoringSnapshotController(snapshotService);

  const currentStateRepository = new MonitoringCurrentStateRepository(AppDataSource);
  const currentStateService = new MonitoringCurrentStateService(currentStateRepository, clusterRepository);
  const currentStateController = new MonitoringCurrentStateController(currentStateService);

  const sslMonitoringRepository = new SslMonitoringRepository(AppDataSource);
  const sslMonitoringService = new SslMonitoringService(sslMonitoringRepository, clusterRepository);
  const sslMonitoringController = new SslMonitoringController(sslMonitoringService);

  const dashboardService = new DashboardService(incidentRepository, currentStateRepository, clusterRepository);
  const dashboardController = new DashboardController(dashboardService);

  const nomadController = new NomadController(dependencies.nomadService);
  const telegramDummyWebhookController = new TelegramDummyWebhookController();

  app.use("/api/v1/incidents", createIncidentRouter(incidentController));
  app.use("/api/v1/dashboard", createDashboardRouter(dashboardController));
  app.use(
    "/api/v1/monitoring",
    createMonitoringRouter(snapshotController, currentStateController, sslMonitoringController)
  );
  app.use("/api/v1/nomad", createNomadRouter(nomadController));
  app.use("/api/v1/webhooks", createWebhookRouter(telegramDummyWebhookController));

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);
  return app;
}

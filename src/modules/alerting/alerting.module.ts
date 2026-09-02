import type { DataSource } from "typeorm";
import { ClusterRepository } from "../clusters/cluster.repository";
import { IncidentRepository } from "../incidents/incident.repository";
import { IncidentService } from "../incidents/incident.service";
import { ConsoleAlertNotifier, HttpWebhookAlertNotifier } from "./alerting.notifier";
import { HttpIncidentWebhookNotifier } from "./incident-webhook.notifier";
import { AlertingService } from "./alerting.service";
import { AlertingWorker } from "./alerting.worker";

export interface AlertingModule {
  service: AlertingService;
  worker: AlertingWorker;
}

export interface AlertingModuleConfig {
  pollIntervalMs: number;
  openReminderIntervalMs: number;
  webhookUrl?: string;
  incidentWebhookUrl?: string;
}

export function createAlertingModule(
  dataSource: DataSource,
  config: AlertingModuleConfig
): AlertingModule {
  const clusterRepository = new ClusterRepository(dataSource);
  const incidentRepository = new IncidentRepository(dataSource);
  const incidentService = new IncidentService(incidentRepository, clusterRepository);
  const incidentWebhook = config.incidentWebhookUrl
    ? new HttpIncidentWebhookNotifier(
        clusterRepository,
        config.incidentWebhookUrl,
        config.incidentWebhookApiKey,
      )
    : undefined;

  const notifier = config.webhookUrl
    ? new HttpWebhookAlertNotifier(clusterRepository, config.webhookUrl)
    : new ConsoleAlertNotifier(clusterRepository);

  return {
    service: new AlertingService(
      incidentRepository,
      incidentService,
      notifier,
      incidentWebhook
    ),
    worker: new AlertingWorker(
      incidentRepository,
      notifier,
      config.pollIntervalMs,
      config.openReminderIntervalMs
    )
  };
}

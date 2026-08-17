import type { DataSource } from "typeorm";
import { IncidentRepository } from "../incidents/incident.repository";
import { IncidentService } from "../incidents/incident.service";
import { ConsoleAlertNotifier, HttpWebhookAlertNotifier } from "./alerting.notifier";
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
}

export function createAlertingModule(
  dataSource: DataSource,
  config: AlertingModuleConfig
): AlertingModule {
  const incidentRepository = new IncidentRepository(dataSource);
  const incidentService = new IncidentService(incidentRepository);
  const notifier = config.webhookUrl
    ? new HttpWebhookAlertNotifier(config.webhookUrl)
    : new ConsoleAlertNotifier();

  return {
    service: new AlertingService(
      incidentRepository,
      incidentService,
      notifier
    ),
    worker: new AlertingWorker(
      incidentRepository,
      notifier,
      config.pollIntervalMs,
      config.openReminderIntervalMs
    )
  };
}

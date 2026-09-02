import type { DataSource } from "typeorm";
import { ClusterRepository } from "../clusters/cluster.repository";
import { IncidentRepository } from "../incidents/incident.repository";
import { IncidentService } from "../incidents/incident.service";
import {
  ConsoleAlertNotifier,
  HttpWebhookAlertNotifier,
} from "./alerting.notifier";
import { HttpIncidentWebhookNotifier } from "./incident-webhook.notifier";
import { AlertingService } from "./alerting.service";
import { AlertingWorker } from "./alerting.worker";
import { RelayDeliveryRepository } from "./relay/relay-delivery.repository";

export interface AlertingModule {
  service: AlertingService;
  worker: AlertingWorker;
}

export interface AlertingModuleConfig {
  pollIntervalMs: number;
  openReminderIntervalMs: number;
  webhookUrl?: string;
  relayWebhookUrl?: string;
  relayWebhookApiKey?: string;
}

export function createAlertingModule(
  dataSource: DataSource,
  config: AlertingModuleConfig,
): AlertingModule {
  const clusterRepository = new ClusterRepository(dataSource);
  const incidentRepository = new IncidentRepository(dataSource);
  const incidentService = new IncidentService(
    incidentRepository,
    clusterRepository,
  );
  const relayDeliveryRepository = new RelayDeliveryRepository(dataSource);
  const relayWebhook = config.relayWebhookUrl
    ? new HttpIncidentWebhookNotifier(
        clusterRepository,
        config.relayWebhookUrl,
        config.relayWebhookApiKey,
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
      relayWebhook,
      relayDeliveryRepository,
    ),
    worker: new AlertingWorker(
      incidentRepository,
      notifier,
      config.pollIntervalMs,
      config.openReminderIntervalMs,
      relayWebhook,
      relayDeliveryRepository,
    ),
  };
}

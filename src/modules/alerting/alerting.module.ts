import type { DataSource } from "typeorm";
import { ClusterRepository } from "../clusters/cluster.repository";
import { IncidentRepository } from "../incidents/incident.repository";
import { IncidentService } from "../incidents/incident.service";
import { AlertDeliveryRepository } from "./alert-delivery.repository";
import { AlertDeliverySender } from "./alert-delivery.sender";
import {
  ConsoleAlertWebhookTransport,
  HttpAlertWebhookTransport,
  QueuedAlertNotifier,
} from "./alerting.notifier";
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
  webhookToken?: string;
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
  const deliveryRepository = new AlertDeliveryRepository(dataSource);

  const notifier = new QueuedAlertNotifier(clusterRepository, deliveryRepository);
  const transport = config.webhookUrl
    ? new HttpAlertWebhookTransport(config.webhookUrl, config.webhookToken)
    : new ConsoleAlertWebhookTransport();
  const sender = new AlertDeliverySender(deliveryRepository, transport);

  return {
    service: new AlertingService(
      incidentRepository,
      incidentService,
      notifier,
    ),
    worker: new AlertingWorker(
      incidentRepository,
      notifier,
      sender,
      config.pollIntervalMs,
      config.openReminderIntervalMs,
    ),
  };
}

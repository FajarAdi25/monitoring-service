import { createHash } from "node:crypto";
import { env } from "../config/env";
import { AppDataSource } from "../database/data-source";
import { createAlertingModule } from "../modules/alerting/alerting.module";
import { IncidentSeverity } from "../modules/incidents/incident.enums";

async function main(): Promise<void> {
  await AppDataSource.initialize();
  const alerting = createAlertingModule(AppDataSource, {
    pollIntervalMs: env.alerting.pollIntervalMs,
    openReminderIntervalMs: env.alerting.openReminderIntervalMs,
    webhookUrl: env.alerting.webhookUrl
  });

  const fingerprint = createHash("sha256")
    .update("demo:NOMAD:NODE_DOWN:node-demo")
    .digest("hex");

  const incident = await alerting.service.processFailure({
    clusterId: "1",
    source: "NOMAD",
    type: "NODE_DOWN",
    severity: IncidentSeverity.CRITICAL,
    resourceType: "NODE",
    resourceKey: "node-demo",
    resourceName: "nomad-client-demo",
    fingerprint,
    message: "Demo node is down"
  });

  console.log(`OPEN incident: ${incident.publicId}`);
  await alerting.worker.tick();
  console.log("Initial alert processed. OPEN reminders are scheduled every 1 minute.");

  await AppDataSource.destroy();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

import { createApp } from "./app";
import { env } from "./config/env";
import { AppDataSource } from "./database/data-source";
import { createAlertingModule } from "./modules/alerting/alerting.module";
import { createNomadModule } from "./modules/nomad/nomad.module";

async function bootstrap(): Promise<void> {
  await AppDataSource.initialize();

  const alerting = createAlertingModule(AppDataSource, {
    pollIntervalMs: env.alerting.pollIntervalMs,
    openReminderIntervalMs: env.alerting.openReminderIntervalMs,
    webhookUrl: env.alerting.webhookUrl
  });

  const nomad = createNomadModule(AppDataSource, alerting.service, {
    pullCron: env.nomad.pullCron,
    pullCronTimezone: env.nomad.pullCronTimezone,
    pullRunOnStart: env.nomad.pullRunOnStart,
    requestTimeoutMs: env.nomad.requestTimeoutMs,
    tlsRejectUnauthorized: env.nomad.tlsRejectUnauthorized,
    tlsCaFile: env.nomad.tlsCaFile
  });

  const app = createApp({ nomadService: nomad.service });
  const server = app.listen(env.appPort, () => {
    console.log(`Monitoring Service listening on port ${env.appPort}`);
    alerting.worker.start();
    console.log(`Alerting worker active; poll=${env.alerting.pollIntervalMs}ms; openReminder=${env.alerting.openReminderIntervalMs}ms`);

    if (env.nomad.enabled) {
      nomad.worker.start();
      console.log(`Nomad puller cron active; schedule=${env.nomad.pullCron}; timezone=${env.nomad.pullCronTimezone}`);
    } else {
      console.log("Nomad puller disabled by NOMAD_ENABLED=false");
    }
  });

  const shutdown = async (): Promise<void> => {
    alerting.worker.stop();
    nomad.worker.stop();
    server.close();
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  };

  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
}

bootstrap().catch(error => {
  console.error("Failed to start Monitoring Service", error);
  process.exit(1);
});

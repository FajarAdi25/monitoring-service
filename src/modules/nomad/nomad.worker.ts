import cron from "node-cron";
import { NomadService } from "./nomad.service";

export interface NomadPullWorkerConfig {
  cronExpression: string;
  timezone: string;
  runOnStart: boolean;
}

export class NomadPullWorker {
  private task: ReturnType<typeof cron.schedule> | null = null;
  private running = false;

  constructor(
    private readonly service: NomadService,
    private readonly config: NomadPullWorkerConfig
  ) {
    if (!cron.validate(config.cronExpression)) {
      throw new Error(`Invalid NOMAD_PULL_CRON expression: ${config.cronExpression}`);
    }
  }

  start(): void {
    if (this.task) return;

    this.task = cron.schedule(
      this.config.cronExpression,
      async () => {
        await this.tick("cron");
      },
      {
        name: "nomad-puller",
        timezone: this.config.timezone,
        noOverlap: true
      }
    );

    if (this.config.runOnStart) {
      void this.tick("startup");
    }
  }

  stop(): void {
    if (!this.task) return;
    this.task.stop();
    this.task = null;
  }

  async tick(trigger: "cron" | "startup" = "cron"): Promise<void> {
    if (this.running) {
      console.warn(`[NOMAD:PULL] skipped trigger=${trigger}; previous pull is still running`);
      return;
    }

    this.running = true;
    try {
      const result = await this.service.pullOnce();
      console.log(`[NOMAD:PULL] trigger=${trigger} ${JSON.stringify(result)}`);
    } catch (error) {
      console.error(`[NOMAD:PULL] trigger=${trigger} failed`, error);
    } finally {
      this.running = false;
    }
  }
}

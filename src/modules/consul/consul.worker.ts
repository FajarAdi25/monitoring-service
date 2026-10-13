import cron from "node-cron";
import { ConsulService } from "./consul.service";

export interface ConsulPullWorkerConfig {
  cronExpression: string;
  timezone: string;
  runOnStart: boolean;
}

export class ConsulPullWorker {
  private task: ReturnType<typeof cron.schedule> | null = null;
  private running = false;

  constructor(
    private readonly service: ConsulService,
    private readonly config: ConsulPullWorkerConfig
  ) {
    if (!cron.validate(config.cronExpression)) {
      throw new Error(`Invalid CONSUL_PULL_CRON expression: ${config.cronExpression}`);
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
        name: "consul-puller",
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
      console.warn(`[CONSUL:PULL] skipped trigger=${trigger}; previous pull is still running`);
      return;
    }

    this.running = true;
    try {
      const result = await this.service.pullOnce();
      console.log(`[CONSUL:PULL] trigger=${trigger} ${JSON.stringify(result)}`);
    } catch (error) {
      console.error(`[CONSUL:PULL] trigger=${trigger} failed`, error);
    } finally {
      this.running = false;
    }
  }
}

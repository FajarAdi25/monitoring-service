import { SslCertificateService } from "./ssl-certificate.service";

const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export class SslCertificateWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly service: SslCertificateService) {}

  start(): void {
    if (this.timer) return;

    void this.tick("startup");
    this.timer = setInterval(() => void this.tick("interval"), DAILY_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick(trigger: "startup" | "interval" = "interval"): Promise<void> {
    if (this.running) {
      console.warn(`[SSL:CERTIFICATE] skipped trigger=${trigger}; previous check is still running`);
      return;
    }

    this.running = true;
    try {
      const result = await this.service.checkOnce();
      console.log(`[SSL:CERTIFICATE] trigger=${trigger} ${JSON.stringify(result)}`);
    } catch (error) {
      console.error(`[SSL:CERTIFICATE] trigger=${trigger} failed`, error);
    } finally {
      this.running = false;
    }
  }
}

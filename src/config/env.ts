import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

function boolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

export type Role = "ADMIN" | "VIEWER";

const role = required("CURRENT_USER_ROLE", "ADMIN");
if (role !== "ADMIN" && role !== "VIEWER") {
  throw new Error("CURRENT_USER_ROLE must be ADMIN or VIEWER");
}

const appPort = Number(process.env.APP_PORT ?? 3000);

export const env = {
  appPort,
  alerting: {
    pollIntervalMs: Number(process.env.ALERTING_POLL_INTERVAL_MS ?? 1000),
    openReminderIntervalMs: Number(
      process.env.ALERT_REMINDER_INTERVAL_MS ?? 60000,
    ),
    webhookUrl: optional("ALERT_WEBHOOK_URL"),
    relayWebhookUrl: optional("RELAY_WEBHOOK_URL"),
    relayWebhookApiKey: optional("RELAY_WEBHOOK_API_KEY"),
  },
  telegramBot: {
    basicAuthUsername: required("MONITORING_BASIC_AUTH_USERNAME"),
    basicAuthPassword: required("MONITORING_BASIC_AUTH_PASSWORD"),
  },
  nomad: {
    enabled: boolean("NOMAD_ENABLED", true),
    pullCron: required("NOMAD_PULL_CRON", "*/15 * * * * *"),
    pullCronTimezone: required("NOMAD_PULL_CRON_TZ", "Asia/Jakarta"),
    pullRunOnStart: boolean("NOMAD_PULL_RUN_ON_START", true),
    requestTimeoutMs: Number(process.env.NOMAD_REQUEST_TIMEOUT_MS ?? 10000),
    tlsRejectUnauthorized: boolean("NOMAD_TLS_REJECT_UNAUTHORIZED", true),
    tlsCaFile: optional("NOMAD_TLS_CA_FILE"),
  },
  db: {
    host: required("DB_HOST", "127.0.0.1"),
    port: Number(process.env.DB_PORT ?? 3306),
    username: required("DB_USERNAME", "monitoring"),
    password: required("DB_PASSWORD", "monitoring"),
    database: required("DB_NAME", "monitoring"),
  },
  user: {
    id: required("CURRENT_USER_ID", "1"),
    name: required("CURRENT_USER_NAME", "Infrastructure Admin"),
    role: role as Role,
  },
};

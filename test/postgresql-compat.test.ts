// Version: 2.6.0
import assert from "node:assert/strict";
import test from "node:test";
import type { DataSource } from "typeorm";
import { telegramUserMiddleware } from "../src/common/middleware/telegram-user.middleware";
import { MonitoringSnapshotRepository } from "../src/modules/monitoring/monitoring-snapshot.repository";

function runTelegramUserMiddleware(userId: unknown): unknown {
  let forwarded: unknown;
  telegramUserMiddleware(
    { body: { user: { id: userId, name: "Operator" } } } as never,
    {} as never,
    ((error?: unknown) => {
      forwarded = error;
    }) as never,
  );
  return forwarded;
}

test("rejects Telegram user ids above PostgreSQL signed BIGINT maximum", () => {
  const error = runTelegramUserMiddleware("9223372036854775808");
  assert.ok(error instanceof Error);
});

test("accepts PostgreSQL signed BIGINT maximum Telegram user id", () => {
  const error = runTelegramUserMiddleware("9223372036854775807");
  assert.equal(error, undefined);
});

test("monitoring snapshot raw query uses PostgreSQL positional parameters and preserves resourceKey alias", async () => {
  let capturedSql = "";
  let capturedParams: unknown[] = [];

  const fakeRepository = {
    query: async (sql: string, params: unknown[]) => {
      capturedSql = sql;
      capturedParams = params;
      return [{ resourceKey: "node-1", state: "READY" }];
    },
  };
  const fakeDataSource = {
    getRepository: () => fakeRepository,
  } as unknown as DataSource;

  const repository = new MonitoringSnapshotRepository(fakeDataSource);
  const result = await repository.latestStates({
    clusterId: "1",
    source: "NOMAD",
    resourceType: "NODE",
  });

  assert.match(capturedSql, /cluster_id = \$1 AND source = \$2 AND resource_type = \$3/);
  assert.match(capturedSql, /AS "resourceKey"/);
  assert.deepEqual(capturedParams, ["1", "NOMAD", "NODE"]);
  assert.deepEqual(result, [{ resourceKey: "node-1", state: "READY" }]);
});

test("TypeORM datasource is PostgreSQL and defaults to port 5432", async () => {
  process.env.MONITORING_BASIC_AUTH_USERNAME = "test";
  process.env.MONITORING_BASIC_AUTH_PASSWORD = "test";
  delete process.env.DB_PORT;

  const [{ AppDataSource }, { env }] = await Promise.all([
    import("../src/database/data-source"),
    import("../src/config/env"),
  ]);

  assert.equal(AppDataSource.options.type, "postgres");
  assert.equal(env.db.port, 5432);
  assert.equal(AppDataSource.migrations.length, 1);
});

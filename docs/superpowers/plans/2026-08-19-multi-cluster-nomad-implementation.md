# Multi-Cluster Nomad Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Monitoring Service from the v1.9.6 single-cluster Nomad configuration to v2.0.0 database-driven multi-cluster monitoring for every cluster registered in MySQL, while enriching existing APIs and incident broadcasts with approved cluster metadata.

**Architecture:** MySQL `clusters` rows become the source of truth for Nomad URL, token, and user-visible cluster metadata. `NomadService` resolves cluster rows per operation and creates clients dynamically from DB connection settings plus global TLS/timeout configuration; existing monitoring/incident tables remain cluster-isolated by `clusterId`. Existing APIs keep their envelopes and fields, with optional `cluster` scoping and bulk cluster-metadata enrichment; webhook serialization resolves metadata by `incident.clusterId` without exposing URL/token.

**Tech Stack:** Node.js 22, TypeScript 5.8, Express 5, TypeORM 0.3, MySQL 8-compatible SQL, `node-cron`, native `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-19-multi-cluster-nomad-design.md`

## Global Constraints

- Baseline artifact is version `1.9.6`; implementation target is exactly `2.0.0`.
- Start execution from the current v1.9.6 artifact state, including its pre-existing local baseline differences; do not reset the project to bare Git HEAD.
- `clusters` is the source of truth for Nomad `url`, `token`, `clusterName`, `site`, `appName`, and `env`.
- All rows in `clusters` are monitored; do not add `enabled`, cluster CRUD APIs, per-cluster cron, per-cluster TLS configuration, or foreign keys to existing incident/monitoring tables.
- `ClusterEnvironment` values are exactly `PRODUCTION | PREPRODUCTION`.
- The `clusters` migration creates schema only and must insert zero cluster rows; production cluster data is provisioned manually in MySQL.
- EAST/WEST values are test-only examples, never runtime defaults; implementation must support any number of rows in `clusters`.
- `clusters.token` and `clusters.url` are internal only and must never be serialized by existing API or webhook responses.
- `NOMAD_BASE_URL`, `NOMAD_TOKEN`, and `NOMAD_CLUSTER_ID` must no longer be consumed by runtime configuration in v2.0.0.
- Keep `NOMAD_ENABLED`, cron, timeout, and TLS settings environment-driven.
- Query `cluster` remains optional: present means one cluster; absent means all clusters for Nomad API operations.
- Unscoped Nomad detail lookups return 404 on zero matches and 409 on multiple matches; never choose an arbitrary cluster.
- All-cluster Nomad read APIs fail the request if any selected upstream read fails; only pull operations have per-cluster partial-success outcomes.
- Scheduled/manual all-cluster pull must continue processing remaining clusters after one cluster fails.
- Existing incident lifecycle, ACK/POSTPONE action behavior, reminder behavior, and response shapes remain unchanged except for the approved metadata enrichment.
- Webhook adds exactly `clusterName`, `site`, `appName`, `env`; do not add `clusterId`, `url`, or `token` to the webhook.
- Use native `node:test`; introduce no new testing framework or runtime dependency.

## File Map

**Create**

- `src/modules/clusters/cluster.enums.ts` — `ClusterEnvironment` enum.
- `src/modules/clusters/cluster.entity.ts` — TypeORM `clusters` mapping.
- `src/modules/clusters/cluster.types.ts` — internal metadata/repository contracts and metadata serialization helpers.
- `src/modules/clusters/cluster.repository.ts` — ordered cluster lookup and bulk metadata lookup.
- `src/database/migrations/1786680900000-CreateClusters.ts` — create/revert `clusters`; no seed data.
- `src/modules/nomad/nomad.validation.ts` — parse optional `cluster` query.
- `tests/cluster.metadata.test.ts` — metadata secrecy regression.
- `tests/test-fixtures.ts` — reusable dummy two-cluster fixtures and an in-memory `ClusterRepositoryPort` fake for regression tests; fixtures are not production defaults.
- `tests/nomad.client.test.ts` — detail-404 transport regression.
- `tests/nomad.multi-cluster.test.ts` — scoped/all-cluster reads, detail ambiguity, pull isolation, cluster propagation.
- `tests/nomad.controller.test.ts` — query parser/controller forwarding regression.
- `tests/monitoring.cluster-metadata.test.ts` — monitoring enrichment and one bulk lookup per result set.
- `tests/incident-dashboard.cluster-metadata.test.ts` — incident/dashboard incident metadata enrichment.
- `tests/dashboard.cluster-filter.test.ts` — dashboard summary cluster filter propagation.

**Modify**

- `src/database/data-source.ts`
- `src/config/env.ts`
- `src/server.ts`
- `src/app.ts`
- `src/modules/nomad/nomad.client.ts`
- `src/modules/nomad/nomad.types.ts`
- `src/modules/nomad/nomad.service.ts`
- `src/modules/nomad/nomad.module.ts`
- `src/modules/nomad/nomad.controller.ts`
- `src/modules/incidents/incident.mapper.ts`
- `src/modules/incidents/incident.service.ts`
- `src/modules/incidents/incident.repository.ts`
- `src/modules/monitoring/monitoring-current-state.service.ts`
- `src/modules/monitoring/monitoring-snapshot.service.ts`
- `src/modules/dashboard/dashboard.service.ts`
- `src/modules/dashboard/dashboard.controller.ts`
- `src/modules/alerting/alerting.notifier.ts`
- `src/modules/alerting/alerting.module.ts`
- `tests/alerting.notifier.test.ts`
- `.env.example`
- `.env.docker.dev.example`
- `.env.docker.local.example`
- `docker-compose.yml`
- `compose.local.yml`
- `compose.dev.yml`
- `package.json`
- `package-lock.json`
- `README.md`
- `CHANGELOG.md`
- `docs/NOMAD_PULLER.md`
- `docs/DASHBOARD_API.md`
- `docs/RESOLVED_WEBHOOK.md`
- `docs/DOCKER_DEPLOYMENT.md`

---

### Task 1: Add the cluster registry persistence layer

**Files:**
- Create: `src/modules/clusters/cluster.enums.ts`
- Create: `src/modules/clusters/cluster.entity.ts`
- Create: `src/modules/clusters/cluster.types.ts`
- Create: `src/modules/clusters/cluster.repository.ts`
- Create: `src/database/migrations/1786680900000-CreateClusters.ts`
- Modify: `src/database/data-source.ts`
- Test: `tests/cluster.metadata.test.ts`
- Create: `tests/test-fixtures.ts`

**Interfaces:**
- Produces `ClusterEnvironment.PRODUCTION` and `ClusterEnvironment.PREPRODUCTION`.
- Produces `ClusterEntity` with `clusterId`, `url`, `clusterName`, `site`, `appName`, `env`, `token`, `createdAt`, `updatedAt`.
- Produces `ClusterMetadata` with only `clusterId`, `clusterName`, `site`, `appName`, `env`.
- Produces `ClusterRepositoryPort` with `findAll()`, `findById()`, `findMetadataById()`, `findMetadataByIds()`.
- Produces `toClusterMetadata()` and `serializeClusterId()` for controlled serialization.

- [ ] **Step 1: Write the failing metadata-secrecy test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { ClusterEnvironment } from "../src/modules/clusters/cluster.enums";
import type { ClusterEntity } from "../src/modules/clusters/cluster.entity";
import { toClusterMetadata } from "../src/modules/clusters/cluster.types";

test("cluster metadata excludes Nomad URL and token", () => {
  const cluster = {
    clusterId: "1",
    url: "https://10.11.39.32:4646",
    clusterName: "Cluster EAST",
    site: "cawang",
    appName: "Nomad East Lab App",
    env: ClusterEnvironment.PRODUCTION,
    token: "f61f7a1e-57e6-fe85-90d8-e94fd311b298",
    createdAt: new Date("2026-08-19T00:00:00.000Z"),
    updatedAt: new Date("2026-08-19T00:00:00.000Z")
  } as ClusterEntity;

  const metadata = toClusterMetadata(cluster);

  assert.deepEqual(metadata, {
    clusterId: "1",
    clusterName: "Cluster EAST",
    site: "cawang",
    appName: "Nomad East Lab App",
    env: ClusterEnvironment.PRODUCTION
  });
  assert.equal("url" in metadata, false);
  assert.equal("token" in metadata, false);
});
```

- [ ] **Step 2: Run the test and verify RED because the cluster module does not exist yet**

```bash
rm -rf .tmp-test
node node_modules/typescript/bin/tsc --target ES2022 --module CommonJS --moduleResolution Node --strict --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --skipLibCheck --outDir .tmp-test --rootDir . tests/cluster.metadata.test.ts
```

Expected: TypeScript fails with missing `src/modules/clusters/*` modules.

- [ ] **Step 3: Implement the enum, entity, metadata contract, and repository port**

`src/modules/clusters/cluster.enums.ts`:

```ts
export enum ClusterEnvironment {
  PRODUCTION = "PRODUCTION",
  PREPRODUCTION = "PREPRODUCTION"
}
```

`src/modules/clusters/cluster.types.ts`:

```ts
import type { ClusterEntity } from "./cluster.entity";
import type { ClusterEnvironment } from "./cluster.enums";

export interface ClusterMetadata {
  clusterId: string;
  clusterName: string;
  site: string;
  appName: string;
  env: ClusterEnvironment;
}

export interface ClusterRepositoryPort {
  findAll(): Promise<ClusterEntity[]>;
  findById(clusterId: string): Promise<ClusterEntity | null>;
  findMetadataById(clusterId: string): Promise<ClusterMetadata | null>;
  findMetadataByIds(clusterIds: readonly string[]): Promise<Map<string, ClusterMetadata>>;
}

export function toClusterMetadata(cluster: ClusterEntity): ClusterMetadata {
  return {
    clusterId: cluster.clusterId,
    clusterName: cluster.clusterName,
    site: cluster.site,
    appName: cluster.appName,
    env: cluster.env
  };
}

export function serializeClusterId(clusterId: string): string | number {
  const numeric = Number(clusterId);
  return Number.isSafeInteger(numeric) ? numeric : clusterId;
}
```

`src/modules/clusters/cluster.entity.ts` must map the approved schema exactly:

```ts
@Entity({ name: "clusters" })
export class ClusterEntity {
  @PrimaryColumn({ name: "cluster_id", type: "bigint", unsigned: true })
  clusterId!: string;

  @Column({ type: "varchar", length: 512 })
  url!: string;

  @Column({ name: "cluster_name", type: "varchar", length: 255 })
  clusterName!: string;

  @Column({ type: "varchar", length: 255 })
  site!: string;

  @Column({ name: "app_name", type: "varchar", length: 255 })
  appName!: string;

  @Column({ type: "enum", enum: ClusterEnvironment })
  env!: ClusterEnvironment;

  @Column({ type: "varchar", length: 512 })
  token!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamp", precision: 3 })
  createdAt!: Timestamp;

  @UpdateDateColumn({ name: "updated_at", type: "timestamp", precision: 3 })
  updatedAt!: Timestamp;
}
```

`ClusterRepository.findAll()` must order by `clusterId ASC`. `findMetadataByIds()` must de-duplicate IDs, issue one TypeORM `In(...)` query, and return a `Map<string, ClusterMetadata>` created with `toClusterMetadata()`.

- [ ] **Step 4: Implement the schema-only migration**

The migration `up()` must execute SQL equivalent to:

```sql
CREATE TABLE clusters (
  cluster_id BIGINT UNSIGNED NOT NULL,
  url VARCHAR(512) NOT NULL,
  cluster_name VARCHAR(255) NOT NULL,
  site VARCHAR(255) NOT NULL,
  app_name VARCHAR(255) NOT NULL,
  env ENUM('PRODUCTION','PREPRODUCTION') NOT NULL,
  token VARCHAR(512) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (cluster_id)
) ENGINE=InnoDB;
```

Do **not** add any `INSERT INTO clusters` statement to the migration. A clean database must have zero rows in `clusters` immediately after migration. Production rows are inserted manually by operations.

The migration `down()` must execute:

```sql
DROP TABLE clusters;
```

Register both `ClusterEntity` and `CreateClusters1786680900000` in `src/database/data-source.ts`.

- [ ] **Step 5: Add reusable test-only dummy cluster fixtures**

Create `tests/test-fixtures.ts` with two concrete dummy cluster fixtures and an in-memory `ClusterRepositoryPort` implementation. These values exist only in test code and must never be imported by production modules:

```ts
import { ClusterEnvironment } from "../src/modules/clusters/cluster.enums";
import type { ClusterEntity } from "../src/modules/clusters/cluster.entity";
import type { ClusterRepositoryPort } from "../src/modules/clusters/cluster.types";
import { toClusterMetadata } from "../src/modules/clusters/cluster.types";

export const eastCluster = {
  clusterId: "1",
  url: "https://10.11.39.32:4646",
  clusterName: "Cluster EAST",
  site: "cawang",
  appName: "Nomad East Lab App",
  env: ClusterEnvironment.PRODUCTION,
  token: "f61f7a1e-57e6-fe85-90d8-e94fd311b298",
  createdAt: new Date("2026-08-19T00:00:00.000Z"),
  updatedAt: new Date("2026-08-19T00:00:00.000Z")
} as ClusterEntity;

export const westCluster = {
  clusterId: "2",
  url: "https://10.11.39.40:4646",
  clusterName: "Cluster WEST",
  site: "tebet",
  appName: "Nomad West Lab App",
  env: ClusterEnvironment.PRODUCTION,
  token: "f61f7a1e-57e6-fe85-90d8-e94fd311b298",
  createdAt: new Date("2026-08-19T00:00:00.000Z"),
  updatedAt: new Date("2026-08-19T00:00:00.000Z")
} as ClusterEntity;

export function fakeClusterRepository(input: {
  clusters?: ClusterEntity[];
  onBulkLookup?: () => void;
} = {}): ClusterRepositoryPort {
  const clusters = input.clusters ?? [eastCluster, westCluster];
  return {
    async findAll() {
      return [...clusters].sort((a, b) => Number(a.clusterId) - Number(b.clusterId));
    },
    async findById(clusterId: string) {
      return clusters.find(cluster => cluster.clusterId === clusterId) ?? null;
    },
    async findMetadataById(clusterId: string) {
      const cluster = clusters.find(item => item.clusterId === clusterId);
      return cluster ? toClusterMetadata(cluster) : null;
    },
    async findMetadataByIds(clusterIds: readonly string[]) {
      input.onBulkLookup?.();
      const wanted = new Set(clusterIds);
      return new Map(
        clusters
          .filter(cluster => wanted.has(cluster.clusterId))
          .map(cluster => [cluster.clusterId, toClusterMetadata(cluster)])
      );
    }
  };
}
```

- [ ] **Step 6: Compile and run the metadata test**

```bash
rm -rf .tmp-test
node node_modules/typescript/bin/tsc --target ES2022 --module CommonJS --moduleResolution Node --strict --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --skipLibCheck --outDir .tmp-test --rootDir . tests/cluster.metadata.test.ts
node --test .tmp-test/tests/cluster.metadata.test.js
npm run build
```

Expected: test PASS and build exits 0.

- [ ] **Step 7: Commit the persistence layer**

```bash
git add src/modules/clusters src/database/data-source.ts src/database/migrations/1786680900000-CreateClusters.ts tests/cluster.metadata.test.ts tests/test-fixtures.ts
git commit -m "feat: add cluster registry persistence"
```

---

### Task 2: Make Nomad detail 404 distinguishable and define injectable client contracts

**Files:**
- Modify: `src/modules/nomad/nomad.client.ts`
- Modify: `src/modules/nomad/nomad.types.ts`
- Test: `tests/nomad.client.test.ts`

**Interfaces:**
- Produces `NomadClientPort` containing the existing seven read methods.
- Produces `NomadClientFactory = (cluster: ClusterEntity) => NomadClientPort`.
- Detail methods convert an upstream HTTP 404 to `AppError` status 404 with code `NOMAD_RESOURCE_NOT_FOUND`.
- List/read transport failures other than detail 404 retain current timeout/upstream/unreachable semantics.

- [ ] **Step 1: Write a failing test using a native local HTTP server**

```ts
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { AppError } from "../src/common/errors/app-error";
import { NomadClient } from "../src/modules/nomad/nomad.client";

test("Nomad detail 404 becomes NOMAD_RESOURCE_NOT_FOUND", async () => {
  const server = http.createServer((_req, res) => {
    res.statusCode = 404;
    res.end("missing");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const client = new NomadClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      requestTimeoutMs: 1000,
      tlsRejectUnauthorized: true
    });

    await assert.rejects(
      client.getNode("missing-node"),
      error => error instanceof AppError
        && error.statusCode === 404
        && error.code === "NOMAD_RESOURCE_NOT_FOUND"
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
```

- [ ] **Step 2: Run the test and verify RED**

```bash
rm -rf .tmp-test
node node_modules/typescript/bin/tsc --target ES2022 --module CommonJS --moduleResolution Node --strict --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --skipLibCheck --outDir .tmp-test --rootDir . tests/nomad.client.test.ts
node --test .tmp-test/tests/nomad.client.test.js
```

Expected: assertion fails because current 404 is `NOMAD_UPSTREAM_ERROR` with status 502.

- [ ] **Step 3: Add detail-aware error handling without changing list semantics**

Change the internal getter to accept an explicit option:

```ts
interface NomadGetOptions {
  notFoundAsResource?: boolean;
}

private async get<T>(
  path: string,
  query?: Record<string, string>,
  options: NomadGetOptions = {}
): Promise<T>
```

Pass `{ notFoundAsResource: true }` only from:

```ts
getNode(nodeId: string)
getAllocation(allocationId: string)
getJobSummary(jobId: string)
```

Pass `options` from `get()` into `readResponse(url, response, options)` and change the helper signature to:

```ts
private async readResponse<T>(
  url: URL,
  response: IncomingMessage,
  options: NomadGetOptions
): Promise<T>
```

Before generic non-2xx handling in `readResponse`:

```ts
if (status === 404 && options.notFoundAsResource) {
  throw new AppError(
    404,
    "NOMAD_RESOURCE_NOT_FOUND",
    `Nomad resource was not found for GET ${url.pathname}${url.search}.`
  );
}
```

Change config-validation messages from environment-specific wording to DB-neutral wording:

```ts
"Nomad cluster URL must be a valid URL including http:// or https://."
`Unsupported Nomad cluster URL protocol: ${url.protocol}`
```

Add to `nomad.types.ts`:

```ts
export interface NomadClientPort {
  getNodes(): Promise<NomadNode[]>;
  getNode(nodeId: string): Promise<NomadNode>;
  getAllocations(): Promise<NomadAllocation[]>;
  getFailedAllocations(): Promise<NomadAllocation[]>;
  getAllocation(allocationId: string): Promise<NomadAllocation>;
  getJobSummary(jobId: string): Promise<Record<string, unknown>>;
  getBlockedEvaluations(): Promise<NomadEvaluation[]>;
}

export type NomadClientFactory = (cluster: ClusterEntity) => NomadClientPort;
```

- [ ] **Step 4: Run the client test and build**

```bash
rm -rf .tmp-test
node node_modules/typescript/bin/tsc --target ES2022 --module CommonJS --moduleResolution Node --strict --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --skipLibCheck --outDir .tmp-test --rootDir . tests/nomad.client.test.ts
node --test .tmp-test/tests/nomad.client.test.js
npm run build
```

Expected: test PASS and build exits 0.

- [ ] **Step 5: Commit the transport contract**

```bash
git add src/modules/nomad/nomad.client.ts src/modules/nomad/nomad.types.ts tests/nomad.client.test.ts
git commit -m "refactor: make Nomad client cluster-aware"
```

---

### Task 3: Refactor NomadService and puller to dynamic multi-cluster execution

**Files:**
- Modify: `src/modules/nomad/nomad.service.ts`
- Modify: `src/modules/nomad/nomad.module.ts`
- Modify: `src/modules/nomad/nomad.types.ts`
- Modify: `src/config/env.ts`
- Modify: `src/server.ts`
- Test: `tests/nomad.multi-cluster.test.ts`

**Interfaces:**
- `NomadService` consumes `ClusterRepositoryPort`, `NomadClientFactory`, `MonitoringObservationService`, `AlertingService`.
- `getNodes/getAllocations/getFailedAllocations/getBlockedEvaluations(clusterId?)` return one-cluster or flattened all-cluster results with top-level metadata.
- `getNode/getAllocation/getJobSummary(id, clusterId?)` implement scoped lookup or unscoped 0/1/many matching rules.
- `pullOnce(clusterId?, now?)` returns scoped `NomadPullResult + cluster metadata` or all-cluster `NomadPullOutcome[]`.
- `pullCluster(cluster, now)` is the only function that executes monitoring observations for one cluster.

- [ ] **Step 1: Write concrete test helpers and RED tests for scoped/all-cluster reads and detail resolution**

At the top of `tests/nomad.multi-cluster.test.ts`, import `eastCluster`, `westCluster`, and `fakeClusterRepository` from `tests/test-fixtures.ts`, then define the fake client and service factory exactly enough to exercise real `NomadService` behavior:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/common/errors/app-error";
import type { AlertingService } from "../src/modules/alerting/alerting.service";
import type { FailureSignal } from "../src/modules/alerting/alerting.types";
import type { MonitoringObservationService } from "../src/modules/monitoring/monitoring-observation.service";
import { NomadService } from "../src/modules/nomad/nomad.service";
import type {
  NomadAllocation,
  NomadClientPort,
  NomadEvaluation,
  NomadNode
} from "../src/modules/nomad/nomad.types";
import { eastCluster, fakeClusterRepository, westCluster } from "./test-fixtures";

type ClientBehavior = {
  nodes?: NomadNode[] | Error;
  nodeDetail?: NomadNode | Error;
  allocations?: NomadAllocation[] | Error;
  allocationDetail?: NomadAllocation | Error;
  jobSummary?: Record<string, unknown> | Error;
  blockedEvaluations?: NomadEvaluation[] | Error;
};

async function resolved<T>(value: T | Error | undefined, fallback: T): Promise<T> {
  if (value instanceof Error) throw value;
  return value ?? fallback;
}

async function detail<T>(value: T | Error | undefined): Promise<T> {
  if (value instanceof Error) throw value;
  if (value !== undefined) return value;
  throw new AppError(404, "NOMAD_RESOURCE_NOT_FOUND", "missing");
}

function fakeClient(behavior: ClientBehavior = {}): NomadClientPort {
  return {
    getNodes: () => resolved(behavior.nodes, []),
    getNode: () => detail(behavior.nodeDetail),
    getAllocations: () => resolved(behavior.allocations, []),
    getFailedAllocations: () => resolved(behavior.allocations, []),
    getAllocation: () => detail(behavior.allocationDetail),
    getJobSummary: () => detail(behavior.jobSummary),
    getBlockedEvaluations: () => resolved(behavior.blockedEvaluations, [])
  };
}

function makeService(input: { east?: ClientBehavior; west?: ClientBehavior }) {
  const monitoringCalls: Array<{ clusterId: string }> = [];
  const failureSignals: FailureSignal[] = [];

  const monitoring = {
    async record(value: { clusterId: string }) {
      monitoringCalls.push({ clusterId: value.clusterId });
      return { changed: false };
    },
    async latestStates() {
      return [];
    }
  } as unknown as MonitoringObservationService;

  const alerting = {
    async processFailure(signal: FailureSignal) {
      failureSignals.push(signal);
      return undefined;
    },
    async processRecovery() {
      return null;
    }
  } as unknown as AlertingService;

  const clientFactory = (cluster: typeof eastCluster): NomadClientPort =>
    cluster.clusterId === "1" ? fakeClient(input.east) : fakeClient(input.west);

  return {
    service: new NomadService(
      fakeClusterRepository({ clusters: [eastCluster, westCluster] }),
      clientFactory,
      monitoring,
      alerting
    ),
    monitoringCalls,
    failureSignals
  };
}
```

Then add these tests:

```ts
test("scoped node list uses only the requested cluster and enriches metadata", async () => {
  const { service } = makeService({
    east: { nodes: [{ ID: "east-node", Name: "east", Status: "ready" }] },
    west: { nodes: [{ ID: "west-node", Name: "west", Status: "ready" }] }
  });

  const result = await service.getNodes("1");

  assert.equal(result.length, 1);
  assert.equal(result[0].ID, "east-node");
  assert.equal(result[0].clusterId, 1);
  assert.equal(result[0].clusterName, "Cluster EAST");
  assert.equal(result[0].site, "cawang");
  assert.equal(result[0].appName, "Nomad East Lab App");
  assert.equal(result[0].env, "PRODUCTION");
});

test("unscoped node list combines all cluster results", async () => {
  const { service } = makeService({
    east: { nodes: [{ ID: "east-node", Name: "east", Status: "ready" }] },
    west: { nodes: [{ ID: "west-node", Name: "west", Status: "ready" }] }
  });

  const result = await service.getNodes();
  assert.deepEqual(result.map(item => [item.ID, item.clusterId]), [
    ["east-node", 1],
    ["west-node", 2]
  ]);
});

test("unknown explicit cluster returns CLUSTER_NOT_FOUND", async () => {
  const { service } = makeService({});
  await assert.rejects(
    service.getNodes("99"),
    error => error instanceof AppError
      && error.statusCode === 404
      && error.code === "CLUSTER_NOT_FOUND"
  );
});

test("unscoped detail returns its unique cluster match", async () => {
  const { service } = makeService({
    east: { nodeDetail: new AppError(404, "NOMAD_RESOURCE_NOT_FOUND", "missing") },
    west: { nodeDetail: { ID: "shared-id", Name: "west", Status: "ready" } }
  });
  const result = await service.getNode("shared-id");
  assert.equal(result.clusterId, 2);
});

test("unscoped detail returns NOMAD_RESOURCE_NOT_FOUND when no cluster matches", async () => {
  const { service } = makeService({
    east: { nodeDetail: new AppError(404, "NOMAD_RESOURCE_NOT_FOUND", "missing") },
    west: { nodeDetail: new AppError(404, "NOMAD_RESOURCE_NOT_FOUND", "missing") }
  });
  await assert.rejects(
    service.getNode("missing"),
    error => error instanceof AppError && error.code === "NOMAD_RESOURCE_NOT_FOUND"
  );
});

test("unscoped detail returns NOMAD_RESOURCE_CLUSTER_AMBIGUOUS on multiple matches", async () => {
  const { service } = makeService({
    east: { nodeDetail: { ID: "shared-id", Name: "east", Status: "ready" } },
    west: { nodeDetail: { ID: "shared-id", Name: "west", Status: "ready" } }
  });
  await assert.rejects(
    service.getNode("shared-id"),
    error => error instanceof AppError
      && error.statusCode === 409
      && error.code === "NOMAD_RESOURCE_CLUSTER_AMBIGUOUS"
  );
});

test("all-cluster node list fails instead of returning a partial array", async () => {
  const { service } = makeService({
    east: { nodes: new AppError(502, "NOMAD_UPSTREAM_ERROR", "east failed") },
    west: { nodes: [{ ID: "west-node", Name: "west", Status: "ready" }] }
  });
  await assert.rejects(
    service.getNodes(),
    error => error instanceof AppError && error.code === "NOMAD_UPSTREAM_ERROR"
  );
});
```

- [ ] **Step 2: Write RED pull-isolation and cluster-propagation tests using the same concrete factory**

Use the existing `makeService()` factory and configure the failed cluster's `nodes` read as an `AppError`, while the successful cluster returns empty arrays:

```ts
for (const failedClusterId of ["1", "2"] as const) {
  test(`all-cluster pull continues when cluster ${failedClusterId} fails`, async () => {
    const failed = { nodes: new AppError(502, "NOMAD_UPSTREAM_ERROR", "failed") };
    const healthy = { nodes: [], allocations: [], blockedEvaluations: [] };
    const { service } = makeService(
      failedClusterId === "1"
        ? { east: failed, west: healthy }
        : { east: healthy, west: failed }
    );

    const outcomes = await service.pullOnce(undefined, new Date("2026-08-19T08:00:00.000Z"));
    assert.ok(Array.isArray(outcomes));
    assert.equal(outcomes.length, 2);
    assert.equal(outcomes.find(item => String(item.clusterId) === failedClusterId)?.success, false);
    assert.equal(outcomes.find(item => String(item.clusterId) !== failedClusterId)?.success, true);
  });
}

test("pull processing propagates WEST clusterId into monitoring and incident signals", async () => {
  const { service, monitoringCalls, failureSignals } = makeService({
    east: { nodes: [], allocations: [], blockedEvaluations: [] },
    west: {
      nodes: [{ ID: "west-node", Name: "west-node", Status: "down", StatusDescription: "down" }],
      allocations: [],
      blockedEvaluations: []
    }
  });

  await service.pullOnce("2", new Date("2026-08-19T08:00:00.000Z"));

  assert.equal(monitoringCalls[0].clusterId, "2");
  assert.equal(failureSignals[0].clusterId, "2");
});
```

- [ ] **Step 3: Run the multi-cluster tests and verify RED**

```bash
rm -rf .tmp-test
node node_modules/typescript/bin/tsc --target ES2022 --module CommonJS --moduleResolution Node --strict --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --skipLibCheck --outDir .tmp-test --rootDir . tests/nomad.multi-cluster.test.ts
node --test .tmp-test/tests/nomad.multi-cluster.test.js
```

Expected: compile/test failure because current `NomadService` has a permanent client and permanent `config.clusterId`.

- [ ] **Step 4: Add the multi-cluster response contracts**

In `nomad.types.ts` add:

```ts
export interface NomadClusterApiMetadata {
  clusterId: string | number;
  clusterName: string;
  site: string;
  appName: string;
  env: ClusterEnvironment;
}

export type NomadPullSuccessOutcome = NomadClusterApiMetadata & {
  success: true;
  result: NomadPullResult;
};

export type NomadPullFailureOutcome = NomadClusterApiMetadata & {
  success: false;
  error: { code: string; message: string };
};

export type NomadPullOutcome = NomadPullSuccessOutcome | NomadPullFailureOutcome;
export type ScopedNomadPullResult = NomadClusterApiMetadata & NomadPullResult;
```

- [ ] **Step 5: Refactor `NomadService` to resolve clusters dynamically**

Constructor:

```ts
constructor(
  private readonly clusters: ClusterRepositoryPort,
  private readonly clientFactory: NomadClientFactory,
  private readonly monitoring: MonitoringObservationService,
  private readonly alerting: AlertingService
) {}
```

Implement an explicit cluster resolver:

```ts
private async selectedClusters(clusterId?: string): Promise<ClusterEntity[]> {
  if (!clusterId) return this.clusters.findAll();
  const cluster = await this.clusters.findById(clusterId);
  if (!cluster) {
    throw new AppError(404, "CLUSTER_NOT_FOUND", `Cluster ${clusterId} was not found.`);
  }
  return [cluster];
}
```

Create one controlled API-metadata helper and spread it after upstream fields so Nomad cannot override service-owned values:

```ts
private apiMetadata(cluster: ClusterEntity): NomadClusterApiMetadata {
  const metadata = toClusterMetadata(cluster);
  return {
    clusterId: serializeClusterId(metadata.clusterId),
    clusterName: metadata.clusterName,
    site: metadata.site,
    appName: metadata.appName,
    env: metadata.env
  };
}

private enrich<T extends Record<string, unknown>>(value: T, cluster: ClusterEntity) {
  return {
    ...value,
    ...this.apiMetadata(cluster)
  };
}
```

List methods must `Promise.all` selected cluster reads and `.flat()` the enriched arrays. Any rejected cluster read must reject the whole method.

Detail methods must query only the selected cluster when `clusterId` is supplied. Without a cluster ID, search every cluster; ignore only `AppError` with code `NOMAD_RESOURCE_NOT_FOUND`, rethrow all other errors, then apply:

```ts
if (matches.length === 0) {
  throw new AppError(404, "NOMAD_RESOURCE_NOT_FOUND", "Nomad resource was not found.");
}
if (matches.length > 1) {
  throw new AppError(
    409,
    "NOMAD_RESOURCE_CLUSTER_AMBIGUOUS",
    "Nomad resource exists in more than one cluster; specify the cluster query parameter."
  );
}
return matches[0];
```

- [ ] **Step 6: Refactor pull processing so clusterId is an explicit argument**

Replace every use of `this.config.clusterId` in processing code with an explicit cluster argument. Required signatures:

```ts
private async pullCluster(cluster: ClusterEntity, now: Date): Promise<NomadPullResult>
private async processNode(clusterId: string, node: NomadNode, observedAt: Date)
private async processAllocations(clusterId: string, allocations: NomadAllocation[], observedAt: Date)
private async processAllocationGroup(clusterId: string, allocations: NomadAllocation[], observedAt: Date)
private async processBlockedEvaluations(clusterId: string, evaluations: NomadEvaluation[], observedAt: Date)
```

Every call to these existing functions must use the supplied `clusterId`:

```ts
monitoring.record({ clusterId, ... })
monitoring.latestStates({ clusterId, ... })
createNomadFingerprint({ clusterId, ... })
alerting.processFailure({ clusterId, ... })
```

Implement scoped and all-cluster `pullOnce`:

```ts
async pullOnce(clusterId?: string, now = new Date()): Promise<ScopedNomadPullResult | NomadPullOutcome[]> {
  if (this.pulling) {
    throw new AppError(409, "NOMAD_PULL_IN_PROGRESS", "Nomad pull is already running.");
  }

  this.pulling = true;
  try {
    const selected = await this.selectedClusters(clusterId);
    if (clusterId) {
      const cluster = selected[0];
      const result = await this.pullCluster(cluster, now);
      return { ...this.apiMetadata(cluster), ...result };
    }

    const outcomes: NomadPullOutcome[] = [];
    for (const cluster of selected) {
      try {
        outcomes.push({
          ...this.apiMetadata(cluster),
          success: true,
          result: await this.pullCluster(cluster, now)
        });
      } catch (error) {
        outcomes.push({
          ...this.apiMetadata(cluster),
          success: false,
          error: this.pullError(error)
        });
      }
    }
    return outcomes;
  } finally {
    this.pulling = false;
  }
}
```

`pullError()` must preserve service errors and never serialize the cluster object:

```ts
private pullError(error: unknown): { code: string; message: string } {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "INTERNAL_SERVER_ERROR",
    message: error instanceof Error ? error.message : String(error)
  };
}
```

- [ ] **Step 7: Wire the dynamic client factory and remove single-cluster environment dependencies**

`createNomadModule` constructs `ClusterRepository(dataSource)` and the factory:

```ts
const clusters = new ClusterRepository(dataSource);
const clientFactory: NomadClientFactory = cluster => new NomadClient({
  baseUrl: cluster.url,
  token: cluster.token,
  requestTimeoutMs: config.requestTimeoutMs,
  tlsRejectUnauthorized: config.tlsRejectUnauthorized,
  tlsCaFile: config.tlsCaFile
});
const service = new NomadService(clusters, clientFactory, monitoring, alerting);
```

Remove `baseUrl`, `token`, and `clusterId` from `NomadModuleConfig`.

Remove these properties from `env.nomad`:

```ts
baseUrl
token
clusterId
```

Remove their arguments from the `createNomadModule` call in `server.ts`, and change the startup log so it no longer prints one upstream URL:

```ts
console.log(`Nomad puller cron active; schedule=${env.nomad.pullCron}; timezone=${env.nomad.pullCronTimezone}`);
```

- [ ] **Step 8: Run the multi-cluster suite and full build**

```bash
rm -rf .tmp-test
node node_modules/typescript/bin/tsc --target ES2022 --module CommonJS --moduleResolution Node --strict --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --skipLibCheck --outDir .tmp-test --rootDir . tests/cluster.metadata.test.ts tests/nomad.client.test.ts tests/nomad.multi-cluster.test.ts tests/alerting.notifier.test.ts
node --test .tmp-test/tests/cluster.metadata.test.js .tmp-test/tests/nomad.client.test.js .tmp-test/tests/nomad.multi-cluster.test.js .tmp-test/tests/alerting.notifier.test.js
npm run build
```

Expected: all selected tests PASS and build exits 0.

- [ ] **Step 9: Commit the multi-cluster Nomad core**

```bash
git add src/modules/nomad src/config/env.ts src/server.ts tests/nomad.multi-cluster.test.ts
git commit -m "feat: monitor Nomad clusters dynamically"
```

---

### Task 4: Expose the optional `cluster` query through existing Nomad HTTP endpoints

**Files:**
- Create: `src/modules/nomad/nomad.validation.ts`
- Modify: `src/modules/nomad/nomad.controller.ts`
- Test: `tests/nomad.controller.test.ts`

**Interfaces:**
- Produces `parseNomadClusterQuery(query): string | undefined`.
- All existing Nomad read endpoints forward the optional cluster ID to the matching service method.
- `POST /api/v1/nomad/pull` forwards the optional cluster ID to `pullOnce`.
- Route paths and outer `{ success: true, data }` envelope remain unchanged.

- [ ] **Step 1: Write failing parser/controller-forwarding tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { parseNomadClusterQuery } from "../src/modules/nomad/nomad.validation";

test("Nomad cluster query is optional", () => {
  assert.equal(parseNomadClusterQuery({}), undefined);
  assert.equal(parseNomadClusterQuery({ cluster: "1" }), "1");
  assert.equal(parseNomadClusterQuery({ cluster: ["2", "1"] }), "2");
});
```

For the controller, use a fake service whose `getNodes(clusterId)` records the argument; invoke `controller.nodes` with a minimal request containing `{ query: { cluster: "2" } }` and assert the recorded argument is `"2"`.

- [ ] **Step 2: Run and verify RED**

```bash
rm -rf .tmp-test
node node_modules/typescript/bin/tsc --target ES2022 --module CommonJS --moduleResolution Node --strict --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --skipLibCheck --outDir .tmp-test --rootDir . tests/nomad.controller.test.ts
```

Expected: missing `nomad.validation.ts` and controller does not forward query values.

- [ ] **Step 3: Implement parser and controller forwarding**

`nomad.validation.ts`:

```ts
export function parseNomadClusterQuery(query: Record<string, unknown>): string | undefined {
  const value = Array.isArray(query.cluster) ? query.cluster[0] : query.cluster;
  if (value === undefined || value === null || value === "") return undefined;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}
```

Each controller method follows this pattern:

```ts
nodes = async (req: Request, res: Response): Promise<void> => {
  const clusterId = parseNomadClusterQuery(req.query as Record<string, unknown>);
  res.json({ success: true, data: await this.service.getNodes(clusterId) });
};
```

Detail and manual pull methods pass the same parsed value to their existing service method.

- [ ] **Step 4: Run the controller test and build**

```bash
rm -rf .tmp-test
node node_modules/typescript/bin/tsc --target ES2022 --module CommonJS --moduleResolution Node --strict --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --skipLibCheck --outDir .tmp-test --rootDir . tests/nomad.controller.test.ts
node --test .tmp-test/tests/nomad.controller.test.js
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit the HTTP contract**

```bash
git add src/modules/nomad/nomad.validation.ts src/modules/nomad/nomad.controller.ts tests/nomad.controller.test.ts
git commit -m "feat: add optional cluster scope to Nomad API"
```

---

### Task 5: Enrich monitoring current/snapshot APIs with bulk cluster metadata

**Files:**
- Modify: `src/modules/monitoring/monitoring-current-state.service.ts`
- Modify: `src/modules/monitoring/monitoring-snapshot.service.ts`
- Modify: `src/app.ts`
- Test: `tests/monitoring.cluster-metadata.test.ts`

**Interfaces:**
- Both services consume `ClusterRepositoryPort` in addition to their existing repository.
- Existing `clusterId` output is preserved exactly as currently returned by monitoring entities.
- Adds only `clusterName`, `site`, `appName`, `env`.
- One result set performs one `findMetadataByIds()` call; no per-row cluster queries.

- [ ] **Step 1: Write failing service tests for enrichment and one bulk lookup**

Use concrete entity fixtures and repository fakes in `tests/monitoring.cluster-metadata.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { MonitoringCurrentStateEntity } from "../src/modules/monitoring/monitoring-current-state.entity";
import type { MonitoringCurrentStateRepository } from "../src/modules/monitoring/monitoring-current-state.repository";
import { MonitoringCurrentStateService } from "../src/modules/monitoring/monitoring-current-state.service";
import type { MonitoringSnapshotEntity } from "../src/modules/monitoring/monitoring-snapshot.entity";
import type { MonitoringSnapshotRepository } from "../src/modules/monitoring/monitoring-snapshot.repository";
import { MonitoringSnapshotService } from "../src/modules/monitoring/monitoring-snapshot.service";
import { fakeClusterRepository } from "./test-fixtures";

const eastCurrent = {
  id: "10",
  clusterId: "1",
  source: "NOMAD",
  resourceType: "NODE",
  resourceKey: "east-node",
  resourceName: "east-node",
  state: "READY",
  payloadJson: { Status: "ready" },
  lastCheckedAt: new Date("2026-08-19T08:00:00.000Z"),
  lastChangedAt: new Date("2026-08-19T07:00:00.000Z")
} as MonitoringCurrentStateEntity;

const westCurrent = {
  ...eastCurrent,
  id: "11",
  clusterId: "2",
  resourceKey: "west-node",
  resourceName: "west-node"
} as MonitoringCurrentStateEntity;

const eastSnapshot = {
  id: "20",
  clusterId: "1",
  source: "NOMAD",
  resourceType: "NODE",
  resourceKey: "east-node",
  resourceName: "east-node",
  state: "READY",
  payloadJson: { Status: "ready" },
  observedAt: new Date("2026-08-19T08:00:00.000Z")
} as MonitoringSnapshotEntity;

test("monitoring current enriches rows with one bulk cluster lookup", async () => {
  let metadataCalls = 0;
  const repository = {
    async list() { return [eastCurrent, westCurrent]; }
  } as unknown as MonitoringCurrentStateRepository;
  const clusters = fakeClusterRepository({
    onBulkLookup: () => { metadataCalls += 1; }
  });
  const service = new MonitoringCurrentStateService(repository, clusters);

  const result = await service.list({});

  assert.equal(metadataCalls, 1);
  assert.equal(result[0].clusterId, "1");
  assert.equal(result[0].clusterName, "Cluster EAST");
  assert.equal(result[1].site, "tebet");
  assert.equal(result[0].resourceKey, "east-node");
  assert.equal(result[0].lastCheckedAt, "2026-08-19T08:00:00.000Z");
  assert.equal("url" in result[0], false);
  assert.equal("token" in result[0], false);
});

test("monitoring snapshots preserve fields and add cluster metadata with one bulk lookup", async () => {
  let metadataCalls = 0;
  const repository = {
    async list() { return [eastSnapshot]; }
  } as unknown as MonitoringSnapshotRepository;
  const clusters = fakeClusterRepository({
    onBulkLookup: () => { metadataCalls += 1; }
  });
  const service = new MonitoringSnapshotService(repository, clusters);

  const result = await service.list({});

  assert.equal(metadataCalls, 1);
  assert.deepEqual(result[0], {
    id: "20",
    clusterId: "1",
    clusterName: "Cluster EAST",
    site: "cawang",
    appName: "Nomad East Lab App",
    env: "PRODUCTION",
    source: "NOMAD",
    resourceType: "NODE",
    resourceKey: "east-node",
    resourceName: "east-node",
    state: "READY",
    payload: { Status: "ready" },
    observedAt: "2026-08-19T08:00:00.000Z"
  });
});
```

- [ ] **Step 2: Run and verify RED**

```bash
rm -rf .tmp-test
node node_modules/typescript/bin/tsc --target ES2022 --module CommonJS --moduleResolution Node --strict --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --skipLibCheck --outDir .tmp-test --rootDir . tests/monitoring.cluster-metadata.test.ts
node --test .tmp-test/tests/monitoring.cluster-metadata.test.js
```

Expected: constructor/signature assertions fail because current services have no cluster repository and no metadata fields.

- [ ] **Step 3: Add bulk enrichment to both services**

Bulk-load metadata once, then map current-state rows exactly as follows:

```ts
const metadataById = await this.clusters.findMetadataByIds(items.map(item => item.clusterId));

return items.map(item => {
  const metadata = metadataById.get(item.clusterId);
  if (!metadata) throw new Error(`Cluster metadata missing for cluster ${item.clusterId}.`);
  return {
    id: item.id,
    clusterId: item.clusterId,
    clusterName: metadata.clusterName,
    site: metadata.site,
    appName: metadata.appName,
    env: metadata.env,
    source: item.source,
    resourceType: item.resourceType,
    resourceKey: item.resourceKey,
    resourceName: item.resourceName,
    state: item.state,
    payload: item.payloadJson,
    lastCheckedAt: item.lastCheckedAt.toISOString(),
    lastChangedAt: item.lastChangedAt.toISOString()
  };
});
```

Snapshot rows use the same metadata lookup and this exact output mapping:

```ts
return items.map(item => {
  const metadata = metadataById.get(item.clusterId);
  if (!metadata) throw new Error(`Cluster metadata missing for cluster ${item.clusterId}.`);
  return {
    id: item.id,
    clusterId: item.clusterId,
    clusterName: metadata.clusterName,
    site: metadata.site,
    appName: metadata.appName,
    env: metadata.env,
    source: item.source,
    resourceType: item.resourceType,
    resourceKey: item.resourceKey,
    resourceName: item.resourceName,
    state: item.state,
    payload: item.payloadJson,
    observedAt: item.observedAt.toISOString()
  };
});
```

Do not expose `metadata.clusterId` in place of the existing monitoring `item.clusterId` value.

In `createApp`, instantiate one `ClusterRepository(AppDataSource)` and inject it into both monitoring services.

- [ ] **Step 4: Run tests and build**

```bash
rm -rf .tmp-test
node node_modules/typescript/bin/tsc --target ES2022 --module CommonJS --moduleResolution Node --strict --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --skipLibCheck --outDir .tmp-test --rootDir . tests/monitoring.cluster-metadata.test.ts
node --test .tmp-test/tests/monitoring.cluster-metadata.test.js
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit monitoring enrichment**

```bash
git add src/modules/monitoring/monitoring-current-state.service.ts src/modules/monitoring/monitoring-snapshot.service.ts src/app.ts tests/monitoring.cluster-metadata.test.ts
git commit -m "feat: enrich monitoring API with cluster metadata"
```

---

### Task 6: Enrich incident and dashboard incident outputs

**Files:**
- Modify: `src/modules/incidents/incident.mapper.ts`
- Modify: `src/modules/incidents/incident.service.ts`
- Modify: `src/modules/dashboard/dashboard.service.ts`
- Modify: `src/app.ts`
- Modify: `src/modules/alerting/alerting.module.ts`
- Test: `tests/incident-dashboard.cluster-metadata.test.ts`

**Interfaces:**
- `mapIncidentListItem(entity, metadata)` adds the approved cluster metadata while preserving current list fields.
- `mapIncidentDetail(entity, metadata, currentUser?)` adds `clusterId`, `clusterName`, `site`, `appName`, `env` while preserving acknowledgement/postpone structures.
- ACK and POSTPONE response mapper signatures/output remain unchanged.
- Incident list and dashboard recent/resolved each bulk-load metadata once per result set.

- [ ] **Step 1: Write failing incident list/detail/dashboard tests with concrete fixtures**

`tests/incident-dashboard.cluster-metadata.test.ts` uses one complete incident fixture and concrete repository fakes:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { MonitoringCurrentStateRepository } from "../src/modules/monitoring/monitoring-current-state.repository";
import { DashboardService } from "../src/modules/dashboard/dashboard.service";
import type { IncidentEntity } from "../src/modules/incidents/incident.entity";
import { IncidentSeverity, IncidentStatus } from "../src/modules/incidents/incident.enums";
import type { IncidentRepository } from "../src/modules/incidents/incident.repository";
import { IncidentService } from "../src/modules/incidents/incident.service";
import { fakeClusterRepository } from "./test-fixtures";

const incident = {
  id: "1",
  publicId: "INC-00123",
  clusterId: "1",
  source: "NOMAD",
  type: "NODE_DOWN",
  severity: IncidentSeverity.CRITICAL,
  resourceType: "NODE",
  resourceKey: "east-node",
  resourceName: "east-node",
  fingerprint: "fingerprint",
  activeFingerprint: "fingerprint",
  status: IncidentStatus.OPEN,
  message: "Node is down",
  contextJson: { ID: "east-node" },
  openedAt: new Date("2026-08-19T03:00:00.000Z"),
  lastDetectedAt: new Date("2026-08-19T03:01:00.000Z"),
  lastNotificationAt: new Date("2026-08-19T03:00:00.000Z"),
  nextNotificationAt: new Date("2026-08-19T03:02:00.000Z"),
  reminderCount: 1,
  acknowledgedAt: new Date("2026-08-19T03:00:30.000Z"),
  acknowledgedBy: "101",
  acknowledgedByUserName: "Budi Santoso",
  acknowledgedByUsername: "budi",
  acknowledgementNote: "Checking",
  postponedAt: new Date("2026-08-19T03:00:40.000Z"),
  postponedBy: "101",
  postponedByUserName: "Budi Santoso",
  postponedByUsername: "budi",
  postponeUntil: new Date("2099-08-19T04:00:00.000Z"),
  postponeRemark: "Maintenance",
  resolvedAt: null,
  createdAt: new Date("2026-08-19T03:00:00.000Z"),
  updatedAt: new Date("2026-08-19T03:01:00.000Z")
} as IncidentEntity;

function incidentRepositoryFake(): IncidentRepository {
  return {
    async findByPublicId(publicId: string) {
      return publicId === incident.publicId ? incident : null;
    },
    async list() {
      return { items: [incident], total: 1 };
    },
    async recent() {
      return [incident];
    },
    async resolvedHistory() {
      return { items: [incident], total: 1 };
    }
  } as unknown as IncidentRepository;
}

test("incident detail adds cluster identity without changing action structures", async () => {
  const service = new IncidentService(incidentRepositoryFake(), fakeClusterRepository());
  const detail = await service.detail("INC-00123");

  assert.equal(detail.clusterId, 1);
  assert.equal(detail.clusterName, "Cluster EAST");
  assert.equal(detail.site, "cawang");
  assert.equal(detail.appName, "Nomad East Lab App");
  assert.equal(detail.env, "PRODUCTION");
  assert.deepEqual(detail.acknowledgement, {
    acknowledged: true,
    acknowledgedAt: incident.acknowledgedAt,
    acknowledgedBy: { id: 101, name: "Budi Santoso", username: "budi" },
    note: "Checking"
  });
  assert.deepEqual(detail.postpone, {
    postponed: true,
    postponedAt: incident.postponedAt,
    postponedBy: { id: 101, name: "Budi Santoso", username: "budi" },
    postponeUntil: incident.postponeUntil,
    remark: "Maintenance"
  });
});

test("incident list bulk-loads metadata once", async () => {
  let metadataCalls = 0;
  const service = new IncidentService(
    incidentRepositoryFake(),
    fakeClusterRepository({ onBulkLookup: () => { metadataCalls += 1; } })
  );
  const result = await service.list({
    page: 1,
    limit: 20
  });

  assert.equal(metadataCalls, 1);
  assert.equal(result.items[0].clusterName, "Cluster EAST");
  assert.equal(result.items[0].clusterId, 1);
});

test("dashboard recent and resolved enrich incident rows", async () => {
  let metadataCalls = 0;
  const dashboard = new DashboardService(
    incidentRepositoryFake(),
    {} as MonitoringCurrentStateRepository,
    fakeClusterRepository({ onBulkLookup: () => { metadataCalls += 1; } })
  );

  const recent = await dashboard.recent({});
  const resolved = await dashboard.resolved({});

  assert.equal(recent[0].clusterName, "Cluster EAST");
  assert.equal(resolved.items[0].appName, "Nomad East Lab App");
  assert.equal(metadataCalls, 2);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
rm -rf .tmp-test
node node_modules/typescript/bin/tsc --target ES2022 --module CommonJS --moduleResolution Node --strict --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --skipLibCheck --outDir .tmp-test --rootDir . tests/incident-dashboard.cluster-metadata.test.ts
node --test .tmp-test/tests/incident-dashboard.cluster-metadata.test.js
```

Expected: current detail lacks cluster identity and services do not load metadata.

- [ ] **Step 3: Make mapper metadata explicit**

Add a reusable metadata field helper in `incident.mapper.ts`:

```ts
function clusterFields(metadata: ClusterMetadata) {
  return {
    clusterId: serializeClusterId(metadata.clusterId),
    clusterName: metadata.clusterName,
    site: metadata.site,
    appName: metadata.appName,
    env: metadata.env
  };
}
```

List mapper must preserve the complete existing shape and insert the cluster fields:

```ts
export function mapIncidentListItem(entity: IncidentEntity, metadata: ClusterMetadata) {
  return {
    id: entity.publicId,
    ...clusterFields(metadata),
    source: entity.source,
    type: entity.type,
    severity: entity.severity,
    status: entity.status,
    acknowledged: entity.acknowledgedAt !== null,
    postponed: isPostponed(entity),
    postponeUntil: entity.postponeUntil,
    resource: {
      type: entity.resourceType,
      id: entity.resourceKey,
      name: entity.resourceName
    },
    message: entity.message,
    openedAt: entity.openedAt,
    lastDetectedAt: entity.lastDetectedAt,
    resolvedAt: entity.resolvedAt
  };
}
```

Detail mapper starts with `id`, spreads `clusterFields(metadata)`, then keeps the current `source`, `type`, `severity`, `status`, `resource`, `message`, `context`, timestamps, `acknowledgement`, `postpone`, and `resolvedAt` fields unchanged. Do not modify `mapAcknowledgeResponse()` or `mapPostponeResponse()`.

- [ ] **Step 4: Bulk-load metadata in IncidentService and DashboardService**

`IncidentService` constructor becomes:

```ts
constructor(
  private readonly repository: IncidentRepository,
  private readonly clusters: ClusterRepositoryPort
) {}
```

List/detail resolve metadata before calling the new mapper signatures. For a missing metadata row, throw a normal internal `Error` so the existing 500 handler applies rather than fabricating metadata.

`DashboardService.recent()` and `.resolved()` bulk-load cluster IDs and map with `mapIncidentListItem(item, metadata)`.

Update `new IncidentService(...)` in `src/app.ts` to inject the already-created app-level `ClusterRepository`. Because `createAlertingModule()` also constructs an internal `IncidentService`, update `src/modules/alerting/alerting.module.ts` in this task to construct `ClusterRepository(dataSource)` and pass it to that `IncidentService`; Task 8 will reuse the same repository for notifier metadata lookup.

- [ ] **Step 5: Run tests and build**

```bash
rm -rf .tmp-test
node node_modules/typescript/bin/tsc --target ES2022 --module CommonJS --moduleResolution Node --strict --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --skipLibCheck --outDir .tmp-test --rootDir . tests/incident-dashboard.cluster-metadata.test.ts tests/alerting.notifier.test.ts
node --test .tmp-test/tests/incident-dashboard.cluster-metadata.test.js .tmp-test/tests/alerting.notifier.test.js
npm run build
```

Expected: PASS. ACK/POSTPONE webhook regression remains green.

- [ ] **Step 6: Commit incident enrichment**

```bash
git add src/modules/incidents/incident.mapper.ts src/modules/incidents/incident.service.ts src/modules/dashboard/dashboard.service.ts src/modules/alerting/alerting.module.ts src/app.ts tests/incident-dashboard.cluster-metadata.test.ts
git commit -m "feat: enrich incident APIs with cluster metadata"
```

---

### Task 7: Add cluster filtering to dashboard incident summary

**Files:**
- Modify: `src/modules/incidents/incident.repository.ts`
- Modify: `src/modules/dashboard/dashboard.service.ts`
- Modify: `src/modules/dashboard/dashboard.controller.ts`
- Test: `tests/dashboard.cluster-filter.test.ts`

**Interfaces:**
- `IncidentRepository.countSummary(clusterId?: string, now?: Date)` scopes every count/group query when `clusterId` is present.
- `DashboardService.summary(query)` uses the same optional `cluster` parsing semantics as overview/health.
- `DashboardController.summary` passes `req.query` instead of discarding it.
- Dashboard aggregate response shape remains unchanged.

- [ ] **Step 1: Write failing service/controller tests with concrete summary data**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { DashboardController } from "../src/modules/dashboard/dashboard.controller";
import { DashboardService } from "../src/modules/dashboard/dashboard.service";
import type { IncidentRepository } from "../src/modules/incidents/incident.repository";
import type { MonitoringCurrentStateRepository } from "../src/modules/monitoring/monitoring-current-state.repository";
import { fakeClusterRepository } from "./test-fixtures";

const summaryCounts = {
  activeTotal: 3,
  acknowledged: 1,
  unacknowledged: 2,
  postponed: 1,
  resolvedToday: 4,
  resolvedLast24Hours: 5,
  bySeverity: { CRITICAL: 2, MAJOR: 1 },
  byType: { NODE_DOWN: 3 }
};

test("dashboard incident summary forwards cluster filter", async () => {
  let receivedCluster: string | undefined;
  const incidents = {
    async countSummary(clusterId?: string) {
      receivedCluster = clusterId;
      return summaryCounts;
    }
  } as unknown as IncidentRepository;

  const service = new DashboardService(
    incidents,
    {} as MonitoringCurrentStateRepository,
    fakeClusterRepository()
  );
  await service.summary({ cluster: "2" });
  assert.equal(receivedCluster, "2");
});

test("dashboard controller forwards summary query", async () => {
  let receivedQuery: Record<string, unknown> | undefined;
  const service = {
    async summary(query: Record<string, unknown>) {
      receivedQuery = query;
      return { ok: true };
    }
  } as unknown as DashboardService;
  const controller = new DashboardController(service);
  const req = { query: { cluster: "1" } } as unknown as Request;
  const res = {
    json(value: unknown) { return value; }
  } as unknown as Response;

  await controller.summary(req, res);
  assert.deepEqual(receivedQuery, { cluster: "1" });
});
```

- [ ] **Step 2: Run and verify RED**

```bash
rm -rf .tmp-test
node node_modules/typescript/bin/tsc --target ES2022 --module CommonJS --moduleResolution Node --strict --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --skipLibCheck --outDir .tmp-test --rootDir . tests/dashboard.cluster-filter.test.ts
node --test .tmp-test/tests/dashboard.cluster-filter.test.js
```

Expected: current `summary()` accepts no query and `countSummary()` accepts no cluster filter.

- [ ] **Step 3: Scope every summary query in the repository**

Change signature:

```ts
async countSummary(clusterId?: string, now = new Date()): Promise<{
  activeTotal: number;
  acknowledged: number;
  unacknowledged: number;
  postponed: number;
  resolvedToday: number;
  resolvedLast24Hours: number;
  bySeverity: Record<string, number>;
  byType: Record<string, number>;
}>
```

For every OPEN/RESOLVED count and both grouped queries, append the same condition when `clusterId` exists:

```ts
if (clusterId) {
  qb.andWhere("i.cluster_id = :clusterId", { clusterId });
}
```

Replace the current `repository.count({ where: { status: OPEN } })` active-total call with a query builder so it can receive the same optional cluster predicate.

- [ ] **Step 4: Forward the query from controller to service**

```ts
async summary(query: Record<string, unknown>) {
  const filters = parseDashboardOverviewQuery(query);
  const result = await this.incidents.countSummary(filters.cluster);

  return {
    open: {
      total: result.activeTotal,
      unacknowledged: result.unacknowledged,
      acknowledged: result.acknowledged,
      postponed: result.postponed
    },
    resolved: {
      today: result.resolvedToday,
      last24Hours: result.resolvedLast24Hours
    },
    bySeverity: {
      [IncidentSeverity.CRITICAL]: result.bySeverity[IncidentSeverity.CRITICAL] ?? 0,
      [IncidentSeverity.MAJOR]: result.bySeverity[IncidentSeverity.MAJOR] ?? 0,
      [IncidentSeverity.WARNING]: result.bySeverity[IncidentSeverity.WARNING] ?? 0
    },
    byType: {
      ...Object.fromEntries(NOMAD_INCIDENT_TYPES.map(type => [type, 0])),
      ...result.byType
    }
  };
}
```

Controller:

```ts
summary = async (req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: await this.service.summary(req.query as Record<string, unknown>) });
};
```

- [ ] **Step 5: Run tests and build**

```bash
rm -rf .tmp-test
node node_modules/typescript/bin/tsc --target ES2022 --module CommonJS --moduleResolution Node --strict --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --skipLibCheck --outDir .tmp-test --rootDir . tests/dashboard.cluster-filter.test.ts
node --test .tmp-test/tests/dashboard.cluster-filter.test.js
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit dashboard filtering**

```bash
git add src/modules/incidents/incident.repository.ts src/modules/dashboard/dashboard.service.ts src/modules/dashboard/dashboard.controller.ts tests/dashboard.cluster-filter.test.ts
git commit -m "feat: filter dashboard summary by cluster"
```

---

### Task 8: Enrich INITIAL, REMINDER, and RESOLVED webhook broadcasts with cluster metadata

**Files:**
- Modify: `src/modules/alerting/alerting.notifier.ts`
- Modify: `src/modules/alerting/alerting.module.ts`
- Modify: `tests/alerting.notifier.test.ts`

**Interfaces:**
- Both `ConsoleAlertNotifier` and `HttpWebhookAlertNotifier` consume a `ClusterRepositoryPort`.
- `send()` resolves `incident.clusterId` through `findMetadataById()` before payload serialization.
- Missing metadata causes `send()` to reject; existing worker/service catch paths handle the failure.
- Existing ACK/POSTPONE conditional fields remain byte-for-byte equivalent in meaning.
- Adds exactly `clusterName`, `site`, `appName`, `env` inside `incident`.

- [ ] **Step 1: Extend the existing notifier tests and verify RED**

Import `fakeClusterRepository` from `./test-fixtures` and change the existing helper signature so it constructs the notifier with the supplied repository:

```ts
async function sendAndReadPayload(
  kind: AlertNotificationKind,
  incident: IncidentEntity,
  clusters = fakeClusterRepository()
) {
  const originalFetch = globalThis.fetch;
  let body: string | undefined;

  globalThis.fetch = async (_input, init) => {
    body = init?.body as string | undefined;
    return new Response(null, { status: 200 });
  };

  try {
    const notifier = new HttpWebhookAlertNotifier(
      clusters,
      "http://telegram.test/webhooks/alerts"
    );
    await notifier.send({ kind, incident });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(body, "webhook request body should be present");
  return JSON.parse(body) as { incident: Record<string, unknown> };
}

for (const kind of ["INITIAL", "REMINDER", "RESOLVED"] as const) {
  test(`${kind} includes approved cluster metadata`, async () => {
    const payload = await sendAndReadPayload(kind, makeIncident());
    assert.equal(payload.incident.clusterName, "Cluster EAST");
    assert.equal(payload.incident.site, "cawang");
    assert.equal(payload.incident.appName, "Nomad East Lab App");
    assert.equal(payload.incident.env, "PRODUCTION");
    assert.equal("url" in payload.incident, false);
    assert.equal("token" in payload.incident, false);
    assert.equal("clusterId" in payload.incident, false);
  });
}

test("notification fails when incident cluster metadata is missing", async () => {
  const notifier = new HttpWebhookAlertNotifier(
    fakeClusterRepository({ clusters: [] }),
    "http://telegram.test/webhooks/alerts"
  );
  await assert.rejects(
    notifier.send({ kind: "INITIAL", incident: makeIncident({ clusterId: "99" }) }),
    /Cluster metadata missing/
  );
});
```

Keep all existing v1.9.4 ACK/POSTPONE assertions unchanged.

- [ ] **Step 2: Run and verify RED**

```bash
rm -rf .tmp-test
node node_modules/typescript/bin/tsc --target ES2022 --module CommonJS --moduleResolution Node --strict --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --skipLibCheck --outDir .tmp-test --rootDir . tests/alerting.notifier.test.ts
node --test .tmp-test/tests/alerting.notifier.test.js
```

Expected: cluster metadata assertions fail.

- [ ] **Step 3: Make payload serialization cluster-aware**

Change the serializer to accept already-safe `ClusterMetadata`:

```ts
function toWebhookPayload(notification: AlertNotification, cluster: ClusterMetadata) {
  const { incident, kind } = notification;
  return {
    event: "INCIDENT_ALERT",
    kind,
    incident: {
      id: incident.publicId,
      status: incident.status,
      source: incident.source,
      type: incident.type,
      severity: incident.severity,
      resource: {
        type: incident.resourceType,
        key: incident.resourceKey,
        name: incident.resourceName
      },
      message: incident.message,
      clusterName: cluster.clusterName,
      site: cluster.site,
      appName: cluster.appName,
      env: cluster.env,
      openedAt: incident.openedAt.toISOString(),
      resolvedAt: incident.resolvedAt?.toISOString() ?? null,
      reminderCount: kind === "REMINDER" ? incident.reminderCount + 1 : incident.reminderCount,
      ...(incident.acknowledgedAt !== null
        ? {
            acknowledgedAt: incident.acknowledgedAt.toISOString(),
            acknowledgedByUserName: incident.acknowledgedByUserName,
            acknowledgementNote: incident.acknowledgementNote
          }
        : {}),
      ...(incident.postponedAt !== null
        ? {
            postponedAt: incident.postponedAt.toISOString(),
            postponedByUserName: incident.postponedByUserName,
            postponeUntil: incident.postponeUntil?.toISOString() ?? null,
            postponeRemark: incident.postponeRemark
          }
        : {})
    }
  };
}
```

Each notifier resolves metadata first:

```ts
const cluster = await this.clusters.findMetadataById(notification.incident.clusterId);
if (!cluster) {
  throw new Error(`Cluster metadata missing for cluster ${notification.incident.clusterId}.`);
}
```

Then serialize/log/send using only `ClusterMetadata`, never `ClusterEntity`.

- [ ] **Step 4: Update alerting module wiring**

Inside `createAlertingModule`, reuse the `ClusterRepository(dataSource)` instance introduced in Task 6. Pass it to `IncidentService` and to whichever notifier is selected. Constructor order is:

```ts
new HttpWebhookAlertNotifier(clusterRepository, config.webhookUrl)
new ConsoleAlertNotifier(clusterRepository)
```

- [ ] **Step 5: Run notifier tests and build**

```bash
rm -rf .tmp-test
node node_modules/typescript/bin/tsc --target ES2022 --module CommonJS --moduleResolution Node --strict --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --skipLibCheck --outDir .tmp-test --rootDir . tests/alerting.notifier.test.ts
node --test .tmp-test/tests/alerting.notifier.test.js
npm run build
```

Expected: all INITIAL/REMINDER/RESOLVED and ACK/POSTPONE tests PASS.

- [ ] **Step 6: Commit webhook enrichment**

```bash
git add src/modules/alerting/alerting.notifier.ts src/modules/alerting/alerting.module.ts tests/alerting.notifier.test.ts
git commit -m "feat: add cluster metadata to incident broadcasts"
```

---

### Task 9: Finalize v2.0.0 configuration, Docker tags, and documentation

**Files:**
- Modify: `.env.example`
- Modify: `.env.docker.dev.example`
- Modify: `.env.docker.local.example`
- Modify: `docker-compose.yml`
- Modify: `compose.local.yml`
- Modify: `compose.dev.yml`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/NOMAD_PULLER.md`
- Modify: `docs/DASHBOARD_API.md`
- Modify: `docs/RESOLVED_WEBHOOK.md`
- Modify: `docs/DOCKER_DEPLOYMENT.md`

**Interfaces:**
- Declares project/image version `2.0.0` consistently.
- Example env files contain global Nomad settings but no single-cluster URL/token/ID.
- Docs describe a DB-driven cluster registry with manual production provisioning, optional query behavior, detail 404/409, pull partial outcomes, API metadata, and webhook metadata.
- Any EAST/WEST values shown in documentation are explicitly labeled sample/dummy metadata, not production defaults.

- [ ] **Step 1: Remove obsolete single-cluster variables from example configuration**

Delete these lines from all applicable example env files and deployment examples:

```text
NOMAD_BASE_URL
NOMAD_TOKEN
NOMAD_CLUSTER_ID
```

Keep and document:

```dotenv
NOMAD_ENABLED=true
NOMAD_PULL_CRON=*/15 * * * * *
NOMAD_PULL_CRON_TZ=Asia/Jakarta
NOMAD_PULL_RUN_ON_START=true
NOMAD_REQUEST_TIMEOUT_MS=10000
NOMAD_TLS_REJECT_UNAUTHORIZED=true
NOMAD_TLS_CA_FILE=
```

Do not treat private `.env`, `.env.docker.dev`, or `.env.docker.local` values as cluster source of truth in documentation.

- [ ] **Step 2: Bump project and all Compose image tags to 2.0.0**

Set:

```json
"version": "2.0.0"
```

in both package metadata files, and set all three compose files to:

```yaml
image: monitoring-service:2.0.0
```

Preserve environment-specific differences already present in the v1.9.6 compose files.

- [ ] **Step 3: Document the exact Nomad API contract**

`docs/NOMAD_PULLER.md` and README must show:

```text
GET  /api/v1/nomad/nodes?cluster=1
GET  /api/v1/nomad/nodes
GET  /api/v1/nomad/nodes/:nodeId?cluster=1
POST /api/v1/nomad/pull?cluster=1
POST /api/v1/nomad/pull
```

Document:
- list without `cluster` returns flattened items from all registered cluster rows;
- each item adds `clusterId`, `clusterName`, `site`, `appName`, `env`;
- unscoped detail returns `NOMAD_RESOURCE_NOT_FOUND` or `NOMAD_RESOURCE_CLUSTER_AMBIGUOUS` as approved;
- all-cluster pull returns per-cluster success/error items and continues after one cluster fails;
- `url` and `token` remain internal.

- [ ] **Step 4: Document existing API and webhook enrichment**

`docs/DASHBOARD_API.md` documents `cluster` on incident summary and existing overview/health behavior. Monitoring/incident examples include the approved metadata fields. `docs/RESOLVED_WEBHOOK.md` documents that INITIAL, REMINDER, and RESOLVED incident payloads include:

```json
{
  "clusterName": "Cluster EAST",
  "site": "cawang",
  "appName": "Nomad East Lab App",
  "env": "PRODUCTION"
}
```

Preserve ACK/POSTPONE metadata documentation from v1.9.4.

- [ ] **Step 5: Add a v2.0.0 changelog entry**

The entry must state only implemented scope: schema-only cluster registry, manually provisioned cluster rows, multi-cluster Nomad reads/pulls, API enrichment/filtering, webhook enrichment, obsolete single-cluster env removal, and image/version bump.

- [ ] **Step 6: Verify configuration/document references**

```bash
grep -RIn "NOMAD_BASE_URL\|NOMAD_TOKEN\|NOMAD_CLUSTER_ID" .env.example .env.docker.dev.example .env.docker.local.example README.md docs/NOMAD_PULLER.md docs/DOCKER_DEPLOYMENT.md
```

Expected: no runtime/example instruction tells users to configure cluster URL/token/ID via environment variables. Historical spec references are not part of this grep target.

```bash
grep -n "monitoring-service:2.0.0" docker-compose.yml compose.local.yml compose.dev.yml
```

Expected: one matching image line in each compose file.

- [ ] **Step 7: Commit version/documentation**

```bash
git add .env.example .env.docker.dev.example .env.docker.local.example docker-compose.yml compose.local.yml compose.dev.yml package.json package-lock.json README.md CHANGELOG.md docs/NOMAD_PULLER.md docs/DASHBOARD_API.md docs/RESOLVED_WEBHOOK.md docs/DOCKER_DEPLOYMENT.md
git commit -m "docs: finalize multi-cluster release 2.0.0"
```

---

### Task 10: Full regression, migration, and security verification

**Files:**
- Verify all files changed in Tasks 1-9.
- No production change is expected in this task unless verification exposes a concrete defect; any defect fix must first receive a failing regression test.

**Interfaces:**
- Proves the approved spec is implemented without URL/token exposure or single-cluster runtime dependency.

- [ ] **Step 1: Compile all regression tests together**

```bash
rm -rf .tmp-test
node node_modules/typescript/bin/tsc --target ES2022 --module CommonJS --moduleResolution Node --strict --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --skipLibCheck --outDir .tmp-test --rootDir . \
  tests/cluster.metadata.test.ts \
  tests/nomad.client.test.ts \
  tests/nomad.multi-cluster.test.ts \
  tests/nomad.controller.test.ts \
  tests/monitoring.cluster-metadata.test.ts \
  tests/incident-dashboard.cluster-metadata.test.ts \
  tests/dashboard.cluster-filter.test.ts \
  tests/alerting.notifier.test.ts
```

Expected: exit 0.

- [ ] **Step 2: Run the complete native node:test regression suite**

```bash
node --test \
  .tmp-test/tests/cluster.metadata.test.js \
  .tmp-test/tests/nomad.client.test.js \
  .tmp-test/tests/nomad.multi-cluster.test.js \
  .tmp-test/tests/nomad.controller.test.js \
  .tmp-test/tests/monitoring.cluster-metadata.test.js \
  .tmp-test/tests/incident-dashboard.cluster-metadata.test.js \
  .tmp-test/tests/dashboard.cluster-filter.test.js \
  .tmp-test/tests/alerting.notifier.test.js
```

Expected: all tests PASS, zero failures.

- [ ] **Step 3: Run the production TypeScript build**

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 4: Run whitespace/diff validation**

```bash
git diff --check
```

Expected: exit 0 with no output.

- [ ] **Step 5: Verify secret/URL non-exposure in serializers**

```bash
grep -RIn "\.token\|\.url" src/modules/incidents src/modules/monitoring src/modules/dashboard src/modules/alerting
```

Expected: no API or webhook serialization path accesses `ClusterEntity.token` or `ClusterEntity.url`. Cluster repository and Nomad client/module are allowed to access those properties.

- [ ] **Step 6: Verify obsolete environment settings are not consumed by source**

```bash
grep -RIn "NOMAD_BASE_URL\|NOMAD_TOKEN\|NOMAD_CLUSTER_ID" src .env.example .env.docker.dev.example .env.docker.local.example
```

Expected: no matches.

- [ ] **Step 7: Verify migration against MySQL when a test database is available**

Run the project migration using a disposable/test DB configuration:

```bash
npm run db:migrate
```

Then verify the table schema and absence of seeded data:

```sql
SHOW CREATE TABLE clusters;
SELECT COUNT(*) AS cluster_count FROM clusters;
```

Expected:

```text
clusters has the approved columns/types/indexes
cluster_count = 0
```

Do not insert the EAST/WEST fixture values as part of migration verification. Production cluster rows are inserted manually after deployment.

If MySQL is unavailable in the execution environment, do not claim migration runtime success. Report that migration was verified only by TypeScript build, SQL review, and registration in `AppDataSource`.

- [ ] **Step 8: Review the implementation against all 15 spec test requirements**

Confirm evidence exists for:

```text
1  metadata excludes url/token
2  scoped Nomad list
3  all-cluster flattened Nomad list
4  CLUSTER_NOT_FOUND
5  unique unscoped detail
6  unscoped detail 404
7  unscoped detail 409 ambiguity
8  all-cluster pull failure isolation; tests cover both dummy fixture failure directions
9  monitoring/incident clusterId propagation from pull
10 monitoring current/snapshot enrichment
11 incident list/detail/dashboard recent/resolved enrichment
12 dashboard summary cluster filter
13 INITIAL/REMINDER/RESOLVED cluster webhook metadata
14 ACK/POSTPONE webhook metadata regression
15 build without single-cluster Nomad environment requirements
```

- [ ] **Step 9: Commit any verification-only test adjustments if required**

Only if a verification step required a test correction that did not weaken assertions:

```bash
git add tests
git commit -m "test: complete multi-cluster regression coverage"
```

Otherwise, make no commit in this step.

## Execution Notes

- Use an isolated copy/worktree based on the current v1.9.6 artifact state when implementation starts; preserve the baseline local differences already accepted in this project.
- Stage only the files listed for each task so unrelated baseline changes do not enter feature commits.
- Do not run migrations against production as part of development verification.
- Do not log full `ClusterEntity` objects because they contain the Nomad token.
- Do not change API envelopes, route paths, incident lifecycle, ACK semantics, POSTPONE semantics, or reminder scheduling beyond the approved v2.0.0 scope.

# Multi-Cluster Nomad Monitoring Design

**Baseline version:** 1.9.6  
**Target version:** 2.0.0  
**Date:** 2026-08-19

## Goal

Change Monitoring Service from a single Nomad cluster configured through environment variables into a database-driven multi-cluster monitor. The service must monitor every cluster row registered in `clusters` independently, preserve existing incident isolation by `clusterId`, enrich existing API responses with cluster metadata, and enrich incident broadcast payloads with cluster metadata.

## Approved Architecture

The `clusters` table is the source of truth for both Nomad connection settings and cluster metadata. Monitoring Service reads cluster rows dynamically from MySQL when handling Nomad API requests and when executing pull cycles. A service restart is not required for changes to an existing cluster URL, token, name, site, application name, or environment to take effect.

All rows in `clusters` are monitored. No `enabled` column or cluster CRUD API is added in this scope.

A `NomadClient` is created from the selected cluster row for an operation. Global transport settings such as request timeout and TLS verification remain environment-driven.

## Database

### Table: `clusters`

Create migration `1786680900000-CreateClusters.ts` and entity `ClusterEntity`.

| Column | Type | Entity property | Rules |
|---|---|---|---|
| `cluster_id` | `BIGINT UNSIGNED` | `clusterId: string` | Primary key, manually assigned |
| `url` | `VARCHAR(512)` | `url: string` | Nomad base URL |
| `cluster_name` | `VARCHAR(255)` | `clusterName: string` | Required |
| `site` | `VARCHAR(255)` | `site: string` | Required |
| `app_name` | `VARCHAR(255)` | `appName: string` | Required |
| `env` | `ENUM('PRODUCTION','PREPRODUCTION')` | `env: ClusterEnvironment` | Required |
| `token` | `VARCHAR(512)` | `token: string` | Required, internal only |
| `created_at` | `TIMESTAMP(3)` | `createdAt` | Created timestamp |
| `updated_at` | `TIMESTAMP(3)` | `updatedAt` | Updated timestamp |

`cluster_id` is not auto-incremented because cluster IDs are assigned explicitly by operations when cluster rows are provisioned.

### Cluster provisioning

The migration **must not seed cluster data**. It creates only the `clusters` schema. Production cluster rows are inserted and maintained manually in MySQL after deployment.

The EAST/WEST values supplied during design are dummy examples only and must not be embedded in migration/runtime defaults. Tests may use two dummy cluster fixtures to verify multi-cluster behavior, but production logic must support any number of rows in `clusters`.

The migration revert drops `clusters`. No foreign keys are added to existing `incidents`, `monitoring_snapshots`, or `monitoring_current_states` tables in this scope.

## Cluster Module

Add an internal `src/modules/clusters/` module containing:

- `cluster.entity.ts` — TypeORM mapping for `clusters`.
- `cluster.enums.ts` — `PRODUCTION | PREPRODUCTION` environment enum.
- `cluster.repository.ts` — database access for all clusters, one cluster by ID, and metadata lookup by IDs.
- `cluster.types.ts` — public internal metadata shape.

Cluster metadata shape used by services:

```ts
interface ClusterMetadata {
  clusterId: string;
  clusterName: string;
  site: string;
  appName: string;
  env: "PRODUCTION" | "PREPRODUCTION";
}
```

The cluster token and URL are not part of `ClusterMetadata` and must not be serialized by API or webhook mappers.

Nomad API operations that explicitly request a missing cluster ID return HTTP 404 with code `CLUSTER_NOT_FOUND`. Existing database-backed incident, monitoring, and dashboard filters preserve their current empty/zero-result semantics when no records match the supplied `cluster` value.

## Environment Configuration

Remove the single-cluster connection settings from runtime configuration:

- `NOMAD_BASE_URL`
- `NOMAD_TOKEN`
- `NOMAD_CLUSTER_ID`

They are no longer the source of truth and must no longer be required or consumed by `src/config/env.ts` or `createNomadModule`.

Keep the global Nomad settings:

- `NOMAD_ENABLED`
- `NOMAD_PULL_CRON`
- `NOMAD_PULL_CRON_TZ`
- `NOMAD_PULL_RUN_ON_START`
- `NOMAD_REQUEST_TIMEOUT_MS`
- `NOMAD_TLS_REJECT_UNAUTHORIZED`
- `NOMAD_TLS_CA_FILE`

Update environment examples and documentation accordingly. Existing private `.env` values do not control cluster URL/token/ID after v2.0.0.

## Dynamic Nomad Client

`NomadClient` remains responsible only for Nomad HTTP transport. Connection values are supplied from `ClusterEntity`:

- `baseUrl = cluster.url`
- `token = cluster.token`

Global timeout/TLS settings are supplied from environment configuration.

The Nomad module no longer constructs one permanent client at startup. `NomadService` receives a cluster repository and a client factory so every operation resolves the current cluster row before contacting Nomad.

This guarantees that an updated URL/token in MySQL is used without restarting Monitoring Service.

## Multi-Cluster Pulling

### Scheduled pull

One existing cron schedule remains responsible for Nomad polling. At each tick:

1. Read all rows from `clusters` ordered by `cluster_id`.
2. Process every cluster independently.
3. For each cluster, construct its Nomad client and execute the existing node/allocation/blocked-evaluation observation flow.
4. Pass that cluster's `clusterId` into monitoring snapshots/current state, fingerprints, and incident creation/recovery.
5. If one cluster fails, log its failure and continue processing the remaining clusters.

The existing `node-cron` `noOverlap` behavior and worker running guard remain global so a new scheduled cycle does not start while the previous all-cluster cycle is still running.

### Incident isolation

Existing fingerprints already include `clusterId`; this behavior is retained. The same node/allocation/driver/evaluation identity observed in two different registered clusters therefore produces separate monitoring state and incidents.

### Manual pull

All EAST/WEST names and IDs shown in the JSON examples below are dummy fixture values for illustrating response shape only; they are not runtime defaults or migration data.

`POST /api/v1/nomad/pull?cluster=<id>` pulls only that cluster and returns the existing `NomadPullResult` fields plus cluster metadata at top level.

`POST /api/v1/nomad/pull` reads all clusters and processes each independently. The API outer envelope remains `{ success: true, data: ... }`; `data` is an array of per-cluster outcomes:

Successful item:

```json
{
  "clusterId": 1,
  "clusterName": "Cluster EAST",
  "site": "cawang",
  "appName": "Nomad East Lab App",
  "env": "PRODUCTION",
  "success": true,
  "result": {
    "startedAt": "...",
    "finishedAt": "...",
    "nodes": 0,
    "allocations": 0,
    "blockedEvaluations": 0,
    "snapshotChanges": 0,
    "failuresProcessed": 0,
    "recoveriesProcessed": 0
  }
}
```

Failed item:

```json
{
  "clusterId": 2,
  "clusterName": "Cluster WEST",
  "site": "tebet",
  "appName": "Nomad West Lab App",
  "env": "PRODUCTION",
  "success": false,
  "error": {
    "code": "NOMAD_UPSTREAM_ERROR",
    "message": "..."
  }
}
```

A failure for one cluster does not undo or skip successful processing for another cluster.

## Nomad API Contract

The optional query parameter is named `cluster` and contains `cluster_id`.

### List endpoints

Applies to:

- `GET /api/v1/nomad/nodes`
- `GET /api/v1/nomad/allocations`
- `GET /api/v1/nomad/allocations/failed`
- `GET /api/v1/nomad/evaluations/blocked`

Behavior:

- `?cluster=<id>` → query only the registered cluster with that ID.
- Examples may use fixture IDs `1` and `2`; these are not production defaults.
- no `cluster` → query all rows in `clusters`, flatten the existing Nomad item arrays into one array.

Each returned raw Nomad item is enriched with these top-level fields:

```json
{
  "clusterId": 1,
  "clusterName": "Cluster EAST",
  "site": "cawang",
  "appName": "Nomad East Lab App",
  "env": "PRODUCTION"
}
```

Existing raw Nomad fields remain unchanged. Cluster metadata is applied after raw fields so the service-controlled metadata values cannot be overwritten by an upstream property with the same name.

For an all-cluster read request, an upstream error from any selected cluster fails the HTTP request using the existing Nomad error handling. Partial read arrays are not returned. This preserves the existing success response shape; independent partial-success semantics are limited to pull operations.

### Detail endpoints

Applies to:

- `GET /api/v1/nomad/nodes/:nodeId`
- `GET /api/v1/nomad/allocations/:allocationId`
- `GET /api/v1/nomad/jobs/:jobId/summary`

With `?cluster=<id>`, query only that cluster and enrich the returned object with cluster metadata.

Without `cluster`, search all clusters:

- zero matches → HTTP 404, `NOMAD_RESOURCE_NOT_FOUND`;
- exactly one match → return the existing object enriched with cluster metadata;
- more than one match → HTTP 409, `NOMAD_RESOURCE_CLUSTER_AMBIGUOUS`.

To support this search, a Nomad upstream 404 for detail lookup is represented internally as a resource-not-found condition instead of a generic 502. Transport failures, timeouts, and non-404 upstream failures retain existing error semantics and stop the read request.

## Existing Monitoring API Enrichment

Existing filters remain unchanged. `cluster` stays optional and continues to filter by `cluster_id`.

### `GET /api/v1/monitoring/current`

Each item keeps its current fields and adds:

- `clusterName`
- `site`
- `appName`
- `env`

Existing `clusterId` remains unchanged.

### `GET /api/v1/monitoring/snapshots`

Each item keeps its current fields and adds the same four metadata fields. Existing `clusterId` remains unchanged.

Services must bulk-load metadata for the cluster IDs in a result set rather than issue one cluster query per row.

## Existing Incident API Enrichment

No incident database schema change is required because `incidents.cluster_id` already exists.

The following outputs add top-level cluster metadata while preserving existing fields:

- `GET /api/v1/incidents`
- `GET /api/v1/incidents/:incidentId`
- `GET /api/v1/dashboard/incidents/recent`
- `GET /api/v1/dashboard/incidents/resolved`

Fields:

```json
{
  "clusterId": 1,
  "clusterName": "Cluster EAST",
  "site": "cawang",
  "appName": "Nomad East Lab App",
  "env": "PRODUCTION"
}
```

`GET /api/v1/incidents/:incidentId` currently does not expose `clusterId`; v2.0.0 adds it together with the approved metadata.

ACK and POSTPONE action response shapes remain unchanged in this scope.

Incident and dashboard list services must bulk-load cluster metadata for returned incident rows.

## Dashboard Aggregate Behavior

The existing optional `cluster` query remains supported for:

- `GET /api/v1/dashboard/overview`
- `GET /api/v1/dashboard/health`

When omitted, they aggregate monitoring current state across all clusters. When supplied, they aggregate only the selected cluster.

`GET /api/v1/dashboard/incidents/summary` is extended to accept the same optional `cluster` query:

- no `cluster` → counts across all clusters;
- `?cluster=<id>` → counts only that cluster.

Aggregate response shapes stay unchanged and do not add one cluster metadata object, because an unfiltered aggregate can represent multiple clusters.

## Broadcast Webhook Enrichment

The existing `INCIDENT_ALERT` payload and ACK/POSTPONE metadata introduced in v1.9.4 remain unchanged.

Inside the existing `incident` object, add exactly these four fields:

```json
{
  "clusterName": "Cluster EAST",
  "site": "cawang",
  "appName": "Nomad East Lab App",
  "env": "PRODUCTION"
}
```

This applies to `INITIAL`, `REMINDER`, and `RESOLVED` broadcasts.

`url` and `token` are never included. No `clusterId` field is added to the webhook in this scope because the approved webhook addition is specifically `clusterName`, `site`, `appName`, and `env`.

The notifier resolves metadata from `incident.clusterId` before serializing. Both HTTP and console notifiers use the same cluster-aware payload serializer.

If an incident references a cluster row that does not exist, notification sending fails for that notification and is handled by the existing notifier error paths; the service must not fabricate metadata.

## Security

- `clusters.token` is used only as `X-Nomad-Token` for the matching upstream cluster.
- `token` is never returned by API responses, logs generated from serialized cluster metadata, or incident webhook payloads.
- `clusters.url` is internal connection configuration and is also not exposed through existing APIs/webhooks in this scope.

## Error Handling

Add/use these service-level errors where required:

- `CLUSTER_NOT_FOUND` — 404 when a Nomad API operation explicitly requests a cluster ID that is absent from `clusters`.
- `NOMAD_RESOURCE_NOT_FOUND` — 404 when a detail resource is absent from all selected clusters.
- `NOMAD_RESOURCE_CLUSTER_AMBIGUOUS` — 409 when an unscoped detail identifier matches more than one cluster.

Existing Nomad timeout and upstream error codes remain unchanged for transport/upstream failures other than detail 404 handling.

## Data Flow

### Scheduled monitoring

```text
cron
  -> ClusterRepository.findAll()
  -> for each cluster
       -> NomadClient(cluster.url, cluster.token, global TLS/timeout)
       -> fetch nodes + allocations + blocked evaluations
       -> MonitoringObservationService(cluster.clusterId)
       -> AlertingService(cluster.clusterId)
       -> incidents/current-state/snapshots remain cluster-isolated
```

### Existing API enrichment

```text
existing repository query
  -> collect clusterId values
  -> ClusterRepository metadata lookup
  -> existing mapper + clusterId/clusterName/site/appName/env
```

### Broadcast

```text
incident
  -> lookup clusters[incident.clusterId]
  -> existing INCIDENT_ALERT serializer
  -> add clusterName/site/appName/env
  -> console or HTTP webhook
```

## Testing Requirements

Implementation must use the existing `node:test` approach and add regression coverage without introducing a new test framework.

Required coverage:

1. Cluster metadata serializer never contains `url` or `token`.
2. Nomad list request scoped to a fixture `cluster=1` uses only that cluster client and enriches items.
3. Nomad list request without `cluster` combines items from all registered test clusters with correct metadata.
4. Unknown explicit cluster returns `CLUSTER_NOT_FOUND`.
5. Detail request without cluster returns the unique match.
6. Detail request without cluster returns 404 when no cluster matches.
7. Detail request without cluster returns 409 when more than one cluster matches.
8. All-cluster scheduled/manual pull continues processing remaining clusters when one cluster fails; regression tests verify both fixture failure directions.
9. Pull-created monitoring records/incidents retain the cluster ID of the cluster being processed.
10. Monitoring current/snapshot outputs add approved metadata and preserve existing fields.
11. Incident list/detail/dashboard recent/resolved outputs add approved metadata.
12. Dashboard summary cluster filter scopes counts correctly.
13. Webhook `INITIAL`, `REMINDER`, and `RESOLVED` include `clusterName`, `site`, `appName`, `env`.
14. Existing ACK/POSTPONE webhook metadata remains intact.
15. Build passes with the single-cluster Nomad environment requirements removed.

Where MySQL is available, run the migration against a clean test database and verify that `clusters` exists with the approved schema and contains zero rows immediately after migration. Production data insertion is an operations step outside the migration. Without MySQL in the execution environment, migration correctness is verified by TypeScript compilation and migration code review, and the limitation is reported explicitly.

## Documentation and Versioning

Implementation target is **2.0.0**.

Update:

- `package.json`
- `package-lock.json`
- `README.md`
- `CHANGELOG.md`
- Nomad API/puller documentation
- webhook payload documentation
- `.env.example` and Docker environment example files that document obsolete single-cluster Nomad variables
- Docker Compose image tags to `monitoring-service:2.0.0`

## Out of Scope

The following are intentionally not added:

- cluster CRUD endpoints;
- `enabled`/disabled cluster state;
- cluster-specific cron schedules;
- cluster-specific TLS settings;
- token encryption or a new secrets backend;
- new incident statuses or lifecycle behavior;
- changes to ACK/POSTPONE action response shapes;
- foreign keys from existing tables to `clusters`.

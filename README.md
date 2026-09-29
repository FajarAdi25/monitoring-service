# Monitoring Service v2.7.1

Node.js + TypeScript + TypeORM + PostgreSQL monitoring service for Nomad telemetry, SSL certificate expiry monitoring, current state, state-transition snapshots, and incident alerting.

## Current incident lifecycle

```text
Nomad Pull
  every 15 seconds
  active clusters only (clusters.is_active = true)
  noOverlap = true
  worker running guard = true

Failure
  -> OPEN
  -> INITIAL alert (status "firing") immediately
  -> REMINDER alert (status "firing"):
       CRITICAL every 1 minute
       MAJOR / WARNING every 5 minutes
       SSL_CERTIFICATE_EXPIRING every 24 hours

Recovery detected by monitoring engine
  -> OPEN -> RESOLVED
  -> RESOLVED alert (status "resolved") immediately
  -> next_notification_at = NULL
  -> OPEN reminders stop
```

There is no `CLOSED` status, no Close Case API, and no ACK/POSTPONE action in the current lifecycle.

## Setup

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

### Docker backend with external PostgreSQL

The Docker image contains only Monitoring Service. PostgreSQL runs separately and may be hosted on another server. Configure the database connection through `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, and `DB_NAME`.

Example database configuration:

```env
APP_PORT=3002
DB_HOST=10.10.10.20
DB_PORT=5432
DB_USERNAME=monitoring
DB_PASSWORD=CHANGE_ME
DB_NAME=monitoring
```

On container startup, Monitoring Service connects directly to the configured PostgreSQL server, applies pending TypeORM migrations, and then starts the API. The PostgreSQL server must already exist and accept network connections from the backend server. For a non-Docker backend, run `npm run db:migrate`. SSL monitoring is enabled per cluster through `clusters.ssl_monitoring`. Only active clusters with `ssl_monitoring = true` are checked for TLS certificate expiry.

## Important environment variables

```env
APP_PORT=3002

ALERTING_POLL_INTERVAL_MS=1000
ALERT_REMINDER_INTERVAL_MS=60000
ALERT_WEBHOOK_URL=http://10.59.179.182:8080/api/v1/webhook/alerts
ALERT_WEBHOOK_TOKEN=CHANGE_ME

NOMAD_ENABLED=true
NOMAD_PULL_CRON="*/15 * * * * *"
NOMAD_PULL_CRON_TZ=Asia/Jakarta
NOMAD_PULL_RUN_ON_START=true

MONITORING_BASIC_AUTH_USERNAME=CHANGE_ME
MONITORING_BASIC_AUTH_PASSWORD=replace-with-a-strong-random-password
```

`ALERT_WEBHOOK_TOKEN` is sent as `Authorization: Bearer <token>`. When `ALERT_WEBHOOK_URL` is empty, alerts are only logged to the console.

All API routes except `GET /api/v1/dashboard/health` require `Authorization: Basic base64(<MONITORING_BASIC_AUTH_USERNAME>:<MONITORING_BASIC_AUTH_PASSWORD>)`. Use HTTPS in production because Basic Auth is Base64 encoding, not encryption.

`NOMAD_PULL_CRON="*/15 * * * * *"` means one pull every 15 seconds. `NomadPullWorker` keeps both `noOverlap: true` and its own `running` guard.

## SSL certificate expiry monitoring

SSL certificate monitoring is opt-in per cluster through the `clusters.ssl_monitoring` flag. The PostgreSQL baseline defaults the flag to `false`, so a cluster is not monitored until it is explicitly enabled.

```sql
UPDATE clusters
SET ssl_monitoring = TRUE
WHERE cluster_id = <cluster_id>;
```

A cluster is checked only when all of the following are true:

- `clusters.is_active = TRUE`
- `clusters.ssl_monitoring = TRUE`
- its `ssl_monitoring` row does not exist yet, or `ssl_monitoring.is_active = TRUE`

To stop SSL checks for one cluster without deleting its inspection data:

```sql
UPDATE ssl_monitoring
SET is_active = FALSE
WHERE cluster_id = <cluster_id>;
```

The worker inspects the TLS certificate presented by the cluster `url` once on service startup and then every 24 hours. If the certificate has 30 days or less remaining, it creates or refreshes an `OPEN` incident with source `SSL`, type `SSL_CERTIFICATE_EXPIRING`, and severity `WARNING`. The existing alert webhook sends the INITIAL notification and then one REMINDER every 24 hours. When a renewed certificate has more than 30 days remaining, the incident is resolved and the existing RESOLVED webhook is sent.

The certificate inspection reads the peer certificate directly from the TLS handshake and does not require the HTTP response body. Trust-chain verification is disabled for this inspection so the expiry date can still be read from internally issued certificates.

## SSL monitoring API

```text
GET /api/v1/monitoring/ssl
```

The endpoint returns the latest persisted SSL inspection for each monitored cluster. Rows with `ssl_monitoring.is_active = FALSE` are excluded from this endpoint and from the SSL summary in `GET /api/v1/dashboard/overview`. `status` is calculated from `expiresAt` when the request is served:

- `EXPIRED`: the certificate expiry time has passed.
- `EXPIRING_SOON`: the certificate is still valid and has 30 days or less remaining.
- `VALID`: the certificate has more than 30 days remaining.

Example response:

```json
{
  "success": true,
  "data": [
    {
      "id": "1",
      "clusterId": "1",
      "clusterName": "cluster-a",
      "site": "site-a",
      "appName": "app-a",
      "env": "PRODUCTION",
      "status": "EXPIRING_SOON",
      "validFrom": "2026-06-01T00:00:00.000Z",
      "expiresAt": "2026-09-15T00:00:00.000Z",
      "daysRemaining": 19,
      "subjectCn": "example.internal",
      "issuerCn": "Internal CA",
      "certificateFingerprint256": "...",
      "lastCheckedAt": "2026-08-27T06:00:00.000Z"
    }
  ]
}
```

## Incident API

```text
GET    /api/v1/incidents
GET    /api/v1/incidents/:incidentId
```

## Alert webhook

Alerts follow the REINTAKE collector webhook contract v1.0 (`metric_source` `hashicorp`). Every INITIAL, REMINDER, and RESOLVED notification is one batch with one alert record, sent as one `POST` to `ALERT_WEBHOOK_URL`:

```http
POST /api/v1/webhook/alerts
Authorization: Bearer <ALERT_WEBHOOK_TOKEN>
Content-Type: application/json
```

Example (`NODE_DOWN`, INITIAL):

```json
{
  "schema_version": "1.0",
  "batch_id": "0f5b2f0e-6a7e-4a5c-9a57-2b8f5a1c3d4e",
  "metric_source": "hashicorp",
  "collector": {
    "name": "hashicorp-metric-collector",
    "version": "2.7.1",
    "source_instance": "Cluster WEST",
    "runtime_host": "monitoring-service-host"
  },
  "delivery_mode": "push",
  "sent_at_ms": 1790000000000,
  "record_count": 1,
  "alerts": [
    {
      "alert_id": "HCP-A-3f1c9a7b2e4d5c6a8b9e0f1a",
      "fingerprint": "hashicorp|nomad_node|9d2e7c1a-4b3f-4e8a-9c1d-2e3f4a5b6c7d|node_down",
      "metric_source": "hashicorp",
      "source_alert_id": "INC-1790000000000-ABC123",
      "status": "firing",
      "severity": "critical",
      "category": "platform",
      "title": "NODE_DOWN - nomadclientwest2",
      "description": "Nomad node nomadclientwest2 is down.",
      "started_at_ms": 1789999990000,
      "updated_at_ms": 1790000000000,
      "resolved_at_ms": null,
      "entity": {
        "type": "nomad_node",
        "name": "nomadclientwest2",
        "host_key": "nomadclientwest2",
        "source_id": "9d2e7c1a-4b3f-4e8a-9c1d-2e3f4a5b6c7d",
        "ip": "10.30.0.22"
      },
      "trigger": null,
      "dimensions": {
        "cluster": "Cluster WEST",
        "site": "cawang",
        "app": "Nomad West",
        "env": "PRODUCTION",
        "datacenter": "dc-west",
        "node_pool": "default"
      },
      "context": {
        "node_id": "9d2e7c1a-4b3f-4e8a-9c1d-2e3f4a5b6c7d",
        "status": "down",
        "status_description": "Node heartbeat missed"
      }
    }
  ]
}
```

Field mapping:

| Field | Value |
|---|---|
| `batch_id` | New UUID v4 per batch; a retry resends the same batch unchanged |
| `collector.version` | `package.json` version |
| `collector.source_instance` | Cluster name (max 120 chars) |
| `collector.runtime_host` | Hostname of the Monitoring Service process (max 120 chars) |
| `delivery_mode` | INITIAL / RESOLVED = `push`, REMINDER = `poll_reconcile` |
| `alert_id` | `HCP-A-` + 24 lowercase hex chars, stable per incident (INITIAL, REMINDER, and RESOLVED share it) |
| `fingerprint` | `hashicorp\|<entity.type>\|<resource key>\|<incident type lowercase>` |
| `source_alert_id` | Incident public id (`INC-...`) |
| `status` | INITIAL / REMINDER = `firing`, RESOLVED = `resolved` |
| `severity` | `critical`, `major`, or `warning` |
| `category` | `platform` |
| `title` | `<incident type> - <resource name>` (max 512 chars) |
| `description` | Incident message (max 4,096 chars) |
| `started_at_ms` | `opened_at` in epoch ms |
| `updated_at_ms` | firing: `last_detected_at`; resolved: `resolved_at` (always newer than the last firing record) |
| `resolved_at_ms` | `null` while firing, `resolved_at` when resolved |
| `entity.type` | NODE / DRIVER = `nomad_node`, ALLOCATION / EVALUATION = `other`, SSL = `cluster` |
| `entity.name` | Resource name (max 256 chars) |
| `entity.host_key` | NODE / DRIVER: node name, lowercase, up to the first dot; otherwise `""` |
| `entity.source_id` | Resource key (Nomad ID) |
| `entity.ip` | Nomad node address for NODE and DRIVER; omitted when not available |
| `trigger` | `null` (this service does not evaluate metric thresholds) |
| `dimensions` | `cluster`, `site`, `app`, `env`; NODE also `datacenter` and `node_pool` when available |
| `context` | Selected string values per resource type (see below) |

`dimensions` and `context` are string-to-string maps (max 20 keys, values max 256 chars). Empty values are omitted.

| Resource type | `context` keys |
|---|---|
| NODE | `node_id`, `status`, `status_description` |
| DRIVER | `node_id`, `node_name`, `driver`, `health_description` |
| ALLOCATION | `namespace`, `job_id`, `task_group`, `slot`, `allocation_id`, `node_name`, `client_status`, `client_description` |
| EVALUATION | `evaluation_id`, `job_id`, `namespace`, `status`, `status_description` |
| SSL | `endpoint`, `valid_from`, `expires_at`, `days_remaining`, `subject_cn`, `issuer_cn`, `certificate_fingerprint256` |

REINTAKE forwards a Telegram message only once per `alert_id` + `status` + `severity`, so REMINDER batches are stored by REINTAKE but do not create new Telegram messages. A severity change does.

### Delivery and retry

Alerts are queued in `alert_deliveries` and sent by the alerting worker (every `ALERTING_POLL_INTERVAL_MS`). The stored payload, including `batch_id`, is resent unchanged on retry. Response handling follows the contract (section 7.4):

| REINTAKE response | Result |
|---|---|
| `202` | `SENT`. Rejected records from `errors` are logged and stored in `last_error` |
| `200` (duplicate) | `SENT` |
| `503` | Retry after `Retry-After` seconds (default 5) |
| `500` or network error / timeout | Retry with backoff: 5s, 10s, 20s, ... up to 5 minutes |
| `400`, `401`, `403`, `413`, `415`, other | `FAILED`, not retried; logged with the response body |

Retries continue until the batch is `SENT` or `FAILED`, so a RESOLVED alert is not lost while REINTAKE is unavailable.

## Monitoring data

```text
monitoring_current_states
  current state per resource
  refreshed on every successful observation
  last_checked_at is updated on pulls

monitoring_snapshots
  immutable state-transition history
  inserted only when state changes
```

API:

```text
GET /api/v1/monitoring/current
GET /api/v1/monitoring/snapshots
```

Monitoring and incident responses preserve their existing `clusterId` and add `clusterName`, `site`, `appName`, and `env`.

## Nomad multi-cluster registry and API

Nomad connection data is loaded from the `clusters` table. The migration creates the schema only; operations inserts production rows manually. Runtime supports any number of registered clusters. `url` and `token` are internal and are never exposed through existing APIs or webhooks.

Clusters can be disabled without deleting data:

```sql
UPDATE clusters
SET is_active = FALSE
WHERE cluster_id = <cluster_id>;
```

When `clusters.is_active = FALSE`:

- the cluster is skipped by the Nomad pull, the SSL certificate check, and the Nomad API (`?cluster=<id>` returns `CLUSTER_NOT_FOUND`);
- reminders for its OPEN incidents are paused; the incident status is not changed;
- existing incidents, current states, snapshots, and SSL data stay in the database and remain visible in the incident, monitoring, and dashboard APIs.

Setting `is_active = TRUE` again resumes monitoring. A paused OPEN incident whose reminder is overdue sends its next REMINDER on the next alerting worker tick.

```text
GET  /api/v1/nomad/nodes?cluster=1
GET  /api/v1/nomad/nodes
GET  /api/v1/nomad/nodes/:nodeId?cluster=1
GET  /api/v1/nomad/allocations?cluster=1
GET  /api/v1/nomad/allocations/failed?cluster=1
GET  /api/v1/nomad/allocations/:allocationId?cluster=1
GET  /api/v1/nomad/jobs/:jobId/summary?cluster=1
GET  /api/v1/nomad/evaluations/blocked?cluster=1
POST /api/v1/nomad/pull?cluster=1
POST /api/v1/nomad/pull
```

`cluster` is optional. List endpoints without it flatten results from all active clusters and add `clusterId`, `clusterName`, `site`, `appName`, and `env` to each item. Unscoped detail lookup returns `NOMAD_RESOURCE_NOT_FOUND` when no cluster matches and `NOMAD_RESOURCE_CLUSTER_AMBIGUOUS` when more than one cluster matches. All-cluster pull returns one success/error outcome per cluster and continues when one cluster fails.

## Dashboard API

```text
GET /api/v1/dashboard/overview
GET /api/v1/dashboard/health
GET /api/v1/dashboard/incidents/summary
GET /api/v1/dashboard/incidents/recent
GET /api/v1/dashboard/incidents/resolved
```

`/dashboard/overview` and `/dashboard/health` read from `monitoring_current_states`.
The incident dashboard uses the current lifecycle only: `OPEN -> RESOLVED`. `/dashboard/incidents/summary` returns `open.total`, `resolved.today`, `resolved.last24Hours`, `bySeverity`, and `byType`.

## Nomad severity mapping

Severity untuk incident Nomad bersifat fixed pada release ini:

```text
NODE_DOWN           -> CRITICAL
ALLOCATION_FAILED   -> MAJOR
EVALUATION_BLOCKED  -> MAJOR
DRIVER_UNHEALTHY    -> WARNING
```

Nilai severity tidak lagi diambil dari environment variable.

## Docker backend deployment

Monitoring Service runs as a plain Docker container started with `docker run`. Docker Compose is not used. PostgreSQL is not part of the backend image; the backend connects to it over the network using the database environment variables.

| Environment | Monitoring Service | PostgreSQL | Environment file |
|---|---|---|---|
| Local | Docker | Separate Docker container on the same host | `.env.docker.local` |
| Dev | Docker | Separate server | `.env.docker.dev` |

Build the backend image:

```bash
docker build -t monitoring-service:2.7.1 .
```

### Local

`.env.docker.local` reaches PostgreSQL through `host.docker.internal`, so the PostgreSQL container must publish its port on the host.

```bash
docker run -d \
  --name monitoring-service \
  --restart unless-stopped \
  --init \
  --add-host=host.docker.internal:host-gateway \
  --env-file .env.docker.local \
  -p 127.0.0.1:3001:3002 \
  monitoring-service:2.7.1
```

### Dev

`.env.docker.dev` points `DB_HOST`/`DB_PORT` to the separate PostgreSQL server.

```bash
docker run -d \
  --name monitoring-service \
  --restart unless-stopped \
  --init \
  --env-file .env.docker.dev \
  -p 3001:3002 \
  monitoring-service:2.7.1
```

Check the backend logs:

```bash
docker logs -f monitoring-service
```

The startup command runs pending TypeORM migrations against the configured PostgreSQL database before starting the API. The database server must be reachable from the Docker host, PostgreSQL must allow the backend server IP through its network/firewall and `pg_hba.conf` configuration, and the configured database user must have permission to apply the baseline migration on a fresh database.

### Transfer backend image to another machine

Save only the backend image:

```bash
docker save -o monitoring-service-2.7.1.tar monitoring-service:2.7.1
```

Copy `monitoring-service-2.7.1.tar` to the destination server, then load it:

```bash
docker load -i monitoring-service-2.7.1.tar
```

Run it on the destination server with the `docker run` command for that environment (see Local or Dev above).

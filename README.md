# Monitoring Service v2.5.0

Node.js + TypeScript + TypeORM + MySQL monitoring service for Nomad telemetry, SSL certificate expiry monitoring, current state, state-transition snapshots, incident alerting, ACK, and POSTPONE.

## SSL Alert Webhook Context

For `SSL_CERTIFICATE_EXPIRING` incidents, the webhook payload includes `incident.contextJson` with the SSL inspection context already stored on the incident:

```json
{
  "endpoint": "https://cluster.example",
  "validFrom": "2026-01-01T00:00:00.000Z",
  "expiresAt": "2026-09-15T00:00:00.000Z",
  "daysRemaining": 19,
  "subjectCn": "cluster.example",
  "issuerCn": "Example CA",
  "certificateFingerprint256": "..."
}
```

Non-SSL incident webhook payloads are unchanged.

## Current incident lifecycle

`POSTPONE` and `ACK` are metadata/actions, not statuses.

```text
Nomad Pull
  every 15 seconds
  noOverlap = true
  worker running guard = true

Failure
  -> OPEN
  -> INITIAL webhook immediately
  -> REMINDER every 1 minute

ACK
  -> status stays OPEN or RESOLVED
  -> acknowledgement metadata is stored
  -> reminder behavior is unchanged

POSTPONE (OPEN only)
  -> status stays OPEN
  -> INITIAL is never postponed
  -> OPEN reminders are deferred until postponeUntil
  -> after postponeUntil, REMINDER resumes every 1 minute
  -> requester, request timestamp, postponeUntil, and remark are stored

Recovery detected by monitoring engine
  -> OPEN -> RESOLVED
  -> RESOLVED webhook immediately
  -> next_notification_at = NULL
  -> OPEN reminders stop
```

There is no `CLOSED` status and no Close Case API in the current lifecycle.

## Setup

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

### Windows Docker local

Current local Docker mapping is `localhost:3001 -> container:3002`. MySQL and Telegram Bot run natively on Windows; the container reaches them through `host.docker.internal`. Use `.env.docker.local` and `compose.local.yml`.

```powershell
docker compose --env-file .env.docker.local -f compose.local.yml up -d --build
```

For an existing database, run `npm run db:migrate`. SSL monitoring is enabled per cluster through `clusters.ssl_monitoring`. Only clusters with `ssl_monitoring = true` are checked for TLS certificate expiry.

## Important environment variables

```env
APP_PORT=3000

ALERTING_POLL_INTERVAL_MS=1000
ALERT_REMINDER_INTERVAL_MS=60000
ALERT_WEBHOOK_URL=http://127.0.0.1:3000/api/v1/webhooks/telegram/dummy

NOMAD_ENABLED=true
NOMAD_PULL_CRON="*/15 * * * * *"
NOMAD_PULL_CRON_TZ=Asia/Jakarta
NOMAD_PULL_RUN_ON_START=true

MONITORING_BASIC_AUTH_USERNAME=telegram-bot
MONITORING_BASIC_AUTH_PASSWORD=replace-with-a-strong-random-password
```

`NOMAD_PULL_CRON="*/15 * * * * *"` means one pull every 15 seconds. `NomadPullWorker` keeps both `noOverlap: true` and its own `running` guard.

## SSL certificate expiry monitoring

SSL certificate monitoring is opt-in per cluster through the `clusters.ssl_monitoring` flag. The migration defaults the flag to `false`, so existing clusters are not monitored until explicitly enabled.

```sql
UPDATE clusters
SET ssl_monitoring = 1
WHERE cluster_id = <cluster_id>;
```

The worker inspects the TLS certificate presented by the cluster `url` once on service startup and then every 24 hours. If the certificate has 30 days or less remaining, it creates or refreshes an `OPEN` incident with source `SSL`, type `SSL_CERTIFICATE_EXPIRING`, and severity `WARNING`. The existing alert webhook sends the INITIAL notification and then one REMINDER every 24 hours. When a renewed certificate has more than 30 days remaining, the incident is resolved and the existing RESOLVED webhook is sent.

The certificate inspection reads the peer certificate directly from the TLS handshake and does not require the HTTP response body. Trust-chain verification is disabled for this inspection so the expiry date can still be read from internally issued certificates.

## SSL monitoring API

```text
GET /api/v1/monitoring/ssl
```

The endpoint returns the latest persisted SSL inspection for each monitored cluster. `status` is calculated from `expiresAt` when the request is served:

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
POST   /api/v1/incidents/:incidentId/acknowledge
# ACK is one-way in MVP; there is no unacknowledge action.
POST   /api/v1/incidents/:incidentId/postpone
```

### Telegram Bot Service authentication

ACK and POSTPONE are protected by service-to-service authentication:

```http
Authorization: Basic base64(<MONITORING_BASIC_AUTH_USERNAME>:<MONITORING_BASIC_AUTH_PASSWORD>)
```

The Telegram user identity is supplied in the request body and normalized into `req.user`.
`user.id` and `user.name` are required. `user.username` is optional.
The user identity is trusted only after the Telegram Bot Service Basic credentials are valid. Use HTTPS in production because Basic Auth is Base64 encoding, not encryption.

### ACK request

```http
POST /api/v1/incidents/:incidentId/acknowledge
Authorization: Basic base64(<MONITORING_BASIC_AUTH_USERNAME>:<MONITORING_BASIC_AUTH_PASSWORD>)
Content-Type: application/json
```

```json
{
  "user": {
    "id": "123456789",
    "name": "Budi Santoso",
    "username": "budi_ops"
  },
  "note": "Sedang dicek"
}
```

### Postpone request

```http
POST /api/v1/incidents/:incidentId/postpone
Authorization: Basic base64(<MONITORING_BASIC_AUTH_USERNAME>:<MONITORING_BASIC_AUTH_PASSWORD>)
Content-Type: application/json
```

```json
{
  "user": {
    "id": "123456789",
    "name": "Budi Santoso",
    "username": "budi_ops"
  },
  "postponeUntil": "2026-08-16T13:30:00+07:00",
  "remark": "Menunggu maintenance selesai"
}
```

`postponedAt` is generated by Monitoring Service. User id, name, and optional username are persisted as the user identity snapshot for ACK/POSTPONE.

Example response:

```json
{
  "success": true,
  "data": {
    "id": "INC-00123",
    "status": "OPEN",
    "postponed": true,
    "postponedAt": "2026-08-16T04:20:00.000Z",
    "postponedBy": {
      "id": 123456789,
      "name": "Budi Santoso",
      "username": "budi_ops"
    },
    "postponeUntil": "2026-08-16T06:30:00.000Z",
    "postponeRemark": "Menunggu maintenance selesai",
    "nextNotificationAt": "2026-08-16T06:30:00.000Z"
  }
}
```

`postponeUntil` must be in the future. A `RESOLVED` incident cannot be postponed.

## Webhook notifications

The alert webhook kinds are:

```text
INITIAL
REMINDER
RESOLVED
```

Example:

```json
{
  "event": "INCIDENT_ALERT",
  "kind": "RESOLVED",
  "incident": {
    "id": "INC-00123",
    "status": "RESOLVED",
    "source": "NOMAD",
    "type": "DRIVER_UNHEALTHY",
    "severity": "WARNING",
    "resource": {
      "type": "DRIVER",
      "key": "node-id:docker",
      "name": "nomadworker-east-4/docker"
    },
    "message": "Docker driver unhealthy",
    "clusterName": "Cluster EAST",
    "site": "cawang",
    "appName": "Nomad East Lab App",
    "env": "PRODUCTION",
    "openedAt": "2026-08-16T03:00:00.000Z",
    "resolvedAt": "2026-08-16T03:17:30.000Z",
    "reminderCount": 3,
    "acknowledgedAt": "2026-08-16T03:05:00.000Z",
    "acknowledgedByUserName": "Budi Santoso",
    "acknowledgementNote": "Sedang dicek",
    "postponedAt": "2026-08-16T03:10:00.000Z",
    "postponedByUserName": "Budi Santoso",
    "postponeUntil": "2026-08-16T04:00:00.000Z",
    "postponeRemark": "Menunggu maintenance selesai"
  }
}
```

ACK metadata is included only after the incident has been acknowledged. POSTPONE metadata is included only after the incident has been postponed. These metadata fields are included in subsequent `REMINDER` and `RESOLVED` webhook broadcasts when present.

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

`cluster` is optional. List endpoints without it flatten results from all registered clusters and add `clusterId`, `clusterName`, `site`, `appName`, and `env` to each item. Unscoped detail lookup returns `NOMAD_RESOURCE_NOT_FOUND` when no cluster matches and `NOMAD_RESOURCE_CLUSTER_AMBIGUOUS` when more than one cluster matches. All-cluster pull returns one success/error outcome per cluster and continues when one cluster fails.

## Dashboard API

```text
GET /api/v1/dashboard/overview
GET /api/v1/dashboard/health
GET /api/v1/dashboard/incidents/summary
GET /api/v1/dashboard/incidents/recent
GET /api/v1/dashboard/incidents/resolved
```

`/dashboard/overview` and `/dashboard/health` read from `monitoring_current_states`.
The incident dashboard uses the current lifecycle only: `OPEN -> RESOLVED`, with ACK and POSTPONE as metadata/actions. See `docs/DASHBOARD_API.md`.

The old PRD v1.4 is retained under `docs/` as historical source material. The lifecycle in this README and `docs/LIFECYCLE_POSTPONE.md` supersedes its Close Case sections for this project revision.

## Nomad severity mapping

Severity untuk incident Nomad bersifat fixed pada release ini:

```text
NODE_DOWN           -> CRITICAL
ALLOCATION_FAILED   -> MAJOR
EVALUATION_BLOCKED  -> MAJOR
DRIVER_UNHEALTHY    -> WARNING
```

Nilai severity tidak lagi diambil dari environment variable.

## Docker testing deployment

Docker runs **only Monitoring Service**. MySQL remains the existing host/server installation and is not created by Compose. Pending migrations are applied by the Monitoring Service container before the API starts.

Docker deployment files are available for Windows local testing and Linux development servers.

See [`docs/DOCKER_DEPLOYMENT.md`](docs/DOCKER_DEPLOYMENT.md).

Local Windows quick start:

```powershell
Copy-Item .env.docker.local.example .env.docker.local
docker compose --env-file .env.docker.local -f compose.local.yml up -d --build
```

Linux development quick start:

```bash
cp .env.docker.dev.example .env.docker.dev
chmod 600 .env.docker.dev
docker compose --env-file .env.docker.dev -f compose.dev.yml up -d --build
```

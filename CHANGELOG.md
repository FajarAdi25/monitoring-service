# v2.0.0 - Database-Driven Multi-Cluster Nomad Monitoring

- Added schema-only `clusters` registry; production cluster rows are provisioned manually and no dummy cluster data is seeded.
- Nomad reads and scheduled/manual pulls now resolve any number of clusters dynamically from MySQL.
- Added optional `cluster` scoping, flattened all-cluster list responses, deterministic unscoped detail 404/409 behavior, and per-cluster pull outcomes.
- Added `clusterName`, `site`, `appName`, and `env` to approved monitoring/incident API outputs and incident webhook broadcasts.
- Removed runtime consumption of `NOMAD_BASE_URL`, `NOMAD_TOKEN`, and `NOMAD_CLUSTER_ID`; URL/token remain internal database fields.
- Updated Monitoring Service and Compose image version to `2.0.0`.

# v1.9.6 - Compose Configuration Alignment

- Applied the Monitoring Service container configuration consistently to `docker-compose.yml`, `compose.local.yml`, and `compose.dev.yml`.
- Added `container_name: monitoring-service` to the local compose definitions.
- Updated all Monitoring Service image tags to `monitoring-service:1.9.6`.
- Preserved each compose file's existing environment file and host bind behavior.
- No application behavior or database schema changes.

# v1.9.5 - Development Compose Configuration

- Updated `compose.dev.yml` for the development Monitoring Service container.
- Added `container_name: monitoring-service`.
- Updated the development image tag to `monitoring-service:1.9.5`.
- No application behavior or database schema changes.

# v1.9.4 - Incident Action Metadata in Alert Webhook

- Subsequent webhook broadcasts include ACK metadata when an incident has been acknowledged: `acknowledgedAt`, `acknowledgedByUserName`, and `acknowledgementNote`.
- Subsequent webhook broadcasts include POSTPONE metadata when an incident has been postponed: `postponedAt`, `postponedByUserName`, `postponeUntil`, and `postponeRemark`.
- ACK/POSTPONE lifecycle behavior and database schema are unchanged.

# v1.9.3 - Local Docker Port Alignment

- Windows host exposes Monitoring Service on port `3001`.
- Monitoring Service listens on port `3002` inside Docker.
- Telegram Bot Service is expected on Windows host port `3004`.
- Local Docker DB host uses `host.docker.internal` for native Windows MySQL.
- Alert webhook uses `http://host.docker.internal:3004/webhooks/alerts`.
- Basic Auth environment names aligned to `MONITORING_BASIC_AUTH_USERNAME` and `MONITORING_BASIC_AUTH_PASSWORD`.
- Added ignored `.env.docker.local` generated from the provided local environment and adapted for Docker networking.

# 1.9.3 - External MySQL Docker

- Docker Compose now runs only `monitoring-service`; MySQL is external.
- Windows local MySQL uses `host.docker.internal`.
- Linux same-host MySQL uses `host.docker.internal` mapped through `host-gateway`; remote DB DNS/IP is also supported.
- Removed MySQL service, volume, root password, and dedicated migration service from Compose.
- Pending migrations run inside Monitoring Service before the server starts.
- Updated Docker deployment documentation and environment examples.

# Changelog

## 1.8.1

- Replaced Telegram Bot Service Bearer authentication with HTTP Basic Authentication for ACK and POSTPONE.
- Added `MONITORING_BASIC_AUTH_USERNAME` and `MONITORING_BASIC_AUTH_PASSWORD`.
- Removed `TELEGRAM_BOT_SERVICE_TOKEN`.
- Telegram user identity contract in `body.user` is unchanged.
- Authentication still runs before Telegram user payload validation.
- No database migration is required for this release.

## 1.8.0

- Added Telegram Bot Service authentication for incident ACK and POSTPONE using `Authorization: Bearer <TELEGRAM_BOT_SERVICE_TOKEN>`.
- ACK and POSTPONE now require `body.user.id` and `body.user.name`; `body.user.username` is optional.
- Telegram user payload is normalized into `req.user` only after service authentication succeeds.
- ACK remains idempotent and preserves the first user identity.
- POSTPONE remains last-write-wins and persists the latest user identity.
- Added persisted user name/username snapshots for ACK and POSTPONE.
- Added migration `1786680800000-AddIncidentUserIdentity.ts`.
- No identity terminology using the previous naming exists in the project.

## 1.7.3

- Standardized request identity terminology project-wide to `User`.
- Request identity is exposed as `req.user`.
- Identity middleware is `userMiddleware` in `user.middleware.ts`.
- Environment identity configuration is available under `env.user`.
- Mapper and service identity parameters use `user` / `currentUser`.
- No incident lifecycle or database behavior changed in this release.

## 1.7.2

- Restored `open.unacknowledged` in `GET /api/v1/dashboard/incidents/summary`.
- Removed the `DELETE /api/v1/incidents/:incidentId/acknowledge` unacknowledge action.
- ACK remains a one-way action in the MVP; acknowledgement metadata is retained until the incident resolves.

## 1.7.1

- Removed the `unacknowledged` counter from `GET /api/v1/dashboard/incidents/summary`.
- ACK behavior and incident acknowledgement data are unchanged.

## 1.7.0 - Dashboard MVP cleanup

- Added `GET /api/v1/dashboard/overview` backed by `monitoring_current_states`.
- Added `GET /api/v1/dashboard/health`.
- Incident summary now reports OPEN acknowledged/postponed counters and RESOLVED today/last-24-hours counters.
- Recent incidents support `cluster`, `source`, `status`, `severity`, `type`, `acknowledged`, `postponed`, and `limit`.
- Resolved history supports filtering and pagination, sorted by `resolved_at DESC`.
- Dashboard no longer exposes any Close Case / CLOSED queue semantics.

## 1.6.1

- Added strict incident severity levels: `CRITICAL`, `MAJOR`, and `WARNING`.
- Fixed Nomad severity mapping: `NODE_DOWN=CRITICAL`, `ALLOCATION_FAILED=MAJOR`, `EVALUATION_BLOCKED=MAJOR`, `DRIVER_UNHEALTHY=WARNING`.
- Removed Nomad severity overrides from environment configuration so the mapping is deterministic.
- Existing OPEN incidents refresh their severity on subsequent failure observations.
- Added a migration to normalize existing Nomad incident severity records.

## 1.6.0

- Removed `CLOSED` from the active incident lifecycle.
- Removed Close Case API and closure reminder behavior.
- Added `POST /api/v1/incidents/:incidentId/postpone`.
- Added `postponed_at`, `postponed_by`, `postpone_until`, and `postpone_remark`.
- POSTPONE keeps incident status `OPEN`.
- POSTPONE affects OPEN reminders only. INITIAL notification remains immediate.
- Recovery during POSTPONE immediately produces `RESOLVED` and a RESOLVED webhook.
- OPEN reminder interval remains 1 minute.
- Nomad pull schedule remains every 15 seconds.
- Nomad `noOverlap: true` and worker running guard remain enabled.
- Added migration `1786680600000-ReplaceCloseWithPostpone.ts` for existing databases.
- Existing `CLOSED` records are normalized to `RESOLVED` during migration.

## 1.5.0

- Added RESOLVED webhook and closure reminder support. Closure behavior is superseded by v1.6.0.

## 1.9.0 - Docker testing deployment

- Added a multi-stage `Dockerfile` for compiled Node.js runtime deployment.
- Added `compose.local.yml` for Windows Docker Desktop testing.
- Added `compose.dev.yml` for Linux development server deployment.
- Added automatic one-shot TypeORM migration service before application startup.
- Added MySQL and application health checks.
- Added local/development Docker environment templates.
- Added optional Nomad CA certificate mount under `docker/certs`.
- Added compiled migration/revert npm scripts.
- Added Docker deployment documentation.
- Nomad polling remains every 15 seconds with `noOverlap` and worker running guard unchanged.

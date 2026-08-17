# Nomad Data Puller

This project pulls Nomad data and feeds normalized monitoring conditions into the existing incident and alerting lifecycle.

## Upstream Nomad requests

The service implements the request set supplied in the Hashicorp Nomad Telemetry Postman collection:

```text
GET /v1/nodes
GET /v1/node/:nodeId
GET /v1/allocations
GET /v1/allocations?filter=ClientStatus=="failed"
GET /v1/allocation/:allocationId
GET /v1/job/:jobId/summary
GET /v1/evaluations?filter=Status=="blocked"
```

The automatic worker uses the global list endpoints required for state monitoring:

```text
GET /v1/nodes
GET /v1/allocations
GET /v1/evaluations?filter=Status=="blocked"
```

Node and allocation detail plus job summary remain available through the HTTP API for on-demand access.

## Runtime flow

```text
Nomad API
   |
   v
Nomad cron scheduler
   |
   v
NomadPullWorker
   |
   v
NomadService.pullOnce()
   |
   +--> normalize monitored state
   |
   +--> save monitoring_snapshots only if state changed
   |
   +--> failure condition --> AlertingService.processFailure()
   |
   +--> recovery condition -> AlertingService.processRecovery()
```

## Conditions

Implemented conditions:

```text
NODE_DOWN
  Node.Status == "down"

DRIVER_UNHEALTHY
  Driver.Detected == true AND Driver.Healthy == false

ALLOCATION_FAILED
  Allocation.ClientStatus == "failed"

EVALUATION_BLOCKED
  Evaluation returned by the blocked evaluation query
```

A driver with `Detected=false` is stored as `NOT_DETECTED` and does not open a `DRIVER_UNHEALTHY` incident.

For blocked evaluations, the upstream request only returns evaluations whose status is currently `blocked`. If a previously blocked evaluation is no longer returned, the monitoring condition is treated as no longer blocked, its open incident is resolved, and a `NOT_BLOCKED` snapshot is recorded.

## Snapshot behavior

Table:

```text
monitoring_snapshots
```

A snapshot is inserted only when the normalized state changes for the same:

```text
cluster_id + source + resource_type + resource_key
```

Repeated polling with the same state does not create another snapshot.

Examples:

```text
NODE
READY -> READY      no new snapshot
READY -> DOWN       new snapshot
DOWN  -> DOWN       no new snapshot
DOWN  -> READY      new snapshot
```

The alerting layer still updates `last_detected_at` while a failure remains active.

## Service API

Nomad proxy/read endpoints:

```text
GET /api/v1/nomad/nodes
GET /api/v1/nomad/nodes/:nodeId

GET /api/v1/nomad/allocations
GET /api/v1/nomad/allocations/failed
GET /api/v1/nomad/allocations/:allocationId

GET /api/v1/nomad/jobs/:jobId/summary
GET /api/v1/nomad/evaluations/blocked
```

Manual pull:

```text
POST /api/v1/nomad/pull
```

Manual pull requires `ADMIN`.

Snapshots:

```text
GET /api/v1/monitoring/snapshots
```

Supported snapshot filters:

```text
cluster
source
resourceType
resourceKey
limit
```

## Configuration

```env
NOMAD_ENABLED=true
NOMAD_BASE_URL=http://127.0.0.1:4646
NOMAD_TOKEN=
NOMAD_CLUSTER_ID=1
NOMAD_PULL_CRON="*/15 * * * * *"
NOMAD_PULL_CRON_TZ=Asia/Jakarta
NOMAD_PULL_RUN_ON_START=true
NOMAD_REQUEST_TIMEOUT_MS=10000
```

`NOMAD_BASE_URL` must include the URL scheme.

The supplied Postman collection contains an `X-Nomad-Token`. The project intentionally does not embed that value. Set the runtime token through `NOMAD_TOKEN`.

## Severity

PRD Revision v1.4 does not define a complete severity matrix for all Nomad conditions, so severity values are environment configuration rather than fixed business rules:

```env
```


## Cron scheduler

Automatic pulling is scheduled in-process with `node-cron`. The default schedule is every 15 seconds:

```env
NOMAD_PULL_CRON="*/15 * * * * *"
NOMAD_PULL_CRON_TZ=Asia/Jakarta
NOMAD_PULL_RUN_ON_START=true
```

`NOMAD_PULL_RUN_ON_START=true` triggers one immediate pull when the HTTP server is ready. Scheduled executions then follow the cron expression.

The worker enables overlap prevention. If a scheduled pull has not finished when the next cron slot arrives, that slot is skipped rather than creating a second concurrent pull. `NomadService.pullOnce()` also keeps its existing pull lock so manual and scheduled pulls cannot execute the same pull pipeline concurrently.

## Transport troubleshooting

Cluster-wide allocation polling uses:

```text
GET /v1/allocations?namespace=*&task_states=false
```

This intentionally excludes `TaskStates` from the list response. Allocation detail remains available through `GET /api/v1/nomad/allocations/:allocationId` when detailed task events are needed.

For HTTPS Nomad clusters, certificate verification is enabled by default:

```env
NOMAD_TLS_REJECT_UNAUTHORIZED=true
NOMAD_TLS_CA_FILE=
```

For an internal CA, prefer setting `NOMAD_TLS_CA_FILE` to the CA certificate path. `NOMAD_TLS_REJECT_UNAUTHORIZED=false` is available only for local/test environments where the certificate cannot yet be trusted.

Nomad transport errors now include the failing path and the underlying network/TLS error code, for example `ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`, or a TLS certificate error.


## Allocation failure identity and recovery

`ALLOCATION_FAILED` is tracked by the logical allocation slot, not by Nomad allocation ID.
For a standard service allocation such as `front-end-sample.app-group[0]`, the resource key is:

```text
default:front-end-sample:app-group:0
```

Nomad may keep an older failed allocation as historical data while creating a replacement with a new ID. If any allocation for the same logical slot is `RUNNING`, the allocation failure incident is resolved. The failed historical allocation remains in Nomad and in monitoring history.

Recovery does not occur merely because a replacement is `PENDING`, `COMPLETE`, or another non-running state. A `RUNNING` allocation is required.


The Nomad cron task keeps `noOverlap: true`. If one pull is still running when the next 15-second tick arrives, that overlapping execution is skipped.


## Incident severity

Nomad incident severity is fixed in code for the current release:

```text
NODE_DOWN           -> CRITICAL
ALLOCATION_FAILED   -> MAJOR
EVALUATION_BLOCKED  -> MAJOR
DRIVER_UNHEALTHY    -> WARNING
```

Severity is not configurable through environment variables.

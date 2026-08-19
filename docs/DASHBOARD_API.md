# Dashboard API v2.0.0

Dashboard API follows the current lifecycle used by the service:

```text
OPEN
├── ACK
├── POSTPONE
└── monitoring recovery -> RESOLVED
```

`ACK` and `POSTPONE` are not incident statuses. `RESOLVED` is the terminal incident state. There is no Close Case dashboard queue.

## Current infrastructure overview

```http
GET /api/v1/dashboard/overview
```

Optional query:

```text
cluster
```

The endpoint aggregates `monitoring_current_states`. It is intended for dashboard cards showing the latest Nomad state.

Example:

```json
{
  "success": true,
  "data": {
    "nomad": {
      "nodes": {
        "total": 6,
        "ready": 5,
        "down": 1
      },
      "drivers": {
        "healthy": 23,
        "unhealthy": 1
      },
      "allocations": {
        "running": 10,
        "failed": 2
      },
      "evaluations": {
        "blocked": 1
      },
      "lastCheckedAt": "2026-08-16T05:20:15.000Z"
    }
  }
}
```

## Health

```http
GET /api/v1/dashboard/health
```

Optional query:

```text
cluster
```

`healthy` is `true` only when there is current monitoring data and all of these counters are zero:

```text
nodesDown
driversUnhealthy
allocationsFailed
evaluationsBlocked
```

If no Nomad current-state data has been observed yet, `healthy` is `null`.

## Incident summary

```http
GET /api/v1/dashboard/incidents/summary
```

Optional query:

```text
cluster
```

When omitted, summary aggregates all clusters. When provided, every summary count/group is scoped to that cluster.

Example:

```json
{
  "success": true,
  "data": {
    "open": {
      "total": 5,
      "unacknowledged": 2,
      "acknowledged": 3,
      "postponed": 1
    },
    "resolved": {
      "today": 12,
      "last24Hours": 17
    },
    "bySeverity": {
      "CRITICAL": 1,
      "MAJOR": 3,
      "WARNING": 1
    },
    "byType": {
      "NODE_DOWN": 1,
      "ALLOCATION_FAILED": 2,
      "EVALUATION_BLOCKED": 1,
      "DRIVER_UNHEALTHY": 1
    }
  }
}
```

`postponed` is a subset of `open`. An incident is currently postponed when it is `OPEN` and `postpone_until` is later than the current time.

`resolved.today` uses the monitoring service process local day boundary. `resolved.last24Hours` is a rolling 24-hour window.

Incident list rows returned by recent/resolved APIs preserve `clusterId` and add `clusterName`, `site`, `appName`, and `env`.

## Recent incidents

```http
GET /api/v1/dashboard/incidents/recent
```

Optional filters:

```text
cluster
source
status
severity
type
acknowledged
postponed
limit
```

Examples:

```http
GET /api/v1/dashboard/incidents/recent?status=OPEN&acknowledged=false
GET /api/v1/dashboard/incidents/recent?status=OPEN&postponed=true
GET /api/v1/dashboard/incidents/recent?severity=CRITICAL&limit=10
```

## Resolved history

```http
GET /api/v1/dashboard/incidents/resolved
```

Optional filters:

```text
cluster
source
severity
type
from
to
page
limit
```

The endpoint always returns `RESOLVED` incidents and sorts by `resolved_at DESC`.

Example response shape:

```json
{
  "success": true,
  "data": {
    "items": [],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 0
    }
  }
}
```

## Final dashboard map for the current MVP

```text
GET /api/v1/dashboard/overview
GET /api/v1/dashboard/health
GET /api/v1/dashboard/incidents/summary
GET /api/v1/dashboard/incidents/recent
GET /api/v1/dashboard/incidents/resolved
```

There is no `/api/v1/dashboard/incidents/closed` endpoint in the current lifecycle.


## ACK semantics

`unacknowledged` is a summary counter for OPEN incidents whose `acknowledged_at` is NULL. ACK is one-way in the MVP; there is no unacknowledge action/API.

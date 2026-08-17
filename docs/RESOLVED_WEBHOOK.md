# RESOLVED Webhook

When the monitoring engine performs an actual `OPEN -> RESOLVED` transition, it sends one webhook with:

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
    "openedAt": "2026-08-16T03:00:00.000Z",
    "resolvedAt": "2026-08-16T03:17:30.000Z",
    "reminderCount": 3
  }
}
```

Recovery is committed to the database before the webhook side effect. A webhook delivery failure does not revert the incident to OPEN.

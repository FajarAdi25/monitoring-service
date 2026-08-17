# Telegram Bot Service Authentication

This document defines the Monitoring Service side of Telegram Bot Service authentication for the MVP.

## Protected actions

```text
POST /api/v1/incidents/:incidentId/acknowledge
POST /api/v1/incidents/:incidentId/postpone
```

Both endpoints require HTTP Basic Authentication:

```http
Authorization: Basic base64(<username>:<password>)
```

Monitoring Service configuration:

```env
MONITORING_BASIC_AUTH_USERNAME=telegram-bot
MONITORING_BASIC_AUTH_PASSWORD=<strong-random-password>
```

Telegram Bot Service must use the same username/password when calling ACK or POSTPONE. A missing or invalid Basic credential returns HTTP `401` with code `UNAUTHORIZED_SERVICE`.

Basic Auth credentials are Base64-encoded, not encrypted. Production traffic must use HTTPS.

## User identity

The Telegram Bot Service sends the Telegram user in `body.user`:

```json
{
  "user": {
    "id": "123456789",
    "name": "Budi Santoso",
    "username": "budi_ops"
  }
}
```

Rules:

- `user.id` is required. Monitoring Service accepts a decimal string or a safe positive integer and normalizes it to a string.
- `user.name` is required and must be non-empty.
- `user.username` is optional.
- Invalid user identity returns HTTP `400` with code `INVALID_USER`.
- Monitoring Service assigns the validated identity to `req.user`.
- The user payload is never trusted before Basic Auth authentication succeeds.

## ACK

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

ACK is one-way and idempotent. If the incident was already acknowledged, the original acknowledgement user is not replaced.

## POSTPONE

```json
{
  "user": {
    "id": "123456789",
    "name": "Budi Santoso",
    "username": "budi_ops"
  },
  "postponeUntil": "2026-08-16T14:30:00+07:00",
  "remark": "Menunggu maintenance selesai"
}
```

POSTPONE is allowed only for `OPEN` incidents. Repeated POSTPONE actions overwrite the current postpone metadata with the latest request.

## Stored identity

Monitoring Service persists the user id plus a name/username snapshot so incident detail does not depend on a later Telegram lookup.

```text
acknowledged_by
acknowledged_by_user_name
acknowledged_by_username

postponed_by
postponed_by_user_name
postponed_by_username
```

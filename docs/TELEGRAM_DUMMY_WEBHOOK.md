# Telegram Dummy Webhook

Endpoint:

```http
POST /api/v1/webhooks/telegram/dummy
```

The monitoring service can use it as its alert target:

```env
ALERT_WEBHOOK_URL=http://127.0.0.1:3000/api/v1/webhooks/telegram/dummy
```

Supported `kind` values:

```text
INITIAL
REMINDER
RESOLVED
```

POSTPONE itself does not emit a Telegram webhook. It changes when the next OPEN reminder becomes due.

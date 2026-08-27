# Reminder Policy

```text
OPEN
  INITIAL immediately
  REMINDER every 1 minute

POSTPONE
  not a status
  INITIAL is still delivered
  REMINDER is deferred until postpone_until
  after postpone_until, REMINDER resumes every 1 minute

RESOLVED
  RESOLVED webhook immediately
  next_notification_at = NULL
  no further OPEN reminders
```

Configuration:

```env
ALERT_REMINDER_INTERVAL_MS=60000
```


SSL certificate expiry incidents (`type=SSL_CERTIFICATE_EXPIRING`) use a 24-hour reminder interval while they remain OPEN. A renewed certificate with more than 30 days remaining resolves the incident and stops further reminders.

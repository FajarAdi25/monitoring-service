# Database Timestamp Revision

All current temporal database columns use `TIMESTAMP(3)`.

Current incident temporal fields include:

```text
opened_at
last_detected_at
last_notification_at
next_notification_at
acknowledged_at
postponed_at
postpone_until
resolved_at
created_at
updated_at
```

The TypeScript entities use the project `Timestamp` alias for these fields.

Closure-related timestamp columns from older revisions are removed by migration `1786680600000-ReplaceCloseWithPostpone.ts`.

# Alerting Flow

```text
Nomad pull every 15 seconds
       |
       v
Monitoring state evaluation
       |
       +-- abnormal -> OPEN
       |               |
       |               +-- INITIAL
       |               +-- REMINDER every 1 minute
       |               +-- ACK keeps reminder active
       |               +-- POSTPONE defers reminder only
       |
       +-- healthy -> RESOLVED
                       |
                       +-- RESOLVED webhook
                       +-- next_notification_at = NULL
```

POSTPONE stores `postponed_at`, `postponed_by`, `postpone_until`, and `postpone_remark`. It does not stop Nomad polling or recovery processing.


## SSL certificate expiry

```text
Cluster with ssl_monitoring=true
       |
       v
TLS certificate check
  startup + every 24 hours
       |
       +-- remaining validity <= 30 days -> OPEN
       |                                  +-- INITIAL webhook
       |                                  +-- REMINDER every 24 hours
       |
       +-- renewed validity > 30 days -> RESOLVED webhook
```

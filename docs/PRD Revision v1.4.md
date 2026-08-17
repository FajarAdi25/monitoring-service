# PRD Revision v1.4

> Project revision 2026-08-14: seluruh kolom temporal database menggunakan `TIMESTAMP(3)` menggantikan `DATETIME(3)`.

## Incident Acknowledge, Resolve, and Close Case

Bagian berikut menjadi revisi resmi untuk lifecycle incident dan Incident API pada PRD Monitoring Service.

# 1. Tujuan

Incident management harus membedakan tiga konsep:

```text
ACKNOWLEDGED
RESOLVED
CLOSED
```

Ketiganya mempunyai arti berbeda.

### Acknowledge

Menandakan operator sudah mengetahui incident.

Acknowledge tidak berarti masalah sudah selesai.

### Resolved

Menandakan monitoring engine sudah mendeteksi resource kembali ke kondisi normal.

Resolved terjadi berdasarkan hasil monitoring, bukan tindakan manual user.

### Closed

Menandakan case sudah selesai secara operasional dan tidak membutuhkan tindakan lebih lanjut.

Closed dilakukan secara manual setelah incident resolved.

---

# 2. Final Incident Lifecycle

Lifecycle final:

```text
                Failure Detected
                       |
                       v
                     OPEN
                       |
                +------+------+
                |             |
                v             |
         ACKNOWLEDGED          |
                |             |
                +-------------+
                       |
                 Resource Healthy
                       |
                       v
                   RESOLVED
                       |
                  Admin Review
                       |
                       v
                    CLOSED
```

Secara database, `ACKNOWLEDGED` tidak menjadi primary incident status.

Incident status tetap:

```text
OPEN
RESOLVED
CLOSED
```

Acknowledge direpresentasikan menggunakan metadata:

```text
acknowledged_at
acknowledged_by
acknowledgement_note
```

Alasannya karena incident yang sudah di-acknowledge tetap masih dapat berstatus `OPEN`.

---

# 3. Incident Status Definition

## OPEN

Incident masih aktif.

Artinya kondisi abnormal terakhir masih terdeteksi.

Contoh:

```text
Node masih down
Driver masih unhealthy
Allocation masih failed
Evaluation masih blocked
```

Incident OPEN tetap masuk:

```text
active incident
```

dan tetap mengikuti reminder setiap 5 menit.

---

## RESOLVED

Underlying monitoring condition sudah kembali normal.

Contoh:

```text
Node down -> ready
Driver unhealthy -> healthy
Evaluation blocked -> complete
```

Monitoring Service otomatis mengubah:

```text
OPEN
 ↓
RESOLVED
```

`RESOLVED` bukan hasil tindakan user.

---

## CLOSED

Incident sudah resolved dan case telah ditutup secara administratif oleh Admin.

Flow:

```text
RESOLVED
   |
   | POST /close
   v
CLOSED
```

CLOSED berarti incident selesai dan tidak lagi muncul pada active/recent operational queue kecuali user secara eksplisit meminta closed incidents.

---

# 4. Acknowledge Rule

Acknowledge boleh dilakukan ketika:

```text
status = OPEN
```

dan juga boleh tetap dipanggil ketika:

```text
status = RESOLVED
```

jika operator ingin melengkapi audit trail sebelum closure.

Namun penggunaan utama adalah pada incident OPEN.

ACK tidak:

- Menghentikan reminder.
- Mengubah status menjadi RESOLVED.
- Mengubah status menjadi CLOSED.
- Mengubah state resource.
- Menghilangkan incident dari active incident list.

---

# 5. Acknowledge API

Endpoint:

```http
POST /api/v1/incidents/:incidentId/acknowledge
```

Permission:

```text
ADMIN
```

Request:

```json
{
  "note": "Sedang dicek oleh tim infrastructure"
}
```

`note` bersifat optional.

---

# 6. Acknowledge Success Response

```json
{
  "success": true,
  "data": {
    "id": "INC-00123",
    "status": "OPEN",
    "acknowledged": true,
    "acknowledgedAt": "2026-08-14T02:35:10.000Z",
    "acknowledgedBy": {
      "id": 12,
      "name": "Infrastructure Admin"
    },
    "acknowledgementNote": "Sedang dicek oleh tim infrastructure"
  }
}
```

Perhatikan bahwa:

```text
status tetap OPEN
```

karena ACK bukan recovery.

---

# 7. Acknowledge Idempotency

Endpoint acknowledge harus idempotent.

Jika incident sudah di-acknowledge, request acknowledge yang sama tidak boleh menghasilkan error atau duplicate audit state.

Response tetap:

```http
200 OK
```

dan mengembalikan acknowledgement state saat ini.

---

# 8. Optional Unacknowledge API

Untuk MVP ini saya rekomendasikan API berikut juga tersedia:

```http
DELETE /api/v1/incidents/:incidentId/acknowledge
```

Permission:

```text
ADMIN
```

Tujuannya untuk memperbaiki ACK yang dilakukan secara keliru.

Response:

```json
{
  "success": true,
  "data": {
    "id": "INC-00123",
    "status": "OPEN",
    "acknowledged": false,
    "acknowledgedAt": null,
    "acknowledgedBy": null
  }
}
```

Unacknowledge tidak mempengaruhi incident status.

---

# 9. Automatic Resolve

Monitoring engine bertanggung jawab melakukan resolve.

Tidak disediakan public API:

```text
POST /incidents/:id/resolve
```

pada MVP.

Alasannya, user tidak boleh menyatakan resource healthy jika hasil monitoring masih menunjukkan kondisi failure.

Contoh:

```text
Node status = down
```

tidak boleh secara manual diubah menjadi:

```text
RESOLVED
```

hanya melalui dashboard.

---

# 10. Resolve Flow

Contoh:

```text
20:00
Node = down

Incident:
OPEN

20:05
Node = down

Incident:
OPEN

20:10
Operator ACK

Incident:
OPEN
acknowledged_at != null

20:17
Node = ready

Monitoring Engine:
OPEN -> RESOLVED
```

System mengisi:

```text
resolved_at
```

secara otomatis.

---

# 11. Close Incident API

Endpoint:

```http
POST /api/v1/incidents/:incidentId/close
```

Permission:

```text
ADMIN
```

Request:

```json
{
  "resolutionCode": "RECOVERED",
  "note": "Service sudah normal dan sudah diverifikasi."
}
```

---

# 12. Supported Resolution Code

Initial supported values:

```text
RECOVERED
FALSE_POSITIVE
NO_ACTION_REQUIRED
KNOWN_ISSUE
OTHER
```

Penjelasan:

### RECOVERED

Masalah benar terjadi dan resource sudah kembali normal.

### FALSE_POSITIVE

Incident terbukti bukan masalah nyata.

### NO_ACTION_REQUIRED

Incident valid tetapi tidak membutuhkan tindakan tambahan.

### KNOWN_ISSUE

Incident berkaitan dengan masalah yang sudah diketahui dan sudah ditangani melalui proses lain.

### OTHER

Digunakan jika tidak sesuai kategori di atas.

Untuk `OTHER`, `note` wajib diisi.

---

# 13. Normal Close Rule

Secara normal, incident hanya dapat ditutup jika:

```text
status = RESOLVED
```

Flow:

```text
OPEN
 ↓
RESOLVED
 ↓
CLOSED
```

Request:

```http
POST /api/v1/incidents/INC-00123/close
```

mengubah:

```text
RESOLVED
```

menjadi:

```text
CLOSED
```

---

# 14. Active Incident Cannot Be Closed

Incident yang masih:

```text
OPEN
```

tidak boleh ditutup menggunakan endpoint normal.

Response:

```http
409 Conflict
```

```json
{
  "success": false,
  "error": {
    "code": "INCIDENT_STILL_ACTIVE",
    "message": "Incident cannot be closed while the monitored condition is still active."
  }
}
```

Alasannya untuk mencegah dashboard menyembunyikan failure yang masih benar-benar terjadi.

Jika nantinya dibutuhkan fitur untuk mengabaikan active incident, gunakan konsep lain seperti:

```text
SILENCED
SUPPRESSED
MAINTENANCE
```

bukan menyalahgunakan CLOSED.

Fitur tersebut bukan scope MVP.

---

# 15. Close Success Response

```json
{
  "success": true,
  "data": {
    "id": "INC-00123",
    "status": "CLOSED",
    "resolutionCode": "RECOVERED",
    "resolutionNote": "Service sudah normal dan sudah diverifikasi.",
    "resolvedAt": "2026-08-14T02:30:15.000Z",
    "closedAt": "2026-08-14T02:42:11.000Z",
    "closedBy": {
      "id": 12,
      "name": "Infrastructure Admin"
    }
  }
}
```

---

# 16. Close Idempotency

Jika incident sudah CLOSED dan endpoint dipanggil kembali, API harus bersifat idempotent.

Response:

```http
200 OK
```

dan mengembalikan current closed state.

API tidak membuat closure history baru hanya karena request yang sama dikirim ulang.

---

# 17. Reopen Policy

MVP tidak menyediakan:

```http
POST /api/v1/incidents/:id/reopen
```

Jika resource gagal lagi setelah incident sebelumnya selesai:

```text
Incident A
CLOSED

Resource healthy

Failure baru terjadi
```

system membuat:

```text
Incident B
OPEN
```

dengan fingerprint yang sama tetapi incident ID baru.

Hal ini menjaga histori setiap occurrence tetap terpisah.

---

# 18. Updated Incident Entity

Table:

```text
incidents
```

menjadi:

```text
id                      BIGINT UNSIGNED PK
public_id               VARCHAR(32) UNIQUE

cluster_id              BIGINT UNSIGNED FK

source                  VARCHAR(32)

type                    VARCHAR(64)
severity                VARCHAR(32)

resource_type           VARCHAR(32)
resource_key            VARCHAR(255)
resource_name           VARCHAR(255) NULL

fingerprint             CHAR(64)
active_fingerprint      CHAR(64) NULL

status                  VARCHAR(32)

message                 TEXT
context_json            JSON NULL

opened_at               TIMESTAMP(3)
last_detected_at        TIMESTAMP(3)

last_notification_at    TIMESTAMP(3) NULL
next_notification_at    TIMESTAMP(3) NULL
reminder_count          INT UNSIGNED DEFAULT 0

acknowledged_at         TIMESTAMP(3) NULL
acknowledged_by         BIGINT UNSIGNED NULL
acknowledgement_note    TEXT NULL

resolved_at             TIMESTAMP(3) NULL

resolution_code         VARCHAR(32) NULL
resolution_note         TEXT NULL

closed_at               TIMESTAMP(3) NULL
closed_by               BIGINT UNSIGNED NULL

created_at              TIMESTAMP(3)
updated_at              TIMESTAMP(3)
```

---

# 19. Incident Status Values

Final supported status:

```text
OPEN
RESOLVED
CLOSED
```

Tidak menggunakan:

```text
ACKNOWLEDGED
```

sebagai status.

ACK merupakan independent state.

---

# 20. Active Fingerprint Rule

Ketika incident:

```text
OPEN
```

maka:

```text
active_fingerprint = fingerprint
```

Ketika berubah:

```text
OPEN -> RESOLVED
```

maka:

```text
active_fingerprint = NULL
```

Ini penting agar failure baru setelah recovery dapat membuat incident baru.

Status CLOSED tidak memiliki active fingerprint.

---

# 21. Why Fingerprint Released at RESOLVED

Fingerprint dilepas ketika RESOLVED, bukan ketika CLOSED.

Contoh:

```text
20:00 Node Down
Incident A OPEN

20:20 Node Ready
Incident A RESOLVED

20:22 Node Down Lagi
```

Walaupun Incident A belum di-close oleh Admin, kondisi 20:22 merupakan occurrence baru.

System harus dapat membuat:

```text
Incident B OPEN
```

karena itu `active_fingerprint` sudah harus `NULL` saat Incident A RESOLVED.

---

# 22. Updated Incident List API

```http
GET /api/v1/incidents
```

Filters:

```text
cluster
source
type
severity
status
acknowledged
resolutionCode
resourceType
from
to
page
limit
```

Contoh OPEN incidents:

```http
GET /api/v1/incidents?status=OPEN
```

Unacknowledged:

```http
GET /api/v1/incidents?status=OPEN&acknowledged=false
```

Acknowledged:

```http
GET /api/v1/incidents?status=OPEN&acknowledged=true
```

Resolved waiting for closure:

```http
GET /api/v1/incidents?status=RESOLVED
```

Closed history:

```http
GET /api/v1/incidents?status=CLOSED
```

---

# 23. Incident Detail API

```http
GET /api/v1/incidents/:incidentId
```

Response harus menyertakan lifecycle information.

Example:

```json
{
  "success": true,
  "data": {
    "id": "INC-00123",
    "source": "NOMAD",
    "type": "NODE_DOWN",
    "severity": "CRITICAL",
    "status": "RESOLVED",

    "resource": {
      "type": "NODE",
      "id": "node-123",
      "name": "nomad-client-03"
    },

    "openedAt": "2026-08-14T01:00:00.000Z",

    "acknowledgement": {
      "acknowledged": true,
      "acknowledgedAt": "2026-08-14T01:03:00.000Z",
      "acknowledgedBy": {
        "id": 12,
        "name": "Infrastructure Admin"
      },
      "note": "Investigating"
    },

    "resolvedAt": "2026-08-14T01:17:00.000Z",

    "closure": {
      "closed": false,
      "resolutionCode": null,
      "note": null,
      "closedAt": null,
      "closedBy": null
    }
  }
}
```

---

# 24. Dashboard Incident Counters

Dashboard overview harus membedakan:

```text
open
unacknowledged
acknowledged
resolved
closed
```

Contoh:

```json
{
  "incidents": {
    "open": 5,
    "unacknowledged": 2,
    "acknowledged": 3,
    "resolvedAwaitingClosure": 4,
    "closedToday": 12
  }
}
```

Dengan data tersebut dashboard dapat membuat operational queue yang lebih jelas.

---

# 25. Dashboard Incident Workflow

Dashboard dapat menampilkan tiga queue utama.

### Active

```text
status = OPEN
```

### Awaiting Closure

```text
status = RESOLVED
```

### History

```text
status = CLOSED
```

Contoh UI flow:

```text
ACTIVE INCIDENTS
      |
      +-- Unacknowledged
      |
      +-- Acknowledged

RESOLVED
      |
      +-- Waiting for closure

CLOSED
      |
      +-- Historical incidents
```

---

# 26. Dashboard Acknowledge Action

Pada incident OPEN, dashboard dapat menyediakan:

```text
Acknowledge
```

yang memanggil:

```http
POST /api/v1/incidents/:incidentId/acknowledge
```

Setelah ACK:

```text
OPEN
```

tetap OPEN.

Dashboard hanya menampilkan bahwa incident sedang diketahui/ditangani.

---

# 27. Dashboard Close Action

Button:

```text
Close Case
```

hanya boleh aktif jika:

```text
status = RESOLVED
```

Dashboard memanggil:

```http
POST /api/v1/incidents/:incidentId/close
```

User harus mengisi:

```text
resolutionCode
```

dan optional:

```text
note
```

---

# 28. Dashboard Incident Summary Revision

Endpoint:

```http
GET /api/v1/dashboard/incidents/summary
```

Response diperluas:

```json
{
  "success": true,
  "data": {
    "active": {
      "total": 5,
      "unacknowledged": 2,
      "acknowledged": 3
    },
    "resolved": {
      "awaitingClosure": 4
    },
    "closed": {
      "today": 12,
      "last24Hours": 17
    },
    "bySeverity": {
      "CRITICAL": 3,
      "WARNING": 2
    },
    "byType": {
      "NODE_DOWN": 1,
      "DRIVER_UNHEALTHY": 1,
      "ALLOCATION_FAILED": 3
    }
  }
}
```

---

# 29. Dashboard Recent Incidents Revision

Endpoint:

```http
GET /api/v1/dashboard/incidents/recent
```

Optional filters:

```text
cluster
status
acknowledged
limit
```

Example:

```http
GET /api/v1/dashboard/incidents/recent?status=OPEN&acknowledged=false
```

digunakan untuk menampilkan incident baru yang belum dilihat operator.

---

# 30. Dashboard Resolved Queue API

Tambahkan:

```http
GET /api/v1/dashboard/incidents/resolved
```

Purpose:

Menampilkan incident yang:

```text
status = RESOLVED
```

tetapi belum:

```text
CLOSED
```

Default sorting:

```text
resolved_at DESC
```

Ini menjadi data source untuk halaman:

```text
Awaiting Closure
```

---

# 31. Dashboard Closed Case API

Tambahkan:

```http
GET /api/v1/dashboard/incidents/closed
```

Filters:

```text
cluster
resolutionCode
from
to
page
limit
```

Purpose:

Menampilkan historical closed cases.

---

# 32. Incident API Final Map

```text
LIST

GET /api/v1/incidents


DETAIL

GET /api/v1/incidents/:incidentId


LOG

GET /api/v1/incidents/:incidentId/logs


ACKNOWLEDGE

POST /api/v1/incidents/:incidentId/acknowledge


REMOVE ACK

DELETE /api/v1/incidents/:incidentId/acknowledge


CLOSE CASE

POST /api/v1/incidents/:incidentId/close
```

Tidak tersedia:

```text
POST /api/v1/incidents/:incidentId/resolve
POST /api/v1/incidents/:incidentId/reopen
```

pada MVP.

---

# 33. Dashboard Incident API Final Map

```text
GET /api/v1/dashboard/incidents/summary

GET /api/v1/dashboard/incidents/recent

GET /api/v1/dashboard/incidents/resolved

GET /api/v1/dashboard/incidents/closed
```

---

# 34. Authorization Matrix

| Operation | Viewer | Admin |
|---|---:|---:|
| List Incident | Yes | Yes |
| Incident Detail | Yes | Yes |
| Incident Logs | Yes | Yes |
| Acknowledge | No | Yes |
| Remove Acknowledge | No | Yes |
| Close Case | No | Yes |
| Manual Pull | No | Yes |

---

# 35. Reminder Behavior after ACK

ACK tidak menghentikan reminder.

Contoh:

```text
20:00 Incident OPEN
20:02 Admin ACK
20:05 Reminder
20:10 Reminder
20:15 Reminder
20:17 Resource recovered
20:17 Incident RESOLVED
```

Reminder berhenti karena incident RESOLVED, bukan karena ACK.

---

# 36. Reminder Behavior after Resolve

Setelah:

```text
status = RESOLVED
```

system tidak membuat reminder berikutnya.

`next_notification_at` harus di-clear:

```text
NULL
```

---

# 37. Reminder Behavior after Close

CLOSED incident tidak pernah menghasilkan reminder.

---

# 38. Closure Validation

Close operation harus memvalidasi:

```text
Incident exists
Status = RESOLVED
Valid resolutionCode
Admin permission
```

Jika status:

```text
OPEN
```

return:

```text
409 INCIDENT_STILL_ACTIVE
```

Jika sudah:

```text
CLOSED
```

return current closed resource secara idempotent.

Jika incident tidak ditemukan:

```text
404 INCIDENT_NOT_FOUND
```

---

# 39. Audit Fields

Acknowledge harus dapat diaudit melalui:

```text
acknowledged_at
acknowledged_by
acknowledgement_note
```

Closure harus dapat diaudit melalui:

```text
resolution_code
resolution_note
closed_at
closed_by
```

Dengan data ini sistem dapat menjawab:

```text
Siapa yang menerima incident?
Kapan incident diterima?
Kapan resource pulih?
Siapa yang menutup case?
Kenapa case ditutup?
```

---

# 40. Incident Duration Metrics

System dapat menghitung dua duration yang berbeda.

### Technical Incident Duration

```text
resolved_at - opened_at
```

Menunjukkan berapa lama infrastructure benar-benar berada pada abnormal condition.

### Operational Closure Duration

```text
closed_at - opened_at
```

Menunjukkan berapa lama case berada dalam proses operasional sampai ditutup.

Contoh:

```text
Opened   10:00
Resolved 10:20
Closed   10:45
```

Technical duration:

```text
20 menit
```

Operational duration:

```text
45 menit
```

Ini nantinya berguna untuk dashboard dan reporting.

---

# 41. Dashboard Metrics Future-Ready

Dengan lifecycle ini dashboard nantinya dapat menghitung:

```text
MTTA
MTTR
Average closure time
Open incidents
Unacknowledged incidents
Resolved awaiting closure
Closed cases
```

Contoh:

### MTTA

```text
acknowledged_at - opened_at
```

### Technical MTTR

```text
resolved_at - opened_at
```

Metric reporting yang kompleks tidak wajib pada MVP satu hari, tetapi database sudah harus mampu mendukungnya.

---

# 42. Updated Incident State Diagram

```text
                       FAILURE
                          |
                          v
                    +-----------+
                    |   OPEN    |
                    +-----------+
                          |
              +-----------+-----------+
              |                       |
              v                       |
         ACKNOWLEDGE                  |
              |                       |
              +-----------+-----------+
                          |
                     Still OPEN
                          |
                    Resource Healthy
                          |
                          v
                    +-----------+
                    | RESOLVED  |
                    +-----------+
                          |
                     Admin Close
                          |
                          v
                    +-----------+
                    |  CLOSED   |
                    +-----------+
```

ACK merupakan attribute terhadap OPEN incident, bukan lifecycle status.

---

# 43. Updated API Map

```text
DASHBOARD

GET /api/v1/dashboard/overview
GET /api/v1/dashboard/clusters
GET /api/v1/dashboard/clusters/:clusterCode/overview
GET /api/v1/dashboard/health

GET /api/v1/dashboard/incidents/summary
GET /api/v1/dashboard/incidents/recent
GET /api/v1/dashboard/incidents/resolved
GET /api/v1/dashboard/incidents/closed

GET /api/v1/dashboard/changes/recent
GET /api/v1/dashboard/trends
GET /api/v1/dashboard/pulls


INCIDENTS

GET    /api/v1/incidents
GET    /api/v1/incidents/:incidentId
GET    /api/v1/incidents/:incidentId/logs

POST   /api/v1/incidents/:incidentId/acknowledge
DELETE /api/v1/incidents/:incidentId/acknowledge

POST   /api/v1/incidents/:incidentId/close
```

---

# 44. Updated Acceptance Criteria

Incident management dinyatakan selesai jika:

1. OPEN incident dapat di-acknowledge.
2. ACK menyimpan user dan timestamp.
3. ACK dapat menyimpan note.
4. ACK tidak mengubah status OPEN.
5. ACK tidak menghentikan reminder.
6. Duplicate ACK bersifat idempotent.
7. ACK dapat dibatalkan oleh Admin.
8. Resource recovery otomatis mengubah OPEN menjadi RESOLVED.
9. User tidak dapat manually resolve active incident.
10. RESOLVED incident berhenti menghasilkan reminder.
11. RESOLVED incident dapat di-close.
12. OPEN incident tidak dapat di-close.
13. Attempt close pada OPEN menghasilkan `409`.
14. Close menyimpan resolution code.
15. Close dapat menyimpan resolution note.
16. Close menyimpan `closed_at`.
17. Close menyimpan `closed_by`.
18. Duplicate close bersifat idempotent.
19. CLOSED incident tidak dapat menjadi active incident kembali.
20. Failure baru setelah recovery menghasilkan incident baru.
21. Dashboard dapat menampilkan unacknowledged incident.
22. Dashboard dapat menampilkan acknowledged incident.
23. Dashboard dapat menampilkan resolved incident yang belum ditutup.
24. Dashboard dapat menampilkan closed history.
25. Viewer tidak dapat ACK.
26. Viewer tidak dapat Close Case.
27. Admin dapat ACK.
28. Admin dapat Close Case.
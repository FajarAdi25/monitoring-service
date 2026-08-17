# Current Local Port Mapping

For the current Windows local setup:

- Monitoring Service host URL: `http://localhost:3001`
- Monitoring Service container port: `3002`
- Telegram Bot Service on Windows host: `http://localhost:3004`
- MySQL on Windows host: `127.0.0.1:3306`
- Containers reach Windows-native services through `host.docker.internal`.

Use `.env.docker.local` for the current local credentials/configuration. The file is ignored by Git.

---

# Docker Deployment Guide - External MySQL

Version: 1.9.3

## Architecture

Only Monitoring Service runs in Docker. MySQL is an existing installation outside Docker.

```text
Windows Local
+---------------- Windows Host ----------------+
| MySQL :3306                                  |
|                                               |
| Docker Desktop                               |
|   monitoring-service :3002 ------------------+--> MySQL via host.docker.internal:3306
+-----------------------------------------------+

Linux Development Server
+---------------- Linux Host ------------------+
| MySQL :3306                                  |
|                                               |
| Docker Engine                                |
|   monitoring-service :3002 ------------------+--> MySQL via host.docker.internal:3306
+-----------------------------------------------+
```

If development MySQL is on another machine, set `DB_HOST` to that server's DNS name or IP instead.

## Database prerequisite

The database itself must already exist. TypeORM migrations create/update tables, but do not create the MySQL database.

Example:

```sql
CREATE DATABASE monitoring CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'monitoring'@'%' IDENTIFIED BY 'CHANGE_ME';
GRANT ALL PRIVILEGES ON monitoring.* TO 'monitoring'@'%';
FLUSH PRIVILEGES;
```

Restrict the MySQL account host further when the actual Docker source network is known.

## Local Windows

Requirements:

- Docker Desktop
- Existing MySQL on Windows, normally port 3306
- Database and user already created

Prepare env:

```powershell
Copy-Item .env.docker.local.example .env.docker.local
notepad .env.docker.local
```

For the current local setup, the important values are:

```env
APP_HOST_PORT=3001
APP_PORT=3002
DB_HOST=host.docker.internal
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=<your-local-password>
DB_NAME=monitoring
MONITORING_BASIC_AUTH_USERNAME=<your-basic-auth-username>
MONITORING_BASIC_AUTH_PASSWORD=<your-basic-auth-password>
ALERT_WEBHOOK_URL=http://host.docker.internal:3004/webhooks/alerts
```

The Nomad URL remains the remote HTTPS URL from the provided local environment.

Start:

```powershell
docker compose --env-file .env.docker.local -f compose.local.yml up -d --build
```

Status/logs:

```powershell
docker compose --env-file .env.docker.local -f compose.local.yml ps
docker compose --env-file .env.docker.local -f compose.local.yml logs -f monitoring-service
```

API:

```text
http://localhost:3001
```

Stop:

```powershell
docker compose --env-file .env.docker.local -f compose.local.yml down
```

`down` only removes the Monitoring Service container/network. It never touches the Windows MySQL installation.

## Linux development server

Clone/update source from Git, then prepare an untracked env file:

```bash
cp .env.docker.dev.example .env.docker.dev
chmod 600 .env.docker.dev
```

If MySQL is installed on the same Linux server:

```env
DB_HOST=host.docker.internal
DB_PORT=3306
```

`compose.dev.yml` contains:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

so the container can resolve the Docker host.

If MySQL is remote:

```env
DB_HOST=mysql-dev.internal.example
DB_PORT=3306
```

Deploy:

```bash
docker compose --env-file .env.docker.dev -f compose.dev.yml up -d --build
```

Status/logs:

```bash
docker compose --env-file .env.docker.dev -f compose.dev.yml ps
docker compose --env-file .env.docker.dev -f compose.dev.yml logs -f monitoring-service
```

## Important Linux MySQL networking note

A container using bridge networking cannot connect to a MySQL server that only listens on `127.0.0.1` of the Linux host.

If MySQL is on the same Linux server, configure MySQL to listen on an interface reachable from Docker, for example the server interface or Docker bridge/gateway, and restrict access using firewall rules and MySQL grants. Do not expose port 3306 publicly unless explicitly required.

Check MySQL listener:

```bash
sudo ss -lntp | grep 3306
```

Typical MySQL configuration is under `/etc/mysql/mysql.conf.d/mysqld.cnf` or the distribution equivalent. After changing `bind-address`, restart MySQL and verify connectivity.

## Migrations

There is no separate migration container. The single Monitoring Service container executes:

```text
node dist/database/run-migrations.js
```

before starting:

```text
node dist/server.js
```

Only pending TypeORM migrations are applied. If migration/database connection fails, application startup fails and Docker's restart policy retries the container.

## Git deployment on Linux

Initial deployment:

```bash
cd /opt
git clone <repository-url> monitoring-service
cd monitoring-service
cp .env.docker.dev.example .env.docker.dev
chmod 600 .env.docker.dev
# edit .env.docker.dev
docker compose --env-file .env.docker.dev -f compose.dev.yml up -d --build
```

Subsequent deployment:

```bash
cd /opt/monitoring-service
git fetch origin
git checkout develop
git pull --ff-only origin develop
docker compose --env-file .env.docker.dev -f compose.dev.yml up -d --build
```

`.env.docker.dev` is intentionally ignored by Git.

## Nomad

Nomad polling remains:

```text
every 15 seconds
noOverlap = true
worker running guard = true
```

If Nomad is on the same host:

```env
NOMAD_BASE_URL=http://host.docker.internal:4646
```

If Nomad is remote, use its normal reachable URL.

## TLS CA

Private Nomad CA files can be placed under:

```text
docker/certs/
```

and referenced from the container as:

```env
NOMAD_TLS_CA_FILE=/app/certs/nomad-ca.pem
```

Real certificate files are ignored by Git.

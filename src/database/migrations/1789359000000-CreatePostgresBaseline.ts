// Version: 2.6.0
import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePostgresBaseline1789359000000 implements MigrationInterface {
  name = "CreatePostgresBaseline1789359000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE clusters_env_enum AS ENUM ('PRODUCTION', 'PREPRODUCTION')
    `);

    await queryRunner.query(`
      CREATE TABLE clusters (
        cluster_id BIGINT NOT NULL,
        url VARCHAR(512) NOT NULL,
        cluster_name VARCHAR(255) NOT NULL,
        site VARCHAR(255) NOT NULL,
        app_name VARCHAR(255) NOT NULL,
        env clusters_env_enum NOT NULL,
        token VARCHAR(512) NOT NULL,
        ssl_monitoring BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        CONSTRAINT pk_clusters PRIMARY KEY (cluster_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE incidents (
        id BIGSERIAL NOT NULL,
        public_id VARCHAR(32) NOT NULL,
        cluster_id BIGINT NOT NULL,
        source VARCHAR(32) NOT NULL,
        type VARCHAR(64) NOT NULL,
        severity VARCHAR(32) NOT NULL,
        resource_type VARCHAR(32) NOT NULL,
        resource_key VARCHAR(255) NOT NULL,
        resource_name VARCHAR(255) NULL,
        fingerprint CHAR(64) NOT NULL,
        active_fingerprint CHAR(64) NULL,
        status VARCHAR(32) NOT NULL,
        message TEXT NOT NULL,
        context_json JSON NULL,
        opened_at TIMESTAMP(3) NOT NULL,
        last_detected_at TIMESTAMP(3) NOT NULL,
        last_notification_at TIMESTAMP(3) NULL,
        next_notification_at TIMESTAMP(3) NULL,
        reminder_count INTEGER NOT NULL DEFAULT 0,
        acknowledged_at TIMESTAMP(3) NULL,
        acknowledged_by BIGINT NULL,
        acknowledged_by_user_name VARCHAR(255) NULL,
        acknowledged_by_username VARCHAR(255) NULL,
        acknowledgement_note TEXT NULL,
        postponed_at TIMESTAMP(3) NULL,
        postponed_by BIGINT NULL,
        postponed_by_user_name VARCHAR(255) NULL,
        postponed_by_username VARCHAR(255) NULL,
        postpone_until TIMESTAMP(3) NULL,
        postpone_remark TEXT NULL,
        resolved_at TIMESTAMP(3) NULL,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        CONSTRAINT pk_incidents PRIMARY KEY (id)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_incidents_public_id
      ON incidents (public_id)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_incidents_active_fingerprint
      ON incidents (active_fingerprint)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_incidents_status_opened_at
      ON incidents (status, opened_at)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_incidents_resolved_at
      ON incidents (resolved_at)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_incidents_postpone_until
      ON incidents (status, postpone_until)
    `);

    await queryRunner.query(`
      CREATE TABLE resolution_time (
        id BIGSERIAL NOT NULL,
        incident_id BIGINT NOT NULL,
        detected_at TIMESTAMP(3) NOT NULL,
        resolved_at TIMESTAMP(3) NULL,
        duration_seconds INTEGER NULL,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        CONSTRAINT pk_resolution_time PRIMARY KEY (id),
        CONSTRAINT uq_resolution_time_incident UNIQUE (incident_id),
        CONSTRAINT fk_resolution_time_incident
          FOREIGN KEY (incident_id) REFERENCES incidents(id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE monitoring_snapshots (
        id BIGSERIAL NOT NULL,
        cluster_id BIGINT NOT NULL,
        source VARCHAR(32) NOT NULL,
        resource_type VARCHAR(32) NOT NULL,
        resource_key VARCHAR(255) NOT NULL,
        resource_name VARCHAR(255) NULL,
        state VARCHAR(64) NOT NULL,
        payload_json JSON NULL,
        observed_at TIMESTAMP(3) NOT NULL,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        CONSTRAINT pk_monitoring_snapshots PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_monitoring_snapshots_lookup
      ON monitoring_snapshots (cluster_id, source, resource_type, resource_key, id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_monitoring_snapshots_observed_at
      ON monitoring_snapshots (observed_at)
    `);

    await queryRunner.query(`
      CREATE TABLE monitoring_current_states (
        id BIGSERIAL NOT NULL,
        cluster_id BIGINT NOT NULL,
        source VARCHAR(32) NOT NULL,
        resource_type VARCHAR(32) NOT NULL,
        resource_key VARCHAR(255) NOT NULL,
        resource_name VARCHAR(255) NULL,
        state VARCHAR(64) NOT NULL,
        payload_json JSON NULL,
        last_checked_at TIMESTAMP(3) NOT NULL,
        last_changed_at TIMESTAMP(3) NOT NULL,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        CONSTRAINT pk_monitoring_current_states PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_monitoring_current_states_resource
      ON monitoring_current_states (cluster_id, source, resource_type, resource_key)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_monitoring_current_states_filter
      ON monitoring_current_states (cluster_id, source, resource_type, state)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_monitoring_current_states_last_checked
      ON monitoring_current_states (last_checked_at)
    `);

    await queryRunner.query(`
      CREATE TABLE ssl_monitoring (
        id BIGSERIAL NOT NULL,
        cluster_id BIGINT NOT NULL,
        valid_from TIMESTAMP(3) NOT NULL,
        expires_at TIMESTAMP(3) NOT NULL,
        days_remaining INTEGER NOT NULL,
        subject_cn VARCHAR(255) NULL,
        issuer_cn VARCHAR(255) NULL,
        certificate_fingerprint256 VARCHAR(128) NULL,
        last_checked_at TIMESTAMP(3) NOT NULL,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        CONSTRAINT pk_ssl_monitoring PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_ssl_monitoring_cluster
      ON ssl_monitoring (cluster_id)
    `);

    await queryRunner.query(`
      CREATE TABLE relay_deliveries (
        id BIGSERIAL NOT NULL,
        incident_id BIGINT NOT NULL,
        event_type VARCHAR(16) NOT NULL,
        status VARCHAR(16) NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NULL,
        next_retry_at TIMESTAMP(3) NULL,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        CONSTRAINT pk_relay_deliveries PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_relay_delivery_incident_event
      ON relay_deliveries (incident_id, event_type)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE relay_deliveries");
    await queryRunner.query("DROP TABLE ssl_monitoring");
    await queryRunner.query("DROP TABLE monitoring_current_states");
    await queryRunner.query("DROP TABLE monitoring_snapshots");
    await queryRunner.query("DROP TABLE resolution_time");
    await queryRunner.query("DROP TABLE incidents");
    await queryRunner.query("DROP TABLE clusters");
    await queryRunner.query("DROP TYPE clusters_env_enum");
  }
}

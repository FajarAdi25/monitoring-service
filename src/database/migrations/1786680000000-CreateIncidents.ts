import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateIncidents1786680000000 implements MigrationInterface {
  name = "CreateIncidents1786680000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE incidents (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        public_id VARCHAR(32) NOT NULL,
        cluster_id BIGINT UNSIGNED NOT NULL,
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
        reminder_count INT UNSIGNED NOT NULL DEFAULT 0,
        acknowledged_at TIMESTAMP(3) NULL,
        acknowledged_by BIGINT UNSIGNED NULL,
        acknowledgement_note TEXT NULL,
        resolved_at TIMESTAMP(3) NULL,
        resolution_code VARCHAR(32) NULL,
        resolution_note TEXT NULL,
        closed_at TIMESTAMP(3) NULL,
        closed_by BIGINT UNSIGNED NULL,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_incidents_public_id (public_id),
        UNIQUE KEY uq_incidents_active_fingerprint (active_fingerprint),
        KEY idx_incidents_status_opened_at (status, opened_at),
        KEY idx_incidents_resolved_at (resolved_at),
        KEY idx_incidents_closed_at (closed_at)
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE incidents");
  }
}

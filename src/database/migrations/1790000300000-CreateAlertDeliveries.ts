// Version: 2.7.1
import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAlertDeliveries1790000300000 implements MigrationInterface {
  name = "CreateAlertDeliveries1790000300000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE alert_deliveries (
        id BIGSERIAL NOT NULL,
        incident_id BIGINT NOT NULL,
        kind VARCHAR(16) NOT NULL,
        batch_id VARCHAR(36) NOT NULL,
        payload_json JSON NOT NULL,
        status VARCHAR(16) NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_status_code INTEGER NULL,
        last_error TEXT NULL,
        next_attempt_at TIMESTAMP(3) NOT NULL,
        sent_at TIMESTAMP(3) NULL,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        CONSTRAINT pk_alert_deliveries PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_alert_deliveries_batch_id
      ON alert_deliveries (batch_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_alert_deliveries_due
      ON alert_deliveries (status, next_attempt_at)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE alert_deliveries");
  }
}

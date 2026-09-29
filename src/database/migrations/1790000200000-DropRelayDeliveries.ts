// Version: 2.7.0
import type { MigrationInterface, QueryRunner } from "typeorm";

export class DropRelayDeliveries1790000200000 implements MigrationInterface {
  name = "DropRelayDeliveries1790000200000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE relay_deliveries");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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
}

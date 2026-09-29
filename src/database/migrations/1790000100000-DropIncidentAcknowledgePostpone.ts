// Version: 2.7.0
import type { MigrationInterface, QueryRunner } from "typeorm";

export class DropIncidentAcknowledgePostpone1790000100000 implements MigrationInterface {
  name = "DropIncidentAcknowledgePostpone1790000100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP INDEX idx_incidents_postpone_until");
    await queryRunner.query(`
      ALTER TABLE incidents
        DROP COLUMN acknowledged_at,
        DROP COLUMN acknowledged_by,
        DROP COLUMN acknowledged_by_user_name,
        DROP COLUMN acknowledged_by_username,
        DROP COLUMN acknowledgement_note,
        DROP COLUMN postponed_at,
        DROP COLUMN postponed_by,
        DROP COLUMN postponed_by_user_name,
        DROP COLUMN postponed_by_username,
        DROP COLUMN postpone_until,
        DROP COLUMN postpone_remark
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE incidents
        ADD COLUMN acknowledged_at TIMESTAMP(3) NULL,
        ADD COLUMN acknowledged_by BIGINT NULL,
        ADD COLUMN acknowledged_by_user_name VARCHAR(255) NULL,
        ADD COLUMN acknowledged_by_username VARCHAR(255) NULL,
        ADD COLUMN acknowledgement_note TEXT NULL,
        ADD COLUMN postponed_at TIMESTAMP(3) NULL,
        ADD COLUMN postponed_by BIGINT NULL,
        ADD COLUMN postponed_by_user_name VARCHAR(255) NULL,
        ADD COLUMN postponed_by_username VARCHAR(255) NULL,
        ADD COLUMN postpone_until TIMESTAMP(3) NULL,
        ADD COLUMN postpone_remark TEXT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_incidents_postpone_until
      ON incidents (status, postpone_until)
    `);
  }
}

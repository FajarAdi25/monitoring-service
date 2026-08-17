import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddIncidentUserIdentity1786680800000 implements MigrationInterface {
  name = "AddIncidentUserIdentity1786680800000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE incidents
        ADD COLUMN acknowledged_by_user_name VARCHAR(255) NULL AFTER acknowledged_by,
        ADD COLUMN acknowledged_by_username VARCHAR(255) NULL AFTER acknowledged_by_user_name,
        ADD COLUMN postponed_by_user_name VARCHAR(255) NULL AFTER postponed_by,
        ADD COLUMN postponed_by_username VARCHAR(255) NULL AFTER postponed_by_user_name
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE incidents
        DROP COLUMN postponed_by_username,
        DROP COLUMN postponed_by_user_name,
        DROP COLUMN acknowledged_by_username,
        DROP COLUMN acknowledged_by_user_name
    `);
  }
}

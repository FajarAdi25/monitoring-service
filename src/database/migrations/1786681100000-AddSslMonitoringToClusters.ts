import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddSslMonitoringToClusters1786681100000 implements MigrationInterface {
  name = "AddSslMonitoringToClusters1786681100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE clusters
      ADD COLUMN ssl_monitoring TINYINT(1) NOT NULL DEFAULT 0 AFTER token
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE clusters
      DROP COLUMN ssl_monitoring
    `);
  }
}

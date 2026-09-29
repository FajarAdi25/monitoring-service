// Version: 2.7.0
import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddIsActiveToClustersAndSslMonitoring1790000000000 implements MigrationInterface {
  name = "AddIsActiveToClustersAndSslMonitoring1790000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE clusters
      ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE
    `);
    await queryRunner.query(`
      ALTER TABLE ssl_monitoring
      ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE ssl_monitoring DROP COLUMN is_active");
    await queryRunner.query("ALTER TABLE clusters DROP COLUMN is_active");
  }
}

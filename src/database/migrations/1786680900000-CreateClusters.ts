import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateClusters1786680900000 implements MigrationInterface {
  name = "CreateClusters1786680900000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE clusters (
        cluster_id BIGINT UNSIGNED NOT NULL,
        url VARCHAR(512) NOT NULL,
        cluster_name VARCHAR(255) NOT NULL,
        site VARCHAR(255) NOT NULL,
        app_name VARCHAR(255) NOT NULL,
        env ENUM('PRODUCTION','PREPRODUCTION') NOT NULL,
        token VARCHAR(512) NOT NULL,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (cluster_id)
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE clusters");
  }
}

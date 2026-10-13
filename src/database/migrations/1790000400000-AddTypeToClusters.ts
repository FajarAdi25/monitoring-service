// Version: 2.10.0
import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddTypeToClusters1790000400000 implements MigrationInterface {
  name = "AddTypeToClusters1790000400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE clusters_type_enum AS ENUM ('NOMAD', 'CONSUL')
    `);
    await queryRunner.query(`
      ALTER TABLE clusters
      ADD COLUMN type clusters_type_enum NOT NULL DEFAULT 'NOMAD'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE clusters DROP COLUMN type");
    await queryRunner.query("DROP TYPE clusters_type_enum");
  }
}

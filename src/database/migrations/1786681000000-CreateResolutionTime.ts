import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateResolutionTime1786681000000 implements MigrationInterface {
  name = "CreateResolutionTime1786681000000";
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE resolution_time (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      incident_id BIGINT UNSIGNED NOT NULL,
      detected_at TIMESTAMP(3) NOT NULL,
      resolved_at TIMESTAMP(3) NULL,
      duration_seconds INT UNSIGNED NULL,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uq_resolution_time_incident (incident_id),
      CONSTRAINT fk_resolution_time_incident FOREIGN KEY (incident_id) REFERENCES incidents(id)
    ) ENGINE=InnoDB`);
    await queryRunner.query(`INSERT INTO resolution_time (incident_id, detected_at, resolved_at, duration_seconds) SELECT id, opened_at, resolved_at, TIMESTAMPDIFF(SECOND, opened_at, resolved_at) FROM incidents`);
  }
  public async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.query("DROP TABLE resolution_time"); }
}

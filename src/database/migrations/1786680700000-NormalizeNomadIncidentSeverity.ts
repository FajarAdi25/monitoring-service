import type { MigrationInterface, QueryRunner } from "typeorm";

export class NormalizeNomadIncidentSeverity1786680700000 implements MigrationInterface {
  name = "NormalizeNomadIncidentSeverity1786680700000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE incidents
      SET severity = CASE type
        WHEN 'NODE_DOWN' THEN 'CRITICAL'
        WHEN 'ALLOCATION_FAILED' THEN 'MAJOR'
        WHEN 'EVALUATION_BLOCKED' THEN 'MAJOR'
        WHEN 'DRIVER_UNHEALTHY' THEN 'WARNING'
        ELSE severity
      END
      WHERE source = 'NOMAD'
        AND type IN (
          'NODE_DOWN',
          'ALLOCATION_FAILED',
          'EVALUATION_BLOCKED',
          'DRIVER_UNHEALTHY'
        )
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op. Previous severity values cannot be reconstructed reliably.
  }
}

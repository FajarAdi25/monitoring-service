import type { MigrationInterface, QueryRunner } from "typeorm";

export class ResetNomadAllocationCurrentStates1786680300000 implements MigrationInterface {
  name = "ResetNomadAllocationCurrentStates1786680300000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // monitoring_current_states is derived data. Allocation rows created by
    // older versions used allocation ID as resource_key. Remove them so the
    // next Nomad pull rebuilds current state using the logical allocation slot.
    await queryRunner.query(`
      DELETE FROM monitoring_current_states
      WHERE source = 'NOMAD'
        AND resource_type = 'ALLOCATION'
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op. The deleted rows are derived from Nomad and are rebuilt by pulling.
  }
}

import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMonitoringCurrentStates1786680200000 implements MigrationInterface {
  name = "CreateMonitoringCurrentStates1786680200000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE monitoring_current_states (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        cluster_id BIGINT UNSIGNED NOT NULL,
        source VARCHAR(32) NOT NULL,
        resource_type VARCHAR(32) NOT NULL,
        resource_key VARCHAR(255) NOT NULL,
        resource_name VARCHAR(255) NULL,
        state VARCHAR(64) NOT NULL,
        payload_json JSON NULL,
        last_checked_at TIMESTAMP(3) NOT NULL,
        last_changed_at TIMESTAMP(3) NOT NULL,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_monitoring_current_states_resource (
          cluster_id,
          source,
          resource_type,
          resource_key
        ),
        KEY idx_monitoring_current_states_filter (
          cluster_id,
          source,
          resource_type,
          state
        ),
        KEY idx_monitoring_current_states_last_checked (last_checked_at)
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      INSERT INTO monitoring_current_states (
        cluster_id,
        source,
        resource_type,
        resource_key,
        resource_name,
        state,
        payload_json,
        last_checked_at,
        last_changed_at,
        created_at,
        updated_at
      )
      SELECT
        s.cluster_id,
        s.source,
        s.resource_type,
        s.resource_key,
        s.resource_name,
        s.state,
        s.payload_json,
        s.observed_at,
        s.observed_at,
        s.created_at,
        s.created_at
      FROM monitoring_snapshots s
      INNER JOIN (
        SELECT
          cluster_id,
          source,
          resource_type,
          resource_key,
          MAX(id) AS max_id
        FROM monitoring_snapshots
        GROUP BY cluster_id, source, resource_type, resource_key
      ) latest ON latest.max_id = s.id
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE monitoring_current_states");
  }
}

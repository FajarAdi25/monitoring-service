import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMonitoringSnapshots1786680100000 implements MigrationInterface {
  name = "CreateMonitoringSnapshots1786680100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE monitoring_snapshots (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        cluster_id BIGINT UNSIGNED NOT NULL,
        source VARCHAR(32) NOT NULL,
        resource_type VARCHAR(32) NOT NULL,
        resource_key VARCHAR(255) NOT NULL,
        resource_name VARCHAR(255) NULL,
        state VARCHAR(64) NOT NULL,
        payload_json JSON NULL,
        observed_at TIMESTAMP(3) NOT NULL,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        KEY idx_monitoring_snapshots_lookup (cluster_id, source, resource_type, resource_key, id),
        KEY idx_monitoring_snapshots_observed_at (observed_at)
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE monitoring_snapshots");
  }
}

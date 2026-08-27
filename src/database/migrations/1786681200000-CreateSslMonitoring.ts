// Version: 2.2.0
import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSslMonitoring1786681200000 implements MigrationInterface {
  name = "CreateSslMonitoring1786681200000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ssl_monitoring (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        cluster_id BIGINT UNSIGNED NOT NULL,
        valid_from TIMESTAMP(3) NOT NULL,
        expires_at TIMESTAMP(3) NOT NULL,
        days_remaining INT NOT NULL,
        subject_cn VARCHAR(255) NULL,
        issuer_cn VARCHAR(255) NULL,
        certificate_fingerprint256 VARCHAR(128) NULL,
        last_checked_at TIMESTAMP(3) NOT NULL,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_ssl_monitoring_cluster (cluster_id)
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE ssl_monitoring`);
  }
}

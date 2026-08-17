import type { MigrationInterface, QueryRunner } from "typeorm";

export class ConvertDateTimeColumnsToTimestamp1786680400000 implements MigrationInterface {
  name = "ConvertDateTimeColumnsToTimestamp1786680400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE incidents
        MODIFY opened_at TIMESTAMP(3) NOT NULL,
        MODIFY last_detected_at TIMESTAMP(3) NOT NULL,
        MODIFY last_notification_at TIMESTAMP(3) NULL,
        MODIFY next_notification_at TIMESTAMP(3) NULL,
        MODIFY acknowledged_at TIMESTAMP(3) NULL,
        MODIFY resolved_at TIMESTAMP(3) NULL,
        MODIFY closed_at TIMESTAMP(3) NULL,
        MODIFY created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        MODIFY updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    `);

    await queryRunner.query(`
      ALTER TABLE monitoring_snapshots
        MODIFY observed_at TIMESTAMP(3) NOT NULL,
        MODIFY created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    `);

    await queryRunner.query(`
      ALTER TABLE monitoring_current_states
        MODIFY last_checked_at TIMESTAMP(3) NOT NULL,
        MODIFY last_changed_at TIMESTAMP(3) NOT NULL,
        MODIFY created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        MODIFY updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE incidents
        MODIFY opened_at DATETIME(3) NOT NULL,
        MODIFY last_detected_at DATETIME(3) NOT NULL,
        MODIFY last_notification_at DATETIME(3) NULL,
        MODIFY next_notification_at DATETIME(3) NULL,
        MODIFY acknowledged_at DATETIME(3) NULL,
        MODIFY resolved_at DATETIME(3) NULL,
        MODIFY closed_at DATETIME(3) NULL,
        MODIFY created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        MODIFY updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    `);

    await queryRunner.query(`
      ALTER TABLE monitoring_snapshots
        MODIFY observed_at DATETIME(3) NOT NULL,
        MODIFY created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    `);

    await queryRunner.query(`
      ALTER TABLE monitoring_current_states
        MODIFY last_checked_at DATETIME(3) NOT NULL,
        MODIFY last_changed_at DATETIME(3) NOT NULL,
        MODIFY created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        MODIFY updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    `);
  }
}

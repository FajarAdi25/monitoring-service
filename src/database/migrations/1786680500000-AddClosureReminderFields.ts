import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddClosureReminderFields1786680500000 implements MigrationInterface {
  name = "AddClosureReminderFields1786680500000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE incidents
        ADD COLUMN closure_last_notification_at TIMESTAMP(3) NULL AFTER reminder_count,
        ADD COLUMN closure_next_notification_at TIMESTAMP(3) NULL AFTER closure_last_notification_at,
        ADD COLUMN closure_reminder_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER closure_next_notification_at,
        ADD KEY idx_incidents_closure_next_notification (status, closure_next_notification_at)
    `);

    await queryRunner.query(`
      UPDATE incidents
      SET next_notification_at = TIMESTAMPADD(MINUTE, 1, last_notification_at)
      WHERE status = 'OPEN'
        AND last_notification_at IS NOT NULL
    `);

    await queryRunner.query(`
      UPDATE incidents
      SET closure_next_notification_at = TIMESTAMPADD(MINUTE, 5, resolved_at)
      WHERE status = 'RESOLVED'
        AND resolved_at IS NOT NULL
        AND closure_next_notification_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE incidents
        DROP INDEX idx_incidents_closure_next_notification,
        DROP COLUMN closure_reminder_count,
        DROP COLUMN closure_next_notification_at,
        DROP COLUMN closure_last_notification_at
    `);
  }
}

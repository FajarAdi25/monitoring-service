import type { MigrationInterface, QueryRunner } from "typeorm";

export class ReplaceCloseWithPostpone1786680600000 implements MigrationInterface {
  name = "ReplaceCloseWithPostpone1786680600000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // CLOSED no longer exists. Preserve historical occurrences as RESOLVED
    // before removing closure-specific columns.
    await queryRunner.query(`
      UPDATE incidents
      SET resolved_at = COALESCE(resolved_at, closed_at, updated_at),
          status = 'RESOLVED',
          active_fingerprint = NULL,
          next_notification_at = NULL
      WHERE status = 'CLOSED'
    `);

    await queryRunner.query(`
      ALTER TABLE incidents
        DROP INDEX idx_incidents_closed_at,
        DROP INDEX idx_incidents_closure_next_notification,
        DROP COLUMN closure_reminder_count,
        DROP COLUMN closure_next_notification_at,
        DROP COLUMN closure_last_notification_at,
        DROP COLUMN resolution_code,
        DROP COLUMN resolution_note,
        DROP COLUMN closed_at,
        DROP COLUMN closed_by,
        ADD COLUMN postponed_at TIMESTAMP(3) NULL AFTER acknowledgement_note,
        ADD COLUMN postponed_by BIGINT UNSIGNED NULL AFTER postponed_at,
        ADD COLUMN postpone_until TIMESTAMP(3) NULL AFTER postponed_by,
        ADD COLUMN postpone_remark TEXT NULL AFTER postpone_until,
        ADD KEY idx_incidents_postpone_until (status, postpone_until)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE incidents
        DROP INDEX idx_incidents_postpone_until,
        DROP COLUMN postpone_remark,
        DROP COLUMN postpone_until,
        DROP COLUMN postponed_by,
        DROP COLUMN postponed_at,
        ADD COLUMN closure_last_notification_at TIMESTAMP(3) NULL AFTER reminder_count,
        ADD COLUMN closure_next_notification_at TIMESTAMP(3) NULL AFTER closure_last_notification_at,
        ADD COLUMN closure_reminder_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER closure_next_notification_at,
        ADD COLUMN resolution_code VARCHAR(32) NULL AFTER resolved_at,
        ADD COLUMN resolution_note TEXT NULL AFTER resolution_code,
        ADD COLUMN closed_at TIMESTAMP(3) NULL AFTER resolution_note,
        ADD COLUMN closed_by BIGINT UNSIGNED NULL AFTER closed_at,
        ADD KEY idx_incidents_closed_at (closed_at),
        ADD KEY idx_incidents_closure_next_notification (status, closure_next_notification_at)
    `);
  }
}

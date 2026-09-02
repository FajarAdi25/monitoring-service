import { MigrationInterface, QueryRunner, Table, TableIndex } from "typeorm";
export class CreateRelayDeliveries1786681300000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.createTable(
      new Table({
        name: "relay_deliveries",
        columns: [
          {
            name: "id",
            type: "bigint",
            isPrimary: true,
            isGenerated: true,
            generationStrategy: "increment",
            unsigned: true,
          },
          { name: "incident_id", type: "bigint", unsigned: true },
          { name: "event_type", type: "varchar", length: "16" },
          { name: "status", type: "varchar", length: "16" },
          { name: "retry_count", type: "int", default: 0 },
          { name: "last_error", type: "text", isNullable: true },
          { name: "next_retry_at", type: "timestamp", isNullable: true },
          {
            name: "created_at",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
          },
          {
            name: "updated_at",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
          },
        ],
      }),
    );
    await q.createIndex(
      "relay_deliveries",
      new TableIndex({
        name: "uq_relay_delivery_incident_event",
        columnNames: ["incident_id", "event_type"],
        isUnique: true,
      }),
    );
  }
  public async down(q: QueryRunner): Promise<void> {
    await q.dropTable("relay_deliveries");
  }
}

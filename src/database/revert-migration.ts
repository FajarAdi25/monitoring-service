import { AppDataSource } from "./data-source";

async function main(): Promise<void> {
  await AppDataSource.initialize();
  await AppDataSource.undoLastMigration();
  console.log("Reverted last migration.");
  await AppDataSource.destroy();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

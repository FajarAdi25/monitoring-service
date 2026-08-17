import { AppDataSource } from "./data-source";

async function main(): Promise<void> {
  await AppDataSource.initialize();
  const migrations = await AppDataSource.runMigrations();
  console.log(`Applied ${migrations.length} migration(s).`);
  await AppDataSource.destroy();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

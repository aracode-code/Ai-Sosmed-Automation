import { openDatabase } from '../client';
import { appliedMigrations, runMigrations } from '../migrate';

const databasePath = process.env.DATABASE_PATH ?? './data/database/app.sqlite';

const db = openDatabase(databasePath);
try {
  const changed = runMigrations(db.raw);
  const all = appliedMigrations(db.raw);
  console.log(`database: ${databasePath}`);
  console.log(`applied now: ${changed.length === 0 ? 'none' : changed.join(', ')}`);
  console.log(`total applied: ${all.length} [${all.join(', ')}]`);
} finally {
  db.close();
}

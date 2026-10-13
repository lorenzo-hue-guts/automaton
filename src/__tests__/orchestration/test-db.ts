import type BetterSqlite3 from "better-sqlite3";
import { createDatabase } from "../../state/database.js";

export type TestDatabase = BetterSqlite3.Database;

export function createInMemoryDb(): TestDatabase {
  // Exercise the same migrations as production instead of a V10-only fixture.
  return createDatabase(":memory:").raw;
}

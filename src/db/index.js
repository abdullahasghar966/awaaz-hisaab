import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), 'schema.sql');

// Tracks transaction nesting depth per database handle.
const depthByDb = new WeakMap();

export function openDatabase(path = ':memory:') {
  const inMemory = path === ':memory:';
  if (!inMemory) mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (!inMemory) db.exec('PRAGMA journal_mode = WAL;');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  return db;
}

export function withTransaction(db, fn) {
  // Re-entrant: if a transaction is already open on this handle, just run inside it.
  if ((depthByDb.get(db) ?? 0) > 0) return fn();

  db.exec('BEGIN IMMEDIATE');
  depthByDb.set(db, 1);
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback failure; the original error is more useful.
    }
    throw err;
  } finally {
    depthByDb.set(db, 0);
  }
}

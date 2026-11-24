import { openDatabase } from '../../src/db/index.js';

export function createTestDb() {
  return openDatabase(':memory:');
}

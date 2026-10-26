import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const dir = resolve(process.cwd(), process.env.PGLITE_DIR ?? '.data/pgdata');

if (!dir.includes('.data')) {
  throw new Error(`Refusing to delete ${dir}: only local .data folders can be reset.`);
}

await rm(dir, { recursive: true, force: true });
console.log(`Removed local database at ${dir}`);

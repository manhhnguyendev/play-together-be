import 'dotenv/config';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const dir = resolve(process.cwd(), process.env.PGLITE_DIR ?? '.data/pgdata');

if (!dir.includes('.data') || dir.includes('.bak')) {
  throw new Error(`Refusing to delete ${dir}: only local .data folders can be reset, never a .bak copy.`);
}

console.log(`Removing local database at ${dir}`);
await rm(dir, { recursive: true, force: true });

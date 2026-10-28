import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = process.env.OPENAPI_URL ?? 'http://localhost:3000/docs-json';
const target = fileURLToPath(new URL('../openapi.json', import.meta.url));

const response = await fetch(source);
if (!response.ok) {
  throw new Error(`Cannot read the OpenAPI document from ${source} (HTTP ${response.status}). Start the API first.`);
}

const spec = await response.json();
await writeFile(target, `${JSON.stringify(spec, null, 2)}\n`);
console.log(`Wrote ${Object.keys(spec.paths ?? {}).length} paths to ${target}`);

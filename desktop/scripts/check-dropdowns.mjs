import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const violations = [];
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await inspect(path);
    else if (/\.[jt]sx?$/.test(entry.name)) {
      const source = await readFile(path, 'utf8');
      if (/<(?:select|datalist)\b/.test(source)) violations.push(path);
    }
  }
}
await inspect(root);
if (violations.length) {
  console.error('Native dropdowns do not reliably scale with app zoom. Use components/Select.tsx:\n' + violations.join('\n'));
  process.exitCode = 1;
}

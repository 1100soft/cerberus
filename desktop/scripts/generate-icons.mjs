import {copyFileSync, mkdirSync, readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(desktop, 'src-tauri/app-icon.svg');
const output = resolve(desktop, 'src-tauri/icons');
const cli = resolve(desktop, 'node_modules/@tauri-apps/cli/tauri.js');
const generate = args => {
  const result = spawnSync(process.execPath, [cli, 'icon', source, '--output', output, ...args], {stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

// Default platform assets plus standalone exports of the same design at every size.
generate(['--ios-color', '#17141f']);
// Tauri's compositing can leave alpha=254 at antialiased edges. App Store icons
// must have no alpha channel, even when that difference is visually imperceptible.
const ios = resolve(output, 'ios');
const opaque = spawnSync('magick', ['mogrify', '-alpha', 'off', '-define', 'png:color-type=2',
  ...readdirSync(ios).filter(name => name.endsWith('.png')).map(name => resolve(ios, name))], {stdio: 'inherit'});
if (opaque.error) throw new Error('Icon generation requires ImageMagick 7 (magick).', {cause: opaque.error});
if (opaque.status !== 0) process.exit(opaque.status ?? 1);

generate([16, 24, 48, 256, 512, 1024].flatMap(size => ['--png', String(size)]));
mkdirSync(resolve(desktop, 'public'), {recursive: true});
copyFileSync(source, resolve(desktop, 'public/app-icon.svg'));
copyFileSync(source, resolve(desktop, '../website/assets/logo.svg'));

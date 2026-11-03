import {copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
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
const opaque = spawnSync('magick', ['mogrify', '-alpha', 'off', '-strip', '-define', 'png:color-type=2',
  ...readdirSync(ios).filter(name => name.endsWith('.png')).map(name => resolve(ios, name))], {stdio: 'inherit'});
if (opaque.error) throw new Error('Icon generation requires ImageMagick 7 (magick).', {cause: opaque.error});
if (opaque.status !== 0) process.exit(opaque.status ?? 1);

generate([16, 24, 48, 256, 512, 1024].flatMap(size => ['--png', String(size)]));
mkdirSync(resolve(desktop, 'public'), {recursive: true});
copyFileSync(source, resolve(desktop, 'public/app-icon.svg'));
copyFileSync(source, resolve(desktop, '../website/assets/logo.svg'));

// The source ends with the foreground head and eye. Use their compound silhouette
// as a monochrome decoration, keeping it synchronized without another app badge.
const paths = [...readFileSync(source, 'utf8').matchAll(/<path\b[^>]*\/>/g)].slice(-2);
const silhouette = paths.map(([path]) => path.match(/\bd="([^"]+)"/)[1]).join(' ');
writeFileSync(resolve(desktop, 'public/cerberus-head.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="#B7A7FF" fill-rule="evenodd" d="${silhouette}"/></svg>\n`);

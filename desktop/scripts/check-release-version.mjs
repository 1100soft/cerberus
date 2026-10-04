import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url)));
const cargo = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
const packageSection = cargo.match(/\[package\]([\s\S]*?)(?=\n\[|$)/)?.[1];
const version = packageSection?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
assert.equal(version, config.version, 'Cargo and Tauri app versions must agree');
if (process.env.RELEASE_TAG) {
  assert.equal(process.env.RELEASE_TAG, `v${version}`, 'Release tag must match the app version');
}
console.log(`Release version verified: ${version}`);

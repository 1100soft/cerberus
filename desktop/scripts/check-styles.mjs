import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const css=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
assert.ok(!/^import .*from /m.test(css),'Stylesheet contains JavaScript imports');
assert.ok(css.includes('.shell')&&css.includes('.branch-group-tabs'),'Core application layout styles missing');
console.log('Stylesheet integrity checks passed');

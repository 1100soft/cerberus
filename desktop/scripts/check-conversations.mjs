import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
const source = await readFile(new URL('../src/lib/conversationText.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { cursorDisplayText } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const raw = '<timestamp>Friday</timestamp>\n<system_notification>Finished.\n<task>status: aborted\ntask_id: 547463</task></system_notification>\n<user_query>Inform the user.</user_query>';
for (const input of [raw, raw.replaceAll('<', '\\<').replaceAll('_', '\\_')]) {
  const text = cursorDisplayText(input);
  assert.ok(!text.includes('<'));
  const html = renderToStaticMarkup(React.createElement(Markdown, null, text));
  assert.ok(html.includes('System notification'));
  assert.ok(html.includes('status: aborted'));
  assert.ok(html.includes('task_id: 547463'));
  assert.ok(html.includes('Inform the user.'));
}
for (const input of ['```xml\n<user_query>example</user_query>\n```', 'Discuss <task>XML</task>', 'C:\\Users\\name', '<user_query>unclosed']) {
  assert.equal(cursorDisplayText(input), input);
}
assert.equal(cursorDisplayText('<user_query>```xml\n<task>sample</task>\n```</user_query>'), '```xml\n<task>sample</task>\n```');
const html = renderToStaticMarkup(React.createElement(Markdown, null, 'First\\\nSecond\n\n```sh\necho one \\\n two\n```'));
assert.ok(html.includes('First<br/>\nSecond'));
assert.ok(html.includes('echo one \\\n two'));
console.log('Conversation formatting checks passed');

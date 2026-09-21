import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatJsonAsHtml, emitHtml, emitStructuredOutput } from '../src/utils/htmlOutput.js';

test('formatJsonAsHtml - embeds the title and escapes HTML-significant characters in the data', () => {
  const html = formatJsonAsHtml('My Report', { note: '<script>alert(1)</script> & "quotes"' });

  assert.match(html, /<title>My Report<\/title>/);
  assert.match(html, /<h1>My Report<\/h1>/);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&amp; \\"quotes\\"/);
});

test('emitHtml - writes to a file when a path is given', () => {
  const dir = mkdtempSync(join(tmpdir(), 'html-output-test-'));
  const outPath = join(dir, 'out.html');

  emitHtml('<p>hi</p>', outPath);

  assert.ok(existsSync(outPath));
  assert.equal(readFileSync(outPath, 'utf-8'), '<p>hi</p>');
});

test('emitStructuredOutput - html option wins over json, and returns true when it handled output', () => {
  let captured = '';
  const originalLog = console.log;
  console.log = (msg: string) => { captured = msg; };
  try {
    const handled = emitStructuredOutput({ a: 1 }, 'Title', { json: true, html: true });
    assert.equal(handled, true);
    assert.match(captured, /<title>Title<\/title>/);
  } finally {
    console.log = originalLog;
  }
});

test('emitStructuredOutput - falls back to plain JSON when only json is set', () => {
  let captured = '';
  const originalLog = console.log;
  console.log = (msg: string) => { captured = msg; };
  try {
    const handled = emitStructuredOutput({ a: 1 }, 'Title', { json: true });
    assert.equal(handled, true);
    assert.equal(captured, JSON.stringify({ a: 1 }, null, 2));
  } finally {
    console.log = originalLog;
  }
});

test('emitStructuredOutput - returns false when neither json nor html is set (caller should print human output)', () => {
  const handled = emitStructuredOutput({ a: 1 }, 'Title', {});
  assert.equal(handled, false);
});

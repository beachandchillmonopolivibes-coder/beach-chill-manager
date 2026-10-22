'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const ids = [...html.matchAll(/\bid\s*=\s*"([^"]+)"/g)].map(match => match[1]);

test('HTML has unique element IDs and all imperative app references resolve', () => {
  assert.equal(new Set(ids).size, ids.length, 'duplicate IDs break admin forms and score cards');
  const known = new Set(ids);
  const missing = [...new Set([...app.matchAll(/(?<!\$)\$\(['"]([^'"]+)['"]\)/g)].map(match => match[1]))]
    .filter(id => !known.has(id));
  assert.deepEqual(missing, [], 'bootstrap or admin action refers to an absent DOM element');
});

test('Every navigation target and local entry-point asset exists', () => {
  const known = new Set(ids);
  for (const match of html.matchAll(/\bdata-tab="([^"]+)"/g)) {
    assert.ok(known.has(match[1]), `missing navigation view: ${match[1]}`);
  }
  const sources = [...html.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)="([^"]+)"/g)]
    .map(match => match[1]);
  for (const source of sources) {
    if (/^(?:[a-z]+:|\/\/|\/_vercel\/|#)/i.test(source)) continue;
    const local = path.resolve(root, source.split(/[?#]/)[0]);
    assert.ok(local.startsWith(root + path.sep), `asset outside package: ${source}`);
    assert.ok(fs.existsSync(local), `entry point asset missing: ${source}`);
  }
});

test('Browser scripts parse independently before deployment', () => {
  for (const name of ['engine.js', 'db.js', 'app.js', 'sw.js', 'config.js']) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(root, name), 'utf8'), { filename: name }));
  }
});

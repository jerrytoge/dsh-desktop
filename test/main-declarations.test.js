'use strict';

// Guards the Electron shell sources against a silent, syntax-valid breakage:
// a top-level declaration merged onto the tail of a preceding `//` comment.
//
// This really happened while editing main.js — an edit whose old/new text
// differed only by a trailing newline turned
//     // any network error is logged and ignored.
//     const UPDATE_CHECK_DISABLED = ...
// into a single comment line. `node --check` passed and the unit suite passed,
// because a commented-out declaration is still valid JavaScript; the app only
// failed later at boot with "UPDATE_CHECK_DISABLED is not defined".

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const shellSources = [
  'main.js',
  ...fs
    .readdirSync(path.join(root, 'lib'))
    .filter((name) => name.endsWith('.js'))
    .sort()
    .map((name) => path.join('lib', name)),
];

// A declaration keyword appearing *after* a line comment, followed by an
// assignment or parameter list, means real code got swallowed.
const SWALLOWED_DECLARATION = /\/\/.*\b(?:const|let|var|function|class)\s+[A-Za-z_$][\w$]*\s*[=(]/;

test('no shell declaration is swallowed by a trailing line comment', () => {
  assert.ok(shellSources.length > 1, 'expected to scan main.js plus lib modules');
  for (const relative of shellSources) {
    const lines = fs.readFileSync(path.join(root, relative), 'utf8').split('\n');
    lines.forEach((line, index) => {
      assert.doesNotMatch(
        line,
        SWALLOWED_DECLARATION,
        `${relative}:${index + 1} has a declaration inside a comment: ${line.trim()}`
      );
    });
  }
});

test('update-check flags referenced at boot are declared at module scope', () => {
  const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  // Pin the identifiers that boot() depends on, so removing or commenting one
  // out fails here instead of at runtime.
  for (const name of ['SMOKE', 'UPDATE_CHECK_DISABLED', 'GITHUB_API', 'REPO', 'RELEASES_PAGE']) {
    assert.match(source, new RegExp(`^const ${name}\\b`, 'm'), `${name} must stay declared`);
  }
  // ...and that the boot guard still reads them.
  assert.match(source, /if \(!UPDATE_CHECK_DISABLED && !SMOKE\)/);
});

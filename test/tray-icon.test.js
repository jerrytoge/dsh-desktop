'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const { PNG_16, PNG_32, createTrayIcon } = require('../lib/tray-icon');

// Minimal PNG reader: enough to prove the embedded bytes really are the two
// sizes AppKit needs, without pulling in an image library.
function decodePng(buffer) {
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, 'PNG signature');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];

  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  return { width, height, bitDepth, colorType, raw: zlib.inflateSync(Buffer.concat(chunks)) };
}

test('the embedded icons are 16pt and 32pt RGBA template images', () => {
  const small = decodePng(Buffer.from(PNG_16, 'base64'));
  const large = decodePng(Buffer.from(PNG_32, 'base64'));

  assert.deepEqual([small.width, small.height], [16, 16]);
  assert.deepEqual([large.width, large.height], [32, 32]);
  for (const png of [small, large]) {
    assert.equal(png.bitDepth, 8);
    assert.equal(png.colorType, 6, 'must carry an alpha channel to work as a template');
  }
});

test('the glyph is neither blank nor a solid block', () => {
  const { width, height, raw } = decodePng(Buffer.from(PNG_16, 'base64'));
  let opaque = 0;
  let transparent = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = raw[y * (width * 4 + 1) + 1 + x * 4 + 3];
      if (alpha > 0) opaque++;
      else transparent++;
    }
  }
  assert.ok(opaque > 20, `expected a visible glyph, got ${opaque} opaque pixels`);
  assert.ok(transparent > 20, 'the icon must be mostly transparent to sit in the menu bar');
});

test('createTrayIcon registers both scales and marks the image as a template', () => {
  const calls = [];
  const image = {
    addRepresentation: (rep) => calls.push(rep),
    setTemplateImage: (value) => calls.push({ template: value }),
  };
  const nativeImage = {
    createFromBuffer: (buffer, options) => {
      calls.push({ buffer: buffer.toString('base64'), options });
      return image;
    },
  };

  assert.equal(createTrayIcon(nativeImage), image);
  const created = calls.find((c) => c.options);
  assert.equal(created.options.scaleFactor, 1);
  assert.equal(created.buffer, PNG_16, 'the 1x buffer is the 16pt icon');
  const rep = calls.find((c) => c.buffer !== undefined && !c.options);
  assert.equal(rep.scaleFactor, 2);
  assert.equal(rep.buffer.toString('base64'), PNG_32);
  assert.ok(calls.some((c) => c.template === true), 'template mode is what makes AppKit recolour it');
});

test('the shell surfaces the tray only while an update is pending', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

  assert.match(main, /function syncUpdateTray\(/);
  // Shown only when there is an update, and torn down when there is not.
  assert.match(main, /if \(!hasUpdate\)[\s\S]{0,160}updateTray\.destroy\(\)/);
  assert.match(main, /updateTray = new Tray\(createTrayIcon\(nativeImage\)\)/);
  assert.match(main, /updateTray\.setToolTip\(/);
  assert.match(main, /buildTrayMenuTemplate\(\{/);
  // Wired into the same state transition as the badge, and cleaned up on quit.
  assert.match(main, /setUpdateBadge\(\);[\s\S]{0,40}syncUpdateTray\(\)/);
  assert.match(main, /before-quit[\s\S]{0,400}updateTray\.destroy\(\)/);
  // Never let a menu-bar icon take down the shell.
  assert.match(main, /update tray failed \(ignored\)/);
});

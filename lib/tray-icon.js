'use strict';

// Menu-bar icon for the actionable update entry.
//
// A macOS "template image": black pixels plus an alpha channel, which AppKit
// recolours for light and dark menu bars automatically. It is embedded as base64
// rather than shipped as a binary asset so there is no extra build file to keep
// in sync or forget to package.
//
// The glyph is a download arrow (stem + head) above a tray baseline, drawn on a
// 16x16 grid and rendered at 1x and 2x.

const PNG_16 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAK0lEQVR42mNgGOzgPxSPGkBvA/7jwRQZwkCJSygKg4FJuv/JDUyKDSAZAAAvvC/RLzjc3wAAAABJRU5ErkJggg==';
const PNG_32 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAASElEQVR42u3WQQoAIAgFUe9/adu7U8IvOgPuH2SRGVE9DwMAAAAAAPYCvDh7AFmI/Cjal6/9FsgBESL/ktG4F/DbkgKQA270AID0v0E6nSeJAAAAAElFTkSuQmCC';

// `nativeImage` is injected so this module stays testable without Electron.
function createTrayIcon(nativeImage) {
  const image = nativeImage.createFromBuffer(Buffer.from(PNG_16, 'base64'), { scaleFactor: 1 });
  image.addRepresentation({ scaleFactor: 2, buffer: Buffer.from(PNG_32, 'base64') });
  image.setTemplateImage(true);
  return image;
}

module.exports = { PNG_16, PNG_32, createTrayIcon };

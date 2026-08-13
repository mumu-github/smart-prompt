#!/usr/bin/env node

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const root = path.resolve(__dirname, "..");

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

function pngDimensions(file) {
  const absolute = path.join(root, file);
  const buffer = fs.readFileSync(absolute);
  assert.equal(buffer.slice(0, 8).toString("hex"), "89504e470d0a1a0a", `${file} is not a PNG`);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function assertPngSize(file, size) {
  const dimensions = pngDimensions(file);
  assert.deepEqual(dimensions, { width: size, height: size }, `${file} must be ${size}x${size}`);
}

function assertMeaningfulIconBytes(file, minBytes) {
  const absolute = path.join(root, file);
  const bytes = fs.statSync(absolute).size;
  assert.ok(bytes >= minBytes, `${file} looks too small to be a meaningful icon (${bytes} bytes)`);
}

function paethPredictor(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  if (upDistance <= upperLeftDistance) {
    return up;
  }
  return upperLeft;
}

function pngVisibleBounds(file) {
  const absolute = path.join(root, file);
  const buffer = fs.readFileSync(absolute);
  assert.equal(buffer.slice(0, 8).toString("hex"), "89504e470d0a1a0a", `${file} is not a PNG`);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.slice(offset + 4, offset + 8).toString("ascii");
    const data = buffer.slice(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }

  assert.equal(bitDepth, 8, `${file} must use 8-bit PNG data`);
  const bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 0;
  assert.ok(bytesPerPixel > 0, `${file} uses unsupported PNG color type ${colorType}`);
  const rowLength = width * bytesPerPixel;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const rows = [];
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[cursor];
    cursor += 1;
    const row = Buffer.from(inflated.slice(cursor, cursor + rowLength));
    cursor += rowLength;
    const prior = rows[y - 1] || Buffer.alloc(rowLength);
    for (let index = 0; index < rowLength; index += 1) {
      const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
      const up = prior[index] || 0;
      const upperLeft = index >= bytesPerPixel ? prior[index - bytesPerPixel] || 0 : 0;
      if (filter === 1) {
        row[index] = (row[index] + left) & 0xff;
      } else if (filter === 2) {
        row[index] = (row[index] + up) & 0xff;
      } else if (filter === 3) {
        row[index] = (row[index] + Math.floor((left + up) / 2)) & 0xff;
      } else if (filter === 4) {
        row[index] = (row[index] + paethPredictor(left, up, upperLeft)) & 0xff;
      } else {
        assert.equal(filter, 0, `${file} uses unsupported PNG row filter ${filter}`);
      }
    }
    rows.push(row);
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const row = rows[y];
    for (let x = 0; x < width; x += 1) {
      const pixel = x * bytesPerPixel;
      const alpha = colorType === 6 ? row[pixel + 3] : colorType === 4 ? row[pixel + 1] : 255;
      if (alpha > 12) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return {
    width,
    height,
    visibleWidth: maxX >= minX ? maxX - minX + 1 : 0,
    visibleHeight: maxY >= minY ? maxY - minY + 1 : 0
  };
}

function assertVisibleBounds(file, minVisibleWidth, minVisibleHeight) {
  const bounds = pngVisibleBounds(file);
  assert.ok(
    bounds.visibleWidth >= minVisibleWidth && bounds.visibleHeight >= minVisibleHeight,
    `${file} visible bounds are too small (${bounds.visibleWidth}x${bounds.visibleHeight})`
  );
}

function icoEntries(file) {
  const buffer = fs.readFileSync(path.join(root, file));
  assert.equal(buffer.readUInt16LE(0), 0, `${file} has invalid reserved header`);
  assert.equal(buffer.readUInt16LE(2), 1, `${file} must be an icon file`);
  const count = buffer.readUInt16LE(4);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    entries.push({
      width: buffer[offset] || 256,
      height: buffer[offset + 1] || 256,
      bitCount: buffer.readUInt16LE(offset + 6),
      bytes: buffer.readUInt32LE(offset + 8)
    });
  }
  return entries;
}

const brandSizes = [16, 32, 48, 64, 128, 256, 512, 1024];
for (const size of brandSizes) {
  assertPngSize(`assets/brand/smart-prompt-icon-${size}.png`, size);
}
assertPngSize("assets/brand/smart-prompt-icon-source.png", 1254);
assertPngSize("assets/brand/smart-prompt-tray-32.png", 32);
assertMeaningfulIconBytes("assets/brand/smart-prompt-tray-32.png", 1000);
assertVisibleBounds("assets/brand/smart-prompt-tray-32.png", 22, 29);

const extensionIcons = {
  "16": "assets/icons/icon-16.png",
  "32": "assets/icons/icon-32.png",
  "48": "assets/icons/icon-48.png",
  "128": "assets/icons/icon-128.png"
};
const manifest = readJson("prototypes/browser-extension/manifest.json");
assert.deepEqual(manifest.icons, extensionIcons);
assert.deepEqual(manifest.action.default_icon, extensionIcons);
for (const [size, file] of Object.entries(extensionIcons)) {
  assertPngSize(path.join("prototypes/browser-extension", file), Number(size));
}

const tauriConfig = readJson("apps/desktop-shell/src-tauri/tauri.conf.json");
const tauriMain = fs.readFileSync(path.join(root, "apps/desktop-shell/src-tauri/src/main.rs"), "utf8");
const tauriCargo = fs.readFileSync(path.join(root, "apps/desktop-shell/src-tauri/Cargo.toml"), "utf8");
assert.deepEqual(tauriConfig.bundle.icon, [
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.png",
  "icons/icon.ico"
]);
assertPngSize("apps/desktop-shell/src-tauri/icons/32x32.png", 32);
assertPngSize("apps/desktop-shell/src-tauri/icons/128x128.png", 128);
assertPngSize("apps/desktop-shell/src-tauri/icons/128x128@2x.png", 256);
assertPngSize("apps/desktop-shell/src-tauri/icons/icon.png", 512);
assertPngSize("apps/desktop-shell/src-tauri/icons/tray.png", 32);
assertMeaningfulIconBytes("apps/desktop-shell/src-tauri/icons/tray.png", 1000);
assertVisibleBounds("apps/desktop-shell/src-tauri/icons/tray.png", 22, 29);
assert.ok(tauriCargo.includes('features = ["tray-icon", "image-png"]'));
assert.ok(tauriMain.includes("Image::from_bytes(include_bytes!(\"../icons/tray.png\"))"));
assert.ok(tauriMain.includes("TrayIconBuilder::with_id(\"smart-prompt\")"));
assert.ok(tauriMain.includes("tray_builder.icon(icon)"));
assert.ok(tauriMain.includes("app.manage(tray)"));

const entries = icoEntries("apps/desktop-shell/src-tauri/icons/icon.ico");
assert.deepEqual(entries.map((entry) => entry.width), [16, 32, 48, 64, 128, 256]);
assert.deepEqual(entries.map((entry) => entry.height), [16, 32, 48, 64, 128, 256]);
assert.ok(entries.every((entry) => entry.bitCount === 32));
assert.ok(entries.every((entry) => entry.bytes > 0));

console.log("brand icon checks passed");

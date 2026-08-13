#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "assets", "ui-ux", "mascot-states", "normal.png");
const brandDir = path.join(root, "assets", "brand");
const extensionIconDir = path.join(root, "prototypes", "browser-extension", "assets", "icons");
const desktopIconDir = path.join(root, "apps", "desktop-shell", "src-tauri", "icons");

const brandSizes = [16, 32, 48, 64, 128, 256, 512, 1024];
const extensionSizes = [16, 32, 48, 128];
const icoSizes = [16, 32, 48, 64, 128, 256];
const trayIconSize = 32;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ffmpegPath() {
  const command = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(command, ["ffmpeg"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error("ffmpeg was not found on PATH. Install FFmpeg or add it to PATH before regenerating icons.");
  }
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "ffmpeg";
}

function renderPng(ffmpeg, size, output) {
  ensureDir(path.dirname(output));
  const filter = [
    `scale=${size}:${size}:force_original_aspect_ratio=decrease`,
    `pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
    "format=rgba"
  ].join(",");
  const result = spawnSync(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    source,
    "-vf",
    filter,
    "-frames:v",
    "1",
    output
  ], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed for ${output}: ${result.stderr || result.stdout}`);
  }
}

function renderTrayPng(ffmpeg, output) {
  ensureDir(path.dirname(output));
  const sourceCrop = { x: 316, y: 171, width: 664, height: 864 };
  const mascotSize = 30;
  const filter = [
    `crop=${sourceCrop.width}:${sourceCrop.height}:${sourceCrop.x}:${sourceCrop.y}`,
    `scale=${mascotSize}:${mascotSize}:force_original_aspect_ratio=decrease`,
    `pad=${trayIconSize}:${trayIconSize}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
    "format=rgba"
  ].join(",");
  const result = spawnSync(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    source,
    "-vf",
    filter,
    "-frames:v",
    "1",
    output
  ], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed for ${output}: ${result.stderr || result.stdout}`);
  }
}

function pngDimensions(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`${file} is not a PNG`);
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function buildIco(entries, output) {
  let offset = 6 + entries.length * 16;
  const header = Buffer.alloc(offset);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const payloads = entries.map((entry, index) => {
    const file = path.join(brandDir, `smart-prompt-icon-${entry}.png`);
    const data = fs.readFileSync(file);
    const cursor = 6 + index * 16;
    header[cursor] = entry === 256 ? 0 : entry;
    header[cursor + 1] = entry === 256 ? 0 : entry;
    header[cursor + 2] = 0;
    header[cursor + 3] = 0;
    header.writeUInt16LE(1, cursor + 4);
    header.writeUInt16LE(32, cursor + 6);
    header.writeUInt32LE(data.length, cursor + 8);
    header.writeUInt32LE(offset, cursor + 12);
    offset += data.length;
    return data;
  });

  fs.writeFileSync(output, Buffer.concat([header, ...payloads]));
}

function copyFile(from, to) {
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
}

function main() {
  if (!fs.existsSync(source)) {
    throw new Error(`Missing mascot source: ${source}`);
  }
  const ffmpeg = ffmpegPath();
  ensureDir(brandDir);
  ensureDir(extensionIconDir);
  ensureDir(desktopIconDir);

  copyFile(source, path.join(brandDir, "smart-prompt-icon-source.png"));

  for (const size of brandSizes) {
    renderPng(ffmpeg, size, path.join(brandDir, `smart-prompt-icon-${size}.png`));
  }
  renderTrayPng(ffmpeg, path.join(brandDir, "smart-prompt-tray-32.png"));

  for (const size of extensionSizes) {
    copyFile(
      path.join(brandDir, `smart-prompt-icon-${size}.png`),
      path.join(extensionIconDir, `icon-${size}.png`)
    );
  }

  copyFile(path.join(brandDir, "smart-prompt-icon-32.png"), path.join(desktopIconDir, "32x32.png"));
  copyFile(path.join(brandDir, "smart-prompt-icon-128.png"), path.join(desktopIconDir, "128x128.png"));
  copyFile(path.join(brandDir, "smart-prompt-icon-256.png"), path.join(desktopIconDir, "128x128@2x.png"));
  copyFile(path.join(brandDir, "smart-prompt-icon-512.png"), path.join(desktopIconDir, "icon.png"));
  copyFile(path.join(brandDir, "smart-prompt-tray-32.png"), path.join(desktopIconDir, "tray.png"));
  buildIco(icoSizes, path.join(desktopIconDir, "icon.ico"));

  const generated = [
    path.join(brandDir, "smart-prompt-icon-source.png"),
    ...brandSizes.map((size) => path.join(brandDir, `smart-prompt-icon-${size}.png`)),
    path.join(brandDir, "smart-prompt-tray-32.png"),
    ...extensionSizes.map((size) => path.join(extensionIconDir, `icon-${size}.png`)),
    "32x32.png",
    "128x128.png",
    "128x128@2x.png",
    "icon.png",
    "tray.png",
    "icon.ico"
  ];

  for (const file of generated) {
    const absolute = path.isAbsolute(file) ? file : path.join(desktopIconDir, file);
    if (!fs.existsSync(absolute)) {
      throw new Error(`Expected generated file missing: ${absolute}`);
    }
    if (absolute.endsWith(".png")) {
      const dimensions = pngDimensions(absolute);
      if (dimensions.width !== dimensions.height) {
        throw new Error(`Expected square PNG: ${absolute}`);
      }
    }
  }

  console.log(`Generated Smart Prompt brand icons from ${path.relative(root, source)}`);
}

main();

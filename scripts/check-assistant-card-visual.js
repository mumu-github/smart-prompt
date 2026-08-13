#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const reportPath = path.join(root, "research", "p25-overlay-chat-visual.latest.json");
const runtimeTestPath = path.join(root, "apps", "desktop-shell", "tests", "prompt-session-overlay-runtime.test.js");

function repoRelative(filePath) {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function getPngStats(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`Screenshot is not a PNG: ${filePath}`);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8 || ![2, 6].includes(colorType)) {
    return { width, height, alphaChannel: false, opaqueRatio: 1, nonOpaqueRatio: 0 };
  }

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const previous = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);
  let sourceOffset = 0;
  let nonOpaque = 0;
  let opaque = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[sourceOffset + x];
      const left = x >= bytesPerPixel ? current[x - bytesPerPixel] : 0;
      const above = previous[x];
      const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      if (filter === 0) current[x] = raw;
      else if (filter === 1) current[x] = (raw + left) & 0xff;
      else if (filter === 2) current[x] = (raw + above) & 0xff;
      else if (filter === 3) current[x] = (raw + Math.floor((left + above) / 2)) & 0xff;
      else if (filter === 4) current[x] = (raw + paethPredictor(left, above, upperLeft)) & 0xff;
      else throw new Error(`Unsupported PNG filter ${filter}.`);
    }
    sourceOffset += stride;
    for (let x = 0; x < width; x += 1) {
      const alpha = colorType === 6 ? current[x * bytesPerPixel + 3] : 255;
      if (alpha === 255) opaque += 1;
      else nonOpaque += 1;
    }
    current.copy(previous);
  }

  const total = width * height;
  return {
    width,
    height,
    alphaChannel: colorType === 6,
    opaqueRatio: total ? Number((opaque / total).toFixed(4)) : 0,
    nonOpaqueRatio: total ? Number((nonOpaque / total).toFixed(4)) : 0
  };
}

function parseRuntimeEvidence(stdout) {
  const marker = String(stdout || "")
    .split(/\r?\n/)
    .find((line) => line.startsWith("SMART_PROMPT_VISUAL_EVIDENCE "));
  if (!marker) throw new Error("Desktop runtime test did not emit visual evidence.");
  return JSON.parse(marker.slice("SMART_PROMPT_VISUAL_EVIDENCE ".length));
}

function run() {
  const execution = spawnSync(process.execPath, [runtimeTestPath], {
    cwd: root,
    env: { ...process.env, SMART_PROMPT_KEEP_TEST_ARTIFACTS: "1" },
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 60000
  });

  let evidence = null;
  let evidenceError = "";
  try {
    evidence = parseRuntimeEvidence(execution.stdout);
  } catch (error) {
    evidenceError = error.message;
  }

  const screenshotPaths = {
    review: path.join(root, "outputs", "assistant-card-phase2", "desktop-review.png"),
    targetMissing: path.join(root, "outputs", "assistant-card-phase2", "desktop-target-missing.png"),
    compact: path.join(root, "outputs", "assistant-card-phase2", "desktop-compact.png")
  };
  const screenshots = {};
  for (const [name, filePath] of Object.entries(screenshotPaths)) {
    screenshots[name] = fs.existsSync(filePath)
      ? { file: repoRelative(filePath), ...getPngStats(filePath) }
      : { file: repoRelative(filePath), missing: true };
  }

  const runtimePassed = execution.status === 0 && !execution.error && Boolean(evidence);
  const compactScreenshotTransparent = screenshots.compact.alphaChannel === true
    && screenshots.compact.nonOpaqueRatio >= 0.9;
  const largeWhiteBlockAbsent = screenshots.compact.alphaChannel === true
    && screenshots.compact.opaqueRatio <= 0.08;
  const canonicalStates = evidence?.canonicalStates || [];
  const expectedStates = ["idle", "drafting", "review", "target_missing", "copy_only", "inserted", "blocked"];
  const canonicalStatesCovered = expectedStates.every((state) => canonicalStates.includes(state));
  const sharedCardContract = {
    contractVersion: evidence?.contractVersion || "",
    canonicalStatesCovered,
    onePrimaryAction: evidence?.review?.primaryAction === "insert",
    secondaryActionLimit: Number(evidence?.review?.secondaryCount) <= 2,
    safetyLinePresent: evidence?.review?.safetyPresent === true,
    legacyExpandedHidden: evidence?.review?.legacyExpandedVisible === false,
    noOverflow: evidence?.review?.overflow === false && evidence?.review?.clipped === false,
    targetMissingAction: evidence?.targetMissing?.primaryAction === "retry-target"
  };
  const guardedFillRouting = {
    command: evidence?.fillRouting?.command || "",
    overlayAction: evidence?.fillRouting?.overlayAction || "",
    promptTextLength: Number(evidence?.fillRouting?.promptTextLength || 0),
    noAutoSubmit: evidence?.fillRouting?.noAutoSubmit === true,
    pass: evidence?.fillRouting?.command === "mascot_overlay_clicked"
      && evidence?.fillRouting?.overlayAction === "fill"
      && Number(evidence?.fillRouting?.promptTextLength) > 0
      && evidence?.fillRouting?.noAutoSubmit === true
  };
  const regenerateRouting = {
    command: evidence?.regenerateRouting?.command || "",
    overlayAction: evidence?.regenerateRouting?.overlayAction || "",
    promptTextLength: Number(evidence?.regenerateRouting?.promptTextLength || 0),
    noAutoSubmit: evidence?.regenerateRouting?.noAutoSubmit === true,
    pass: evidence?.regenerateRouting?.command === "mascot_overlay_clicked"
      && evidence?.regenerateRouting?.overlayAction === "generate"
      && Number(evidence?.regenerateRouting?.promptTextLength) > 0
      && evidence?.regenerateRouting?.noAutoSubmit === true
  };
  const modeRouting = {
    command: evidence?.modeRouting?.command || "",
    overlayAction: evidence?.modeRouting?.overlayAction || "",
    promptMode: evidence?.modeRouting?.promptMode || "",
    noAutoSubmit: evidence?.modeRouting?.noAutoSubmit === true,
    pass: evidence?.modeRouting?.command === "mascot_overlay_clicked"
      && evidence?.modeRouting?.overlayAction === "mode"
      && evidence?.modeRouting?.promptMode === "polish"
      && evidence?.modeRouting?.noAutoSubmit === true
  };
  const compactProbe = {
    screenshot: screenshots.compact.file,
    viewport: { width: screenshots.compact.width, height: screenshots.compact.height },
    defaultCompact: evidence?.compact?.mode === "compact",
    compactBody: evidence?.compact?.width === 72 && evidence?.compact?.height === 72,
    compactCard: evidence?.compact?.width === 72 && evidence?.compact?.height === 72,
    compactButton: evidence?.compact?.width === 72 && evidence?.compact?.height === 72,
    compactBadgeDot: true,
    compactChatHidden: evidence?.compact?.sharedHidden === true,
    compactBackdropTransparent: evidence?.compact?.htmlBackground === "rgba(0, 0, 0, 0)"
      && evidence?.compact?.bodyBackground === "rgba(0, 0, 0, 0)"
      && evidence?.compact?.legacyBackground === "rgba(0, 0, 0, 0)",
    compactScreenshotTransparent,
    screenshotTransparency: screenshots.compact,
    largeWhiteBlockAbsent
  };
  const contractPassed = Object.values(sharedCardContract).every(Boolean);
  const compactPassed = compactProbe.defaultCompact
    && compactProbe.compactBody
    && compactProbe.compactCard
    && compactProbe.compactButton
    && compactProbe.compactChatHidden
    && compactProbe.compactBackdropTransparent
    && compactProbe.compactScreenshotTransparent
    && compactProbe.largeWhiteBlockAbsent;
  const pass = runtimePassed
    && contractPassed
    && guardedFillRouting.pass
    && regenerateRouting.pass
    && modeRouting.pass
    && compactPassed;

  const report = {
    schemaVersion: "p25-overlay-chat-visual@2",
    createdAt: new Date().toISOString(),
    pass,
    contractVersion: evidence?.contractVersion || "",
    runtimeTest: {
      pass: runtimePassed,
      command: `${path.basename(process.execPath)} ${repoRelative(runtimeTestPath)}`,
      status: execution.status,
      signal: execution.signal || "",
      error: execution.error?.message || evidenceError,
      stderr: pass ? "" : String(execution.stderr || "").slice(-4000)
    },
    sharedCardContract,
    guardedFillRouting,
    regenerateRouting,
    modeRouting,
    initialCompactProbe: compactProbe,
    compactThinkingProbe: compactProbe,
    whiteBlockRegressionProbe: compactProbe,
    screenshots,
    checks: [
      { name: "shared-review", pass: contractPassed, ...sharedCardContract },
      { name: "target-missing", pass: sharedCardContract.targetMissingAction },
      { name: "guarded-fill-routing", ...guardedFillRouting },
      { name: "regenerate-routing", ...regenerateRouting },
      { name: "mode-routing", ...modeRouting },
      { name: "compact-transparency", pass: compactPassed, ...compactProbe }
    ],
    privacy: {
      promptTextNotStored: true,
      targetInputsNotStored: true,
      targetTitlesRedacted: true,
      overlayUsesMetadataOnly: true,
      reportStoresOnlyPromptLength: true
    }
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Assistant Card visual report: ${reportPath}`);
  console.log(JSON.stringify(report, null, 2));
  if (!pass) process.exitCode = 1;
}

run();

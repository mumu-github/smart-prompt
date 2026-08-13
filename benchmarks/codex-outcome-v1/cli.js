#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const {
  createBenchmarkPreview,
  formatPreview,
  runBenchmark
} = require("./harness");

async function main() {
  const command = process.argv[2] || "run-fake";
  if (!new Set(["preview", "run-fake"]).has(command)) {
    throw new Error("Usage: node cli.js [preview|run-fake]");
  }

  const preview = createBenchmarkPreview();
  const renderedPreview = formatPreview(preview);
  if (command === "preview") {
    process.stdout.write(`${renderedPreview}\n`);
    return;
  }

  fs.writeSync(process.stderr.fd, `${renderedPreview}\n`);
  const result = await runBenchmark({ preview, executionMode: "foreground" });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.code || "benchmark_error"}: ${error.message}\n`);
  process.exitCode = 1;
});

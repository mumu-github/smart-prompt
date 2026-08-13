# Codex Outcome Benchmark v1

This directory is an isolated, dependency-free benchmark harness. Its 12 task
fixtures are synthetic and contain paired `raw-input` and `optimized-input`
arms. Every pair declares the same starting point, model family, permission
profile, budget, and deterministic acceptance definition.

## Safe default

`npm.cmd test` and `npm.cmd run benchmark` use the fake executor. The harness
does not import a network client, invoke Codex, or start a paid/background job.
The CLI prints the preview before running and writes only a
`benchmark-result@1` object to stdout.

```powershell
npm.cmd run preview
npm.cmd run benchmark
npm.cmd test
```

A fake `passed` result proves only fixture and harness behavior. Use
`getBenchmarkAssessment(result)` to enforce `evidenceScope=harness_only` and
`automaticPromotionEligible=false`. A benchmark alone never authorizes a
production policy promotion.

## Real executor gate

There is deliberately no real-executor CLI command. A caller must create and
display a `codex` preview, then invoke `runBenchmark` in the foreground with all
of the following bound to that preview:

```js
const benchmark = require("./index");

const preview = benchmark.createBenchmarkPreview({
  executor: "codex",
  benchmarkId: "benchmark_manual_001",
  modelFamilyToken: "model_family_selected",
  budget: {
    tokenLimit: 120000,
    maxAgentTurns: 6,
    maxRetries: 2,
    estimatedCostMicros: 500000
  }
});

console.log(benchmark.formatPreview(preview));

const result = await benchmark.runBenchmark({
  preview,
  initiatedBy: "user",
  executionMode: "foreground",
  authorization: {
    granted: true,
    grantedInCurrentRun: true,
    previewToken: preview.previewToken
  },
  budgetConfirmation: {
    confirmed: true,
    previewToken: preview.previewToken
  },
  execute: async (request) => {
    // The host supplies the foreground Codex call and must honor request.limits.
  }
});
```

The injected function receives a per-request token, turn, and retry cap. If it
reports exhaustion or exceeds a cap, the harness stops and emits
`status=budget_exhausted` with `publicReason=budget_exhausted`. This is never
counted as a policy failure. As with any caller-supplied process, the harness
cannot enforce limits inside an external model runtime; the host executor must
apply the provided cap before making each request, await it in the foreground,
and never detach work after returning.

Quality and safety gates are evaluated before efficiency deltas. Failed or
budget-exhausted runs do not receive an efficiency assessment.

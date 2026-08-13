# Outcome Learning Contracts

`@smart-prompt/outcome-learning` is the canonical, dependency-free contract package for Smart Prompt's Codex Outcome Learning Loop v1. It defines strict persisted-data boundaries; it does not implement storage, UI, adapters, policy compilation, benchmark execution, or Rust integration.

## Versions

| Contract | Version |
| --- | --- |
| Bundle | `outcome-learning@1` |
| Prompt Session extension event | `prompt-session@2` |
| Codex Target Adapter result | `codex-target-adapter-result@1` |
| Pending outcome | `pending-outcome@1` |
| Learning observation | `learning-observation@1` |
| Learning artifact | `learning-artifact@1` |
| Generation policy | `generation-policy@1` |
| Policy rollout | `policy-rollout@1` |
| Benchmark result | `benchmark-result@1` |
| Runtime evidence | `runtime-evidence@1` |
| Context source | `context-source@1` |
| Shared fixture set | `outcome-learning-contract-fixtures@1` |

Contract versions are exact identifiers. Adding fields, changing enum meaning, relaxing a safety invariant, or changing time-window semantics requires a new version rather than a silent reinterpretation.

## JavaScript API

```js
const contracts = require("@smart-prompt/outcome-learning");

const result = contracts.validateContract("pending_outcome", candidate);
if (!result.valid) {
  // Persist or return only the finite error codes, not raw candidate data.
  throw new contracts.ContractValidationError("pending_outcome", result.errors);
}

const canonical = contracts.assertValidContract("pending_outcome", candidate);
```

The package exports:

- `CONTRACTS`, `CONTRACT_VERSIONS`, and frozen `ENUMS`.
- Generic `normalizeContract`, `validateContract`, and `assertValidContract` functions.
- Type-specific normalizers and validators for every contract.
- `mapPublicReason` and `getPublicReason` for finite UI-safe failure reasons.
- `findPrivacyViolations` for forbidden raw fields, unsafe privacy flags, absolute paths, and credential-shaped values.
- `normalizeSemanticFingerprint` and `validateSemanticFingerprint` for the fingerprint policy.

Normalizers make safe defaults deterministic, but they are not migrations and do not authorize persistence. Validate the original object before storing or crossing an IPC boundary. Validators reject unknown fields so producers cannot expand a contract without a version change.

## Fingerprint Policy

`keyed_feature_hash` is the default and preferred fingerprint. It must be a project-scoped, non-exportable HMAC-SHA256 token. `encrypted_local_embedding` is optional and is accepted only when it is encrypted locally, non-exportable, project-scoped, and has recorded inversion and membership-inference risk checks.

No fingerprint may claim absolute irreversibility. Consumers must invalidate fingerprints with the rest of the project-scoped learning data.

## Fixtures

`contract-fixtures.json` contains only opaque synthetic tokens, aggregate metrics, privacy flags, and sanitized learning statements. Each case has:

```json
{
  "id": "stable-case-id",
  "contract": "pending_outcome",
  "value": {},
  "expectedErrorCodes": []
}
```

`expectedErrorCodes` is present on invalid cases. Node consumers should run the exported validators directly. Rust consumers should deserialize the same file, dispatch on `contract`, accept every `valid` case, reject every `invalid` case, and include every listed error code. Rust must not maintain a second fixture vocabulary or infer different meanings for identically named fields.

## Safety Invariants

- A verified Codex insert requires foreground, identity, focus, draft freshness, payload freshness, exact machine readback, and `noAutoSubmit=true`.
- Pending feedback is not eligible before 60 seconds and expires as `expired_unknown` after 24 hours.
- Auto-created artifacts require at least 2 sessions, 3 successful outcomes, no explicit negative feedback, project scope, and pending review.
- Policy promotion requires per-arm evidence, quality and safety gates, an efficiency improvement, declared confidence, and no safety/privacy/permission incidents.
- Real Codex benchmarks require explicit authorization; fake benchmarks cannot claim model cost.
- Context sources stay independently authorized, removable, token-bounded, untrusted, and unable to expand execution permissions.
- Raw prompts, drafts, chat or clipboard content, window titles, absolute project paths, credentials, raw evidence, and unencrypted vectors are not valid persisted fields.

## Test

```powershell
npm.cmd test
```

The test suite parses the shared fixture file, checks every valid and invalid case, verifies public-reason mapping and fingerprint constraints, and scans valid fixtures for prohibited values.

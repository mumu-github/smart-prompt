const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const repoRoot = path.resolve(root, "..", "..");
const required = [
  "package.json",
  "index.html",
  "overlay.html",
  "src/app.js",
  "src/control-center-app.js",
  "src/desktop-overlay-logic.js",
  "src/prompt-session.js",
  "src/assistant-card.js",
  "src/assistant-card.css",
  "src/styles.css",
  "src/overlay.js",
  "src/overlay.css",
  "src/assets/mascot-states/normal.png",
  "src/assets/mascot-states/resting.png",
  "src/assets/mascot-states/thinking.png",
  "src/assets/mascot-states/suggesting.png",
  "src/assets/mascot-states/success.png",
  "src/assets/mascot-states/clapping.png",
  "scripts/prepare-dist.js",
  "scripts/prepare-sidecar.js",
  "tests/desktop-shell-interaction.test.js",
  "src-tauri/tauri.conf.json",
  "src-tauri/capabilities/default.json",
  "src-tauri/Cargo.toml",
  "src-tauri/src/main.rs",
  "src-tauri/icons/32x32.png",
  "src-tauri/icons/128x128.png",
  "src-tauri/icons/128x128@2x.png",
  "src-tauri/icons/icon.png",
  "src-tauri/icons/icon.ico",
  "src-tauri/icons/tray.png"
];

for (const file of required) {
  assert.ok(fs.existsSync(path.join(root, file)), `missing ${file}`);
}

const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
const controlCenterApp = fs.readFileSync(path.join(root, "src/control-center-app.js"), "utf8");
const desktopOverlayLogic = fs.readFileSync(path.join(root, "src/desktop-overlay-logic.js"), "utf8");
const promptSessionRuntime = fs.readFileSync(path.join(root, "src/prompt-session.js"), "utf8");
const assistantCardRuntime = fs.readFileSync(path.join(root, "src/assistant-card.js"), "utf8");
const assistantCardStyles = fs.readFileSync(path.join(root, "src/assistant-card.css"), "utf8");
const tauriRuntimeTest = fs.readFileSync(path.join(root, "tests/tauri-runtime.test.js"), "utf8");
const desktopOverlaySource = `${app}\n${desktopOverlayLogic}`;
assert.ok(app.includes("/settings"));
assert.ok(app.includes("/auth/bootstrap"));
assert.ok(app.includes("Authorization"));
assert.ok(app.includes("serviceAuthToken"));
assert.ok(controlCenterApp.includes("getActivationView"));
assert.ok(controlCenterApp.includes("/activation/status"));
assert.ok(controlCenterApp.includes("persistOnSuccess: true"));
assert.ok(!controlCenterApp.includes('await request("/settings", { method: "PUT"'));
assert.ok(controlCenterApp.includes("/activation/runtime-health"));
assert.ok(controlCenterApp.includes("noAutoSubmit"));
assert.ok(app.includes("provider"));
assert.ok(app.includes("PROVIDER_DEFAULTS"));
assert.ok(app.includes("applyProviderDefaults"));
assert.ok(app.includes("/llm/providers"));
assert.ok(app.includes("/llm/test"));
assert.ok(app.includes("renderProviderStatus"));
assert.ok(app.includes("renderFirstRunProgress"));
assert.ok(app.includes("renderPilotOutcomeDashboard"));
assert.ok(app.includes("refreshPilotOutcomes"));
assert.ok(app.includes("/metrics/pilot-outcomes"));
assert.ok(app.includes("pilotOutcomeReadinessReport"));
assert.ok(app.includes("renderQualityLiftDashboard"));
assert.ok(app.includes("refreshQualityLift"));
assert.ok(app.includes("/metrics/prompt-quality-lift"));
assert.ok(app.includes("promptQualityLiftReport"));
assert.ok(app.includes("renderQualityLiftSegmentsDashboard"));
assert.ok(app.includes("refreshQualityLiftSegments"));
assert.ok(app.includes("/metrics/prompt-quality-lift-segments"));
assert.ok(app.includes("promptQualityLiftSegmentsReport"));
assert.ok(app.includes("renderOutcomeFollowups"));
assert.ok(app.includes("recordOutcomeFollowup"));
assert.ok(app.includes("/outcomes/pending"));
assert.ok(app.includes("/outcomes/follow-up"));
assert.ok(app.includes("renderDesktopSnapshot"));
assert.ok(app.includes("refreshDesktopSnapshot"));
assert.ok(app.includes("/desktop/input-snapshot"));
assert.ok(app.includes("/desktop/fill?selfTest=1"));
assert.ok(app.includes('serviceRequest("/target/codex/inspect"'));
assert.ok(app.includes('serviceRequest("/target/codex/read"'));
assert.ok(app.includes('serviceRequest("/target/codex/insert"'));
assert.ok(app.includes('serviceRequest("/target/codex/undo"'));
assert.ok(app.includes('serviceRequest("/activation/codex/complete"'));
assert.ok(app.includes('contractVersion: "codex-activation@2"'));
assert.ok(app.includes("openingDraftHash"));
assert.ok(app.includes("openingTargetSignature"));
assert.ok(app.includes("draft_changed_since_open"));
assert.ok(app.includes("transactionId"));
assert.ok(app.includes("pendingOutcome"));
assert.ok(app.includes('serviceRequest("/outcomes/v2/feedback"'));
assert.ok(app.includes('serviceRequest("/learning/v1/candidates/ignore"'));
assert.ok(app.includes('serviceRequest("/learning/v1/candidates/review"'));
assert.ok(app.includes('decision: { action: "accept" }'));
assert.ok(app.includes("activateDesktopMascot"));
assert.ok(app.includes("generateDesktopPrompt"));
assert.ok(app.includes("fillForegroundInput"));
assert.ok(app.includes("getDesktopSnapshotReadiness"));
assert.ok(app.includes("confirmForeground: true"));
assert.ok(app.includes("expectedTitleHash: readiness.titleHash"));
assert.ok(app.includes("expectedToolProfile: readiness.profile"));
assert.ok(app.includes("allowClipboardFallback: true"));
assert.ok(app.includes("show_mascot_overlay"));
assert.ok(app.includes("hide_mascot_overlay"));
assert.ok(app.includes("smart-prompt-overlay-click"));
assert.ok(app.includes("startDesktopOverlayAutoDetect"));
assert.ok(app.includes('new Set(["codex", "workbuddy", "trae"])'));
assert.ok(app.includes("buildDesktopOverlayPayload"));
assert.ok(app.includes("DESKTOP_OVERLAY_FAST_POLL_MS"));
assert.ok(app.includes("refreshDesktopOverlayFastState"));
assert.ok(app.includes("fastWindowProbe"));
assert.ok(app.includes("overlay-fast-window-state"));
assert.ok(app.includes("getDesktopOverlayCandidate(snapshot, readiness)"));
assert.ok(desktopOverlaySource.includes("Number(candidate.index) === bestCandidateIndex"));
assert.ok(app.includes("renderDesktopFusionSurface"));
assert.ok(app.includes("renderDesktopFusionFillResult"));
assert.ok(app.includes("renderLearningDashboard"));
assert.ok(app.includes("refreshLearningReports"));
assert.ok(app.includes("/learning/reflections"));
assert.ok(app.includes("/learning/evolution-candidates"));
assert.ok(app.includes("MASCOT_STATE_IMAGES"));
assert.ok(app.includes("UI_MESSAGES"));
assert.ok(app.includes("applyLocale"));
assert.ok(app.includes("smartPromptDesktopLocale"));
assert.ok(app.includes("testProvider"));
assert.ok(app.includes("smartPromptProviderTestPass"));
assert.ok(app.includes("collectProviderKeys"));
assert.ok(app.includes("providerKeys"));
assert.ok(app.includes("agnes-2.0-flash"));
assert.ok(app.includes("agnes-api-key"));
assert.ok(app.includes("claude-sonnet-4-20250514"));
assert.ok(app.includes("gemini-2.5-flash"));
assert.ok(app.includes("/skills/import-folder"));
assert.ok(app.includes("/skills/${encodeURIComponent(id)}"));
assert.ok(app.includes("deleteSkill"));
assert.ok(app.includes("delete-skill"));
assert.ok(app.includes("/prompts"));
assert.ok(app.includes("/prompts/${encodeURIComponent(id)}"));
assert.ok(app.includes("deletePrompt"));
assert.ok(app.includes("delete-prompt"));
assert.ok(app.includes("handleSkillListAction"));
assert.ok(app.includes("handlePromptListAction"));
assert.ok(app.includes("set_global_shortcut"));
assert.ok(app.includes("start_local_service"));
assert.ok(app.includes("stop_local_service"));
assert.ok(app.includes("restart_local_service"));
assert.ok(app.includes("get_local_service_status"));
assert.ok(app.includes("/diagnostics/export"));
assert.ok(app.includes("/data/all"));
assert.ok(app.includes("clearLocalData"));
assert.ok(app.includes("exportDiagnostics"));
assert.ok(app.includes("refreshLocalServiceStatus"));
assert.ok(app.includes("localServiceStatus"));
assert.ok(app.includes("api-key"));
assert.ok(app.includes("agnes-api-key"));
assert.ok(app.includes("openai-api-key"));
assert.ok(app.includes("anthropic-api-key"));
assert.ok(app.includes("gemini-api-key"));
assert.ok(app.includes("smart-prompt-shortcut"));
assert.ok(app.includes("__smartPromptShortcutHits"));
assert.ok(app.includes("__smartPromptEventsReady"));
assert.ok(app.includes('classList.toggle("is-online"'));
assert.ok(!app.includes("style.color"));

const prepareDist = fs.readFileSync(path.join(root, "scripts/prepare-dist.js"), "utf8");
assert.ok(prepareDist.includes("copyFile(\"index.html\")"));
assert.ok(prepareDist.includes("copyFile(\"overlay.html\")"));
assert.ok(prepareDist.includes("copyDir(\"src\")"));
assert.ok(prepareDist.includes("archiveExistingDist"));
assert.ok(!prepareDist.includes("fs.rmSync"));

const prepareSidecar = fs.readFileSync(path.join(root, "scripts/prepare-sidecar.js"), "utf8");
assert.ok(prepareSidecar.includes("smart-prompt-sidecar"));
assert.ok(prepareSidecar.includes("apps\", \"local-service-sidecar"));
assert.ok(prepareSidecar.includes("cargo"));
assert.ok(prepareSidecar.includes('"--target-dir", sidecarTargetRoot'));
assert.ok(prepareSidecar.includes('path.join(sidecarTargetRoot, "release", executableName)'));
assert.ok(prepareSidecar.includes("local-service-sidecar.exe"));
assert.ok(prepareSidecar.includes("check-m3-desktop-input.ps1"));
assert.ok(prepareSidecar.includes("check-m3-desktop-fill.ps1"));
assert.ok(prepareSidecar.includes("desktop-tool-profile-config.ps1"));
assert.ok(prepareSidecar.includes("desktop-tool-profiles.json"));
assert.ok(prepareSidecar.includes("archiveExistingResources"));
assert.ok(!prepareSidecar.includes("fs.rmSync"));

const desktopInputProbe = fs.readFileSync(path.join(repoRoot, "scripts/check-m3-desktop-input.ps1"), "utf8");
const desktopFillProbe = fs.readFileSync(path.join(repoRoot, "scripts/check-m3-desktop-fill.ps1"), "utf8");
const realDesktopProbe = fs.readFileSync(path.join(repoRoot, "scripts/check-m3-real-desktop-tools.ps1"), "utf8");
const p25VisualProbe = fs.readFileSync(path.join(repoRoot, "scripts/check-p25-visual.ps1"), "utf8");
const p25OverlayNoActivateProbe = `${p25VisualProbe}\n${fs.readFileSync(path.join(repoRoot, "scripts/p25-visual/mascot-overlay-noactivate.impl.ps1"), "utf8")}`;
const p25RealDesktopTargetsProbe = fs.readFileSync(path.join(repoRoot, "scripts/check-p25-real-desktop-targets.ps1"), "utf8");
const p25OverlayClickChainProbe = fs.readFileSync(path.join(repoRoot, "scripts/check-p25-overlay-click-chain.ps1"), "utf8");
const p25RealOverlayClickFillProbe = fs.readFileSync(path.join(repoRoot, "scripts/check-p25-real-overlay-click-fill.ps1"), "utf8");
const p25ComposerCandidateDiagnosticsProbe = fs.readFileSync(path.join(repoRoot, "scripts/check-p25-composer-candidate-diagnostics.ps1"), "utf8");
for (const probe of [desktopInputProbe, desktopFillProbe, realDesktopProbe]) {
  assert.ok(probe.includes("Test-ShouldUseRelatedToolProfile"));
  assert.ok(probe.includes("Test-RelatedToolProcessHintPresent"));
  assert.ok(probe.includes("explorer|lockapp|shellexperiencehost"));
  assert.ok(probe.includes("detectedToolProfile"));
}
for (const probe of [desktopInputProbe, desktopFillProbe]) {
  assert.ok(probe.includes("Test-PreferredWritableInputCandidate"));
  assert.ok(probe.includes("broadDocument"));
  assert.ok(probe.includes("Button|Hyperlink|Text"));
}
assert.ok(desktopInputProbe.includes("cursor_known_tool_window_fallback"));
assert.ok(p25OverlayNoActivateProbe.includes("Smart Prompt Mascot"));
assert.ok(p25OverlayNoActivateProbe.includes("WS_EX_NOACTIVATE"));
assert.ok(p25OverlayNoActivateProbe.includes("p25-mascot-overlay-noactivate@1"));
assert.ok(p25OverlayNoActivateProbe.includes("targetInputRead = $false"));
assert.ok(realDesktopProbe.includes("PositionalBinding = $false"));
assert.ok(realDesktopProbe.includes("AttachThreadInput"));
assert.ok(realDesktopProbe.includes("keybd_event"));
assert.ok(realDesktopProbe.includes("foregroundActivation"));
assert.ok(realDesktopProbe.includes("selectionSource"));
assert.ok(p25RealDesktopTargetsProbe.includes("p25-real-desktop-targets@1"));
assert.ok(p25RealDesktopTargetsProbe.includes('("codex", "workbuddy", "trae")'));
assert.ok(p25RealDesktopTargetsProbe.includes("completionReady"));
assert.ok(p25RealDesktopTargetsProbe.includes("foregroundActivation"));
assert.ok(p25RealDesktopTargetsProbe.includes("strictForegroundDetected"));
assert.ok(p25RealDesktopTargetsProbe.includes("target_windows_detected_by_cursor_fallback"));
assert.ok(p25RealDesktopTargetsProbe.includes("noAutoSubmit"));
assert.ok(p25RealDesktopTargetsProbe.includes("probeTextNotStored"));
assert.ok(p25OverlayClickChainProbe.includes("p25-overlay-click-chain@1"));
assert.ok(p25OverlayClickChainProbe.includes("overlayClickRequiresPayload"));
assert.ok(p25OverlayClickChainProbe.includes("realOverlayClickVerified"));
assert.ok(p25OverlayClickChainProbe.includes("strict target foreground"));
assert.ok(p25OverlayClickChainProbe.includes("noAutoSubmitRequired"));
assert.ok(p25OverlayClickChainProbe.includes("realOverlayClickPollsLatestFill"));
assert.ok(p25OverlayClickChainProbe.includes("composerDiagnosticsVerifierPresent"));
assert.ok(p25OverlayClickChainProbe.includes("composerDiagnosticsOnlyUsesSanitizedSignals"));
assert.ok(p25OverlayClickChainProbe.includes("sidecarStoresLatestFill"));
assert.ok(p25OverlayClickChainProbe.includes("desktopShellSyncsPromptState"));
assert.ok(p25OverlayClickChainProbe.includes("localServiceStoresPromptState"));
assert.ok(p25OverlayClickChainProbe.includes("sidecarStoresPromptState"));
assert.ok(p25RealOverlayClickFillProbe.includes("p25-real-overlay-click-fill@1"));
assert.ok(p25RealOverlayClickFillProbe.includes("AllowRealOverlayClick"));
assert.ok(p25RealOverlayClickFillProbe.includes("/desktop/prompt-state"));
assert.ok(p25RealOverlayClickFillProbe.includes("desktopPromptStateReady"));
assert.ok(p25RealOverlayClickFillProbe.includes("/desktop/fill/latest"));
assert.ok(p25RealOverlayClickFillProbe.includes("compact_expand_then_primary_click_sent"));
assert.ok(p25RealOverlayClickFillProbe.includes("Send-MascotOverlayPrimaryClick"));
assert.ok(p25RealOverlayClickFillProbe.includes("expectedTitleHashMatched"));
assert.ok(p25RealOverlayClickFillProbe.includes("expectedToolProfileMatched"));
assert.ok(p25RealOverlayClickFillProbe.includes("noAutoSubmitRequired"));
assert.ok(p25ComposerCandidateDiagnosticsProbe.includes("p25-composer-candidate-diagnostics@1"));
assert.ok(p25ComposerCandidateDiagnosticsProbe.includes("Get-CandidateReason"));
assert.ok(p25ComposerCandidateDiagnosticsProbe.includes("button_or_hyperlink"));
assert.ok(p25ComposerCandidateDiagnosticsProbe.includes("broad_document"));
assert.ok(p25ComposerCandidateDiagnosticsProbe.includes("profile_composer_guard_failed"));
assert.ok(p25ComposerCandidateDiagnosticsProbe.includes("onlyHashesGeometryAndBooleans"));

const interactionTest = fs.readFileSync(path.join(root, "tests/desktop-shell-interaction.test.js"), "utf8");
assert.ok(interactionTest.includes("vm.runInContext"));
assert.ok(interactionTest.includes("fakeFetch"));
assert.ok(interactionTest.includes("/auth/bootstrap"));
assert.ok(interactionTest.includes("auth_required"));
assert.ok(interactionTest.includes("/settings"));
assert.ok(interactionTest.includes("/llm/test"));
assert.ok(interactionTest.includes("/skills/import-folder"));
assert.ok(interactionTest.includes("/prompts"));
assert.ok(interactionTest.includes("set_global_shortcut"));
assert.ok(interactionTest.includes("start_local_service"));
assert.ok(interactionTest.includes("stop_local_service"));
assert.ok(interactionTest.includes("restart_local_service"));
assert.ok(interactionTest.includes("get_local_service_status"));
assert.ok(interactionTest.includes("/diagnostics/export"));
assert.ok(interactionTest.includes("/metrics/pilot-outcomes"));
assert.ok(interactionTest.includes("pilotOutcomeReadinessReport"));
assert.ok(interactionTest.includes("/metrics/prompt-quality-lift"));
assert.ok(interactionTest.includes("promptQualityLiftReport"));
assert.ok(interactionTest.includes("/metrics/prompt-quality-lift-segments"));
assert.ok(interactionTest.includes("promptQualityLiftSegmentsReport"));
assert.ok(interactionTest.includes("/outcomes/pending"));
assert.ok(interactionTest.includes("/outcomes/follow-up"));
assert.ok(interactionTest.includes("manual_followup"));
assert.ok(interactionTest.includes("/data/all"));
assert.ok(interactionTest.includes("/desktop/prompt-state"));

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const phase3Html = html.slice(0, html.indexOf('<main class="shell legacy-shell">'));
const overlayHtml = fs.readFileSync(path.join(root, "overlay.html"), "utf8");
const overlayJs = fs.readFileSync(path.join(root, "src/overlay.js"), "utf8");
const overlayCss = fs.readFileSync(path.join(root, "src/overlay.css"), "utf8");
const tauriMain = fs.readFileSync(path.join(root, "src-tauri/src/main.rs"), "utf8");
const htmlIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicateHtmlIds = [...new Set(htmlIds.filter((id, index) => htmlIds.indexOf(id) !== index))];
assert.deepEqual(duplicateHtmlIds, ["learning-status"]);
assert.ok(app.includes('document.querySelector(".legacy-shell")'));
assert.ok(app.includes('duplicateLearningStatus.id = "legacy-learning-status"'));
assert.ok(app.includes('learningStatus: getLegacyElement("learning-status")'));
const legacyElementsBlock = app.slice(app.indexOf("const els = {"), app.indexOf("const firstRunState"));
assert.equal(legacyElementsBlock.includes("document.getElementById"), false);
assert.equal((legacyElementsBlock.match(/getLegacyElement\(/g) || []).length > 60, true);
assert.ok(app.includes('window.addEventListener?.("smart-prompt-learning-action"'));
assert.ok(app.includes('serviceRequest("/learning/v1/artifacts"'));
assert.ok(app.includes('serviceRequest("/learning/v1/global-proposals"'));
assert.ok(app.includes('serviceRequest("/policies/v1"'));
assert.ok(app.includes('serviceRequest("/policies/v1/rollouts"'));
assert.ok(app.includes("rollouts: controlCenterLearningState.rollouts"));
assert.ok(app.includes("policyActionContexts"));
assert.ok(app.includes("findControlCenterPolicy(policyId, version)"));
assert.ok(app.includes("version: policyAction.version"));
assert.ok(app.includes("canaryShareBps: 1000"));
const canaryActionBlock = app.slice(
  app.indexOf('if (actionId === "policy-start-canary")'),
  app.indexOf('if (actionId === "policy-rollback")')
);
assert.equal(canaryActionBlock.includes("rollout"), false);
assert.ok(app.includes("feedback?.state !== \"reason_required\""));
assert.ok(app.includes("codexTargetState.pendingOutcome = feedback"));
assert.ok(app.includes("featureToken=${encodeURIComponent(token)}"));
assert.ok(html.includes("Prompt Library"));
assert.ok(html.includes("Smart Prompt Desktop"));
assert.ok(html.includes("src/desktop-overlay-logic.js"));
assert.ok(html.includes('id="ui-locale"'));
assert.ok(html.includes('data-i18n="heroTitleLine1"'));
assert.ok(html.includes('data-i18n="startService"'));
assert.ok(html.includes('data-i18n="clearLocalData"'));
assert.ok(html.includes('class="button-primary"'));
assert.ok(html.includes('class="button-secondary"'));
assert.ok(html.includes('class="button-danger"'));
assert.ok(html.includes("Tool input fusion"));
assert.ok(html.includes("Self-reflection"));
assert.ok(html.includes('id="desktop-mascot-image"'));
assert.ok(html.includes('id="desktop-fusion-console"'));
assert.ok(html.includes('id="desktop-mascot-button"'));
assert.ok(html.includes('id="desktop-fusion-mascot-image"'));
assert.ok(html.includes('id="desktop-fusion-mascot-state"'));
assert.ok(html.includes('id="desktop-input-surface"'));
assert.ok(html.includes('id="desktop-draft-input"'));
assert.ok(html.includes('id="desktop-generated-prompt"'));
assert.ok(html.includes('id="desktop-prompt-handoff"'));
assert.ok(html.includes('id="generate-desktop-prompt"'));
assert.ok(html.includes('id="fill-foreground-input"'));
assert.ok(html.includes('id="desktop-fusion-evidence"'));
assert.ok(html.includes('id="refresh-desktop-snapshot"'));
assert.ok(html.includes('id="desktop-companion-status"'));
assert.ok(html.includes('id="desktop-tool-summary"'));
assert.ok(html.includes('id="desktop-signal-summary"'));
assert.ok(html.includes('id="desktop-guard-summary"'));
assert.ok(html.includes('id="desktop-supported-profiles"'));
assert.ok(html.includes('id="desktop-fill-text"'));
assert.ok(html.includes('id="run-desktop-self-test"'));
assert.ok(html.includes('id="desktop-fill-result"'));
assert.ok(html.includes('id="refresh-learning"'));
assert.ok(html.includes('id="learning-status"'));
assert.ok(html.includes('id="self-improvement-summary"'));
assert.ok(html.includes('id="evolution-candidate-summary"'));
assert.ok(html.includes('id="first-run-panel"'));
assert.ok(html.includes('id="first-run-progress"'));
assert.ok(html.includes('data-phase3-control-center="true"'));
assert.ok(html.includes('id="activation-wizard"'));
assert.ok(html.includes('id="control-center"'));
assert.ok(html.includes('data-control-page="overview"'));
assert.ok(html.includes('data-control-page="model"'));
assert.ok(html.includes('data-control-page="learning"'));
assert.ok(html.includes('data-control-page="privacy"'));
assert.ok(html.includes('data-control-page="diagnostics"'));
assert.equal((phase3Html.match(/data-control-page="/g) || []).length, 5);
assert.ok(html.includes('id="learning-content"'));
assert.ok(html.includes('id="control-locale"'));
assert.ok(!phase3Html.includes('id="start-service"'));
assert.ok(!phase3Html.includes('id="stop-service"'));
assert.ok(!phase3Html.includes('id="run-desktop-self-test"'));
assert.ok(!phase3Html.includes("Pilot Outcomes"));
assert.ok(!phase3Html.includes("Quality Lift"));
assert.ok(!phase3Html.includes("Quality Segments"));
assert.ok(!phase3Html.includes('class="hero-panel"'));
assert.ok(html.includes('id="wizard-model-choice"'));
assert.ok(html.includes('id="model-model-choice"'));
assert.ok(html.includes('data-custom-model-field'));
assert.ok(html.includes('value="custom" data-cc-copy="customProvider">自定义 Provider</option>'));
assert.ok(html.includes('id="wizard-custom-name"'));
assert.ok(html.includes('id="wizard-custom-protocol"'));
assert.ok(html.includes('id="wizard-custom-base-url"'));
assert.ok(html.includes('id="model-custom-name"'));
assert.ok(html.includes('data-provider-key-state'));
assert.ok(controlCenterApp.includes('const CUSTOM_MODEL_VALUE = "__custom__"'));
assert.ok(controlCenterApp.includes("resolveModelValue"));
assert.ok(controlCenterApp.includes('request("/activation/codex/status"'));
assert.ok(controlCenterApp.includes("renderLearningView"));
assert.ok(controlCenterApp.includes('new CustomEvent("smart-prompt-learning-action"'));
assert.ok(assistantCardRuntime.includes('id: "outcome-completed"'));
assert.ok(assistantCardRuntime.includes('id: "outcome-not-completed"'));
assert.ok(assistantCardRuntime.includes('id: "outcome-reason"'));
assert.ok(assistantCardRuntime.includes('id: "candidate-review"'));
assert.ok(assistantCardRuntime.includes('id: "candidate-ignore"'));
assert.ok(html.includes('id="privacy-boundary"'));
assert.ok(html.includes('id="test-provider"'));
assert.ok(html.includes('id="provider-test-status"'));
assert.ok(html.includes("No full page body"));
assert.ok(html.includes("No auto-submit"));
assert.ok(overlayHtml.includes('data-state="resting"'));
assert.ok(overlayHtml.includes('id="smart-prompt-assistant-host"'));
assert.ok(overlayHtml.indexOf('src/prompt-session.js') < overlayHtml.indexOf('src/overlay.js'));
assert.ok(overlayHtml.indexOf('src/assistant-card.js') < overlayHtml.indexOf('src/overlay.js'));
assert.equal(
  promptSessionRuntime,
  fs.readFileSync(path.join(repoRoot, "packages/prompt-session/index.js"), "utf8"),
  "desktop Prompt Session runtime must match the shared source"
);
assert.equal(
  assistantCardRuntime,
  fs.readFileSync(path.join(repoRoot, "packages/assistant-ui/assistant-card.js"), "utf8"),
  "desktop Assistant Card runtime must match the shared source"
);
assert.equal(
  assistantCardStyles,
  fs.readFileSync(path.join(repoRoot, "packages/assistant-ui/assistant-card.css"), "utf8"),
  "desktop Assistant Card styles must match the shared source"
);
assert.ok(overlayJs.includes("SmartPromptSession"));
assert.ok(overlayJs.includes("assistantState"));
assert.ok(overlayHtml.includes('data-overlay-mode="compact"'));
assert.ok(overlayHtml.includes("background: rgba(0, 0, 0, 0)"));
assert.ok(overlayHtml.includes("max-width: 72px"));
assert.ok(overlayHtml.includes("background: rgba(0, 0, 0, 0) !important"));
assert.ok(overlayHtml.includes("width: 72px"));
assert.ok(overlayHtml.includes('html[data-overlay-mode="compact"] #mascot-overlay-badge'));
assert.ok(overlayHtml.includes("font-size: 0"));
assert.ok(overlayHtml.includes("box-shadow: 0 0 0 4px"));
assert.ok(overlayHtml.includes("mascot-overlay-button"));
assert.ok(overlayCss.includes('html[data-overlay-mode="compact"] .mascot-overlay-chat'));
assert.ok(overlayCss.includes("place-items: center"));
assert.ok(overlayCss.includes("grid-template-columns: 1fr"));
assert.ok(overlayCss.includes("gap: 0"));
assert.ok(overlayCss.includes("display: none"));
assert.ok(overlayCss.includes("animation: none"));
assert.ok(overlayCss.includes("transform: none"));
assert.ok(overlayCss.includes("box-shadow: 0 0 0 4px"));
assert.ok(overlayCss.includes("font-size: 0"));
assert.ok(overlayCss.includes("background: transparent !important"));
assert.ok(overlayCss.includes("contain: strict"));
assert.ok(overlayCss.includes("clip-path: inset(0)"));
assert.ok(overlayCss.includes(".mascot-overlay-secondary:disabled"));
assert.ok(overlayCss.includes(".mascot-overlay-mode:disabled"));
assert.ok(overlayCss.includes(".mascot-overlay-locale:disabled"));
assert.ok(overlayCss.includes(".mascot-overlay-reply:disabled"));
assert.ok(overlayCss.includes('html[data-overlay-mode="compact"] .mascot-overlay-locales'));
assert.ok(overlayCss.includes(".mascot-overlay-draft-send:disabled"));
assert.ok(overlayHtml.includes("mascot-overlay-card"));
assert.ok(overlayHtml.includes("mascot-overlay-chat"));
assert.ok(overlayHtml.includes('id="mascot-overlay-chat"'));
assert.ok(overlayHtml.includes("mascot-overlay-message"));
assert.ok(overlayHtml.includes("mascot-overlay-meta"));
assert.ok(overlayHtml.includes("mascot-overlay-hint"));
assert.ok(overlayHtml.includes("mascot-overlay-turns"));
assert.ok(overlayHtml.includes("mascot-overlay-user-turn"));
assert.ok(overlayHtml.includes("mascot-overlay-assistant-turn"));
assert.ok(overlayHtml.includes("mascot-overlay-primary"));
assert.ok(overlayHtml.includes("mascot-overlay-close"));
assert.ok(overlayHtml.includes("mascot-overlay-draft"));
assert.ok(overlayHtml.includes("mascot-overlay-draft-form"));
assert.ok(overlayHtml.includes("mascot-overlay-draft-input"));
assert.ok(overlayHtml.includes("<textarea"));
assert.ok(overlayHtml.includes('rows="2"'));
assert.ok(overlayHtml.includes("mascot-overlay-draft-send"));
assert.ok(overlayHtml.includes("&gt;"));
assert.ok(overlayHtml.includes("mascot-overlay-replies"));
assert.ok(overlayHtml.includes("mascot-overlay-reply-short"));
assert.ok(overlayHtml.includes("mascot-overlay-reply-clear"));
assert.ok(overlayHtml.includes("mascot-overlay-reply-steps"));
assert.ok(overlayHtml.includes("mascot-overlay-generate"));
assert.ok(overlayHtml.includes("mascot-overlay-refresh"));
assert.ok(overlayHtml.includes("mascot-overlay-mode-idea"));
assert.ok(overlayHtml.includes("mascot-overlay-mode-continue"));
assert.ok(overlayHtml.includes("mascot-overlay-mode-polish"));
assert.ok(overlayHtml.includes("mascot-overlay-locale-zh"));
assert.ok(overlayHtml.includes("mascot-overlay-locale-en"));
assert.ok(overlayHtml.includes("src/overlay.js"));
assert.ok(overlayJs.includes("smart-prompt-overlay-state"));
assert.ok(overlayJs.includes("mascot_overlay_clicked"));
assert.match(
  overlayJs,
  /button\.addEventListener\("click",[\s\S]*?getOverlayMode\(currentPayload\) === "compact"[\s\S]*?activateOverlay\("open"\)/,
  "compact mascot click must emit the open action"
);
assert.match(
  overlayJs,
  /\["outcome-completed", "outcome-not-completed", "outcome-reason"\]\.includes\(action\)/,
  "both outcome stages must be forwarded to the app while the shared card owns local staging"
);
assert.ok(overlayJs.includes('"candidate-review", "candidate-ignore"'));
assert.ok(overlayJs.includes("invalidateOverlayUndoOnGoalChange"));
assert.ok(overlayJs.includes("mascot_overlay_draft_submitted"));
assert.ok(overlayJs.includes("set_mascot_overlay_state"));
assert.ok(overlayJs.includes("submitQuickDraft"));
assert.ok(overlayJs.includes("applyQuickReply"));
assert.ok(overlayJs.includes("getQuickReplies"));
assert.ok(overlayJs.includes("send-draft"));
assert.ok(overlayJs.includes("hasQuickDraftText"));
assert.ok(overlayJs.includes("focusQuickDraftOnNextRender"));
assert.ok(overlayJs.includes("quickDraftFocused"));
assert.ok(overlayJs.includes("handleQuickDraftKeydown"));
assert.ok(overlayJs.includes("event.shiftKey"));
assert.ok(overlayJs.includes('event.key === "Escape"'));
assert.ok(overlayJs.includes("escape-collapse"));
assert.ok(overlayJs.includes("accelerator-send"));
assert.ok(overlayJs.includes("quickDraftKeyboardAction"));
assert.ok(overlayJs.includes("quickDraftPending"));
assert.ok(overlayJs.includes("quickDraftSendReady"));
assert.ok(overlayJs.includes("Brief"));
assert.ok(overlayJs.includes("Angle"));
assert.ok(overlayJs.includes("Match"));
assert.ok(overlayJs.includes("Close"));
assert.ok(overlayJs.includes("Missing"));
assert.ok(overlayJs.includes("quickReplyCount"));
assert.ok(overlayJs.includes("overlayMode"));
assert.ok(overlayJs.includes("overlayAction"));
assert.ok(overlayJs.includes("generateButton"));
assert.ok(overlayJs.includes("promptMode"));
assert.ok(overlayJs.includes("getOverlayHint"));
assert.ok(overlayJs.includes("Drafting note"));
assert.ok(overlayJs.includes("Ready to send"));
assert.ok(overlayJs.includes("getConversationTurns"));
assert.ok(overlayJs.includes("userTurn"));
assert.ok(overlayJs.includes("assistantTurn"));
assert.ok(overlayJs.includes("Smart: opening draft"));
assert.ok(overlayJs.includes("Smart: scanning target"));
assert.ok(overlayJs.includes("getSelectedQuickReplyLabel"));
assert.ok(overlayJs.includes("quickReplySelectedLabel"));
assert.ok(overlayJs.includes("Smart: replies tuned"));
assert.ok(overlayJs.includes("getSecondaryActions"));
assert.ok(overlayJs.includes("outcome-good"));
assert.ok(overlayJs.includes("outcome-fix"));
assert.ok(overlayJs.includes("promptReady"));
assert.ok(overlayJs.includes("promptKind"));
assert.ok(overlayJs.includes("no-submit"));
assert.ok(overlayJs.includes("guardReason"));
assert.ok(overlayJs.includes("Guarded"));
assert.ok(overlayJs.includes("visualOnly"));
assert.ok(overlayJs.includes("Focus input, then Scan"));
assert.ok(overlayJs.includes("primaryAction"));
assert.ok(app.includes("DESKTOP_OVERLAY_COMPACT_SIZE = { width: 72, height: 72 }"));
assert.ok(app.includes("getDesktopPromptOverlayMeta"));
assert.ok(app.includes("withDesktopPromptOverlayMeta"));
assert.ok(app.includes("getDesktopOverlayVisualAnchor"));
assert.ok(app.includes("isDesktopOverlayVisualAnchorCandidate"));
assert.ok(app.includes("payload.visualOnly !== true"));
assert.ok(app.includes("renderDesktopPromptHandoff"));
assert.ok(app.includes("desktopPromptHandoffClickMascot"));
assert.ok(app.includes("desktopPromptHandoffFocusInput"));
assert.ok(app.includes("handoffAction"));
assert.ok(app.includes("showDesktopMascotOverlayGuard"));
assert.ok(app.includes("showDesktopPromptDraftFromOverlay"));
assert.ok(app.includes("showDesktopPromptEditorFromOverlay"));
assert.ok(app.includes("getMascotOverlayAction"));
assert.ok(app.includes('if (overlayAction !== "fill")'));
assert.ok(app.includes("handleMascotOverlayDraftSubmission"));
assert.ok(app.includes("handleMascotOverlayOutcome"));
assert.ok(app.includes("overlayOutcome"));
assert.ok(app.includes("revisionRequested"));
assert.ok(app.includes("smart-prompt-overlay-draft"));
assert.ok(app.includes("setDesktopPromptMode"));
assert.ok(app.includes("DESKTOP_PROMPT_MODES"));
assert.ok(app.includes("show_main_window"));
assert.ok(tauriMain.includes("WebviewWindowBuilder"));
assert.ok(tauriMain.includes("mascot-overlay"));
assert.ok(tauriMain.includes("show_main_window"));
assert.ok(tauriMain.includes("hide_main_window"));
assert.ok(tauriMain.includes("open_chatgpt"));
assert.ok(controlCenterApp.includes('request("/activation/codex/loop-start"'));
assert.ok(controlCenterApp.includes('await invoke("hide_main_window")'));
assert.ok(tauriRuntimeTest.includes("dataDirConfigured: true"));
assert.ok(!tauriRuntimeTest.includes("report.sidecarSource = sidecarSource"));
assert.ok(tauriMain.includes("show_mascot_overlay"));
assert.ok(tauriMain.includes("hide_mascot_overlay"));
assert.ok(tauriMain.includes("get_foreground_window_state"));
assert.ok(tauriMain.includes("set_mascot_overlay_state"));
assert.ok(tauriMain.includes("mascot_overlay_clicked"));
assert.ok(tauriMain.includes("mascot_overlay_draft_submitted"));
assert.ok(tauriMain.includes("MascotOverlayDraftSubmission"));
assert.ok(tauriMain.includes(".transparent(true)"));
assert.ok(tauriMain.includes("MASCOT_OVERLAY_TRANSPARENT_COLOR"));
assert.ok(tauriMain.includes(".background_color(MASCOT_OVERLAY_TRANSPARENT_COLOR)"));
assert.ok(tauriMain.includes("set_background_color(Some(MASCOT_OVERLAY_TRANSPARENT_COLOR))"));
assert.ok(tauriMain.includes("overlay_action"));
assert.ok(tauriMain.includes("visual_only"));
assert.ok(tauriMain.includes("prompt_mode"));
assert.ok(tauriMain.includes("MASCOT_OVERLAY_COMPACT_WIDTH"));
assert.ok(tauriMain.includes("MASCOT_OVERLAY_COMPACT_WIDTH: f64 = 72.0"));
assert.ok(tauriMain.includes("apply_mascot_overlay_geometry"));
assert.ok(tauriMain.includes("keep_overlay_non_activating"));
assert.ok(tauriMain.includes("WS_EX_NOACTIVATE"));
assert.ok(tauriMain.includes("SWP_NOACTIVATE"));
assert.ok(tauriMain.includes("GetAncestor"));
assert.ok(tauriMain.includes("GA_ROOT"));
assert.ok(tauriMain.includes("show_overlay_without_activation"));
assert.ok(tauriMain.includes("hide_overlay_window"));
assert.ok(tauriMain.includes("ShowWindow"));
assert.ok(tauriMain.includes("SW_HIDE"));
assert.ok(tauriMain.includes("SetWinEventHook"));
assert.ok(tauriMain.includes("EVENT_SYSTEM_FOREGROUND"));
assert.ok(tauriMain.includes("EVENT_SYSTEM_MINIMIZESTART"));
assert.ok(tauriMain.includes("EVENT_OBJECT_HIDE"));
assert.ok(html.includes("Pilot Outcomes"));
assert.ok(html.includes("refresh-pilot-outcomes"));
assert.ok(html.includes("pilot-outcome-status"));
assert.ok(html.includes("pilot-outcome-summary"));
assert.ok(html.includes("pilot-outcome-strategies"));
assert.ok(html.includes("pilot-outcome-targets"));
assert.ok(html.includes("Quality Lift"));
assert.ok(html.includes("refresh-quality-lift"));
assert.ok(html.includes("quality-lift-status"));
assert.ok(html.includes("quality-lift-summary"));
assert.ok(html.includes("quality-lift-cohorts"));
assert.ok(html.includes("quality-lift-comparisons"));
assert.ok(html.includes("quality-lift-recommendations"));
assert.ok(html.includes("Quality Segments"));
assert.ok(html.includes("refresh-quality-lift-segments"));
assert.ok(html.includes("quality-lift-segments-status"));
assert.ok(html.includes("quality-lift-segments-improving"));
assert.ok(html.includes("quality-lift-segments-regressing"));
assert.ok(html.includes("quality-lift-segments-collecting"));
assert.ok(html.includes("Outcome Follow-up"));
assert.ok(html.includes("refresh-outcome-followups"));
assert.ok(html.includes("outcome-followup-status"));
assert.ok(html.includes("outcome-followup-list"));
assert.ok(html.includes("restart-service"));
assert.ok(html.includes("export-diagnostics"));
assert.ok(html.includes("clear-local-data"));
assert.ok(html.includes("diagnostics-output"));
assert.ok(html.includes('id="provider"'));
assert.ok(html.includes('value="auto"'));
assert.ok(html.includes('value="agnes"'));
assert.ok(html.includes("provider-status"));
assert.ok(html.includes("agnes-api-key"));
assert.ok(html.includes("openai-compatible"));
assert.ok(html.includes("anthropic"));
assert.ok(html.includes("gemini"));
assert.ok(html.includes("openai-api-key"));
assert.ok(html.includes("anthropic-api-key"));
assert.ok(html.includes("gemini-api-key"));
assert.ok(html.includes("prompt-title"));
assert.ok(html.includes("prompt-body"));
assert.ok(html.includes("save-prompt"));
assert.ok(html.includes("stop-service"));

const css = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
assert.ok(css.includes(".hero-panel"));
assert.ok(css.includes(".hero-grid"));
assert.ok(css.includes(".device-surface"));
assert.ok(css.includes(".desktop-companion-panel"));
assert.ok(css.includes(".desktop-fusion-console"));
assert.ok(css.includes(".desktop-mascot-button"));
assert.ok(css.includes(".desktop-input-surface"));
assert.ok(css.includes(".desktop-prompt-handoff"));
assert.ok(css.includes(".desktop-evidence-row"));
assert.ok(css.includes("@keyframes mascot-thinking"));
assert.ok(css.includes(".learning-panel"));
assert.ok(css.includes(".signal-card"));
assert.ok(css.includes(".chip-list"));
assert.ok(css.includes(".locale-select"));
assert.ok(css.includes(".button-primary"));
assert.ok(css.includes(".button-secondary"));
assert.ok(css.includes(".button-danger"));
assert.ok(css.includes(".button-ghost"));
assert.ok(css.includes("grid-template-columns: repeat(5, minmax(0, 1fr))"));
assert.ok(css.includes(".learning-section"));
assert.ok(css.includes(".learning-row-action"));
assert.ok(css.includes("@media (prefers-reduced-motion: reduce)"));
assert.ok(css.includes(".setup-panel"));
assert.ok(css.includes(".setup-progress"));
assert.ok(css.includes(".privacy-boundary"));
assert.ok(css.includes(".library-row"));
assert.ok(css.includes(".row-action"));
assert.ok(css.includes(".status-pill.is-online"));
assert.ok(css.includes(".status-pill.is-offline"));
assert.ok(css.includes(".diagnostics-panel"));
assert.ok(css.includes(".diagnostics-output"));
assert.ok(css.includes(".pilot-outcome-panel"));
assert.ok(css.includes(".quality-lift-panel"));
assert.ok(css.includes(".quality-lift-segments-panel"));
assert.ok(css.includes(".outcome-followup-panel"));
assert.ok(css.includes(".outcome-followup-row"));
assert.ok(css.includes(".outcome-followup-actions"));
assert.ok(css.includes(".outcome-grid"));
assert.ok(css.includes(".outcome-columns"));

const rust = fs.readFileSync(path.join(root, "src-tauri/src/main.rs"), "utf8");
assert.ok(rust.startsWith("#![cfg_attr(not(debug_assertions), windows_subsystem = \"windows\")]"));
assert.ok(rust.includes("image::Image"));
assert.ok(rust.includes("TrayIconBuilder"));
assert.ok(rust.includes("smart_prompt_tray_icon"));
assert.ok(rust.includes("Image::from_bytes(include_bytes!(\"../icons/tray.png\"))"));
assert.ok(rust.includes("default_window_icon"));
assert.ok(rust.includes("TrayIconBuilder::with_id(\"smart-prompt\")"));
assert.ok(rust.includes("tray_builder.icon(icon)"));
assert.ok(rust.includes("app.manage(tray)"));
assert.ok(rust.includes("tauri_plugin_single_instance::init"));
assert.ok(rust.includes("focus_main_window(app)"));
assert.ok(rust.includes("window.unminimize()"));
assert.ok(rust.includes("window.set_focus()"));
assert.ok(rust.includes("tauri_plugin_global_shortcut"));
assert.ok(rust.includes("set_global_shortcut"));
assert.ok(rust.includes("get_shortcut_hits"));
assert.ok(rust.includes("on_shortcut"));
assert.ok(rust.includes("ShortcutState::Pressed"));
assert.ok(rust.includes("ShortcutRuntimeState"));
assert.ok(rust.includes("Code::KeyP"));
assert.ok(rust.includes("start_local_service"));
assert.ok(rust.includes("stop_local_service"));
assert.ok(rust.includes("restart_local_service"));
assert.ok(rust.includes("get_local_service_status"));
assert.ok(rust.includes("get_local_service_source"));
assert.ok(rust.includes("LocalServiceRuntimeState"));
assert.ok(rust.includes("Mutex<Option<Child>>"));
assert.ok(rust.includes("find_local_service_sidecar(&app)"));
assert.ok(rust.includes('#[cfg(debug_assertions)]\n    {\n        let mut push_source_root'));
assert.ok(!rust.includes('if cfg!(debug_assertions) {\n        let mut push_source_root'));
assert.ok(rust.includes('let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));'));
assert.ok(!rust.includes("let profiles = if cfg!(debug_assertions)"));
assert.ok(rust.includes("prepare_local_service_sidecar_for_execution"));
assert.ok(rust.includes('sidecar.source != "bundled"'));
assert.ok(rust.includes('join("sidecar-runtime")'));
assert.ok(rust.includes("sidecar_runtime_fingerprint"));
assert.ok(rust.includes('source: "bundled-runtime"'));
assert.ok(rust.includes("copy_dir_if_changed"));
assert.ok(rust.includes("copy_file_if_changed"));
assert.ok(rust.includes("local-service-sidecar"));
assert.ok(rust.includes("is_local_service_port_in_use"));
assert.ok(rust.includes("matches_expected_local_service_health"));
assert.ok(rust.includes('const NATIVE_RUNTIME_CONTRACT: &str = "phase3-native-runtime@1"'));
assert.ok(rust.includes('const NATIVE_BUILD_ID: &str = "phase3-native-sidecar-20260719-r18"'));
assert.ok(rust.includes('"打开控制中心"'));
assert.ok(rust.includes('"退出 Smart Prompt"'));
assert.ok(rust.includes("resources/smart-prompt-sidecar"));
assert.ok(rust.includes("SMART_PROMPT_DATA_DIR"));
assert.ok(rust.includes("Stdio::null"));
assert.ok(rust.includes("CommandExt"));
assert.ok(rust.includes("CREATE_NO_WINDOW"));
assert.ok(rust.includes("creation_flags(CREATE_NO_WINDOW)"));
assert.ok(!rust.includes("tauri_plugin_shell::init"));

const cargoToml = fs.readFileSync(path.join(root, "src-tauri/Cargo.toml"), "utf8");
assert.ok(cargoToml.includes('features = ["tray-icon", "image-png"]'));
assert.ok(cargoToml.includes('tauri-plugin-single-instance = "2"'));
assert.ok(
  rust.indexOf("tauri_plugin_single_instance::init") < rust.indexOf("tauri_plugin_global_shortcut::Builder"),
  "single-instance must be the first Tauri plugin registered"
);

const tauriConfig = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
assert.equal(tauriConfig.productName, "Smart Prompt");
assert.equal(tauriConfig.build.beforeBuildCommand, "npm run prepare-release");
assert.equal(tauriConfig.build.frontendDist, "../dist");
assert.equal(tauriConfig.app.withGlobalTauri, true);
assert.equal(tauriConfig.app.windows[0].label, "main");
assert.equal(tauriConfig.app.windows[0].visible, false);
assert.deepEqual(tauriConfig.bundle.icon, [
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.png",
  "icons/icon.ico"
]);
assert.ok(tauriConfig.bundle.resources.includes("resources/smart-prompt-sidecar/"));
assert.ok(tauriConfig.app.security.csp.includes("default-src 'self'"));
assert.ok(tauriConfig.app.security.csp.includes("connect-src"));
assert.ok(tauriConfig.app.security.csp.includes("http://127.0.0.1:17371"));
assert.ok(tauriConfig.app.security.csp.includes("object-src 'none'"));
assert.ok(!tauriConfig.app.security.csp.includes("unsafe-eval"));

const capability = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/capabilities/default.json"), "utf8"));
assert.deepEqual(capability.windows, ["main", "mascot-overlay"]);
[
  "allow-set-global-shortcut",
  "allow-get-shortcut-hits",
  "allow-get-local-service-status",
  "allow-get-local-service-source",
  "allow-get-foreground-window-state",
  "allow-show-main-window",
  "allow-show-mascot-overlay",
  "allow-hide-mascot-overlay",
  "allow-set-mascot-overlay-state",
  "allow-mascot-overlay-clicked",
  "allow-mascot-overlay-draft-submitted",
  "allow-trace-runtime-event",
  "allow-start-local-service",
  "allow-stop-local-service",
  "allow-restart-local-service",
  "core:event:allow-listen",
  "core:event:allow-unlisten"
].forEach((permission) => assert.ok(capability.permissions.includes(permission), `missing permission ${permission}`));
assert.ok(!capability.permissions.includes("core:default"));
assert.ok(!capability.permissions.some((permission) => permission.startsWith("shell:")));

console.log("desktop-shell static tests passed");

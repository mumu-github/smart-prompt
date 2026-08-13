const SERVICE_URL = globalThis.__SMART_PROMPT_SERVICE_URL__ || "http://127.0.0.1:17371";
let serviceAuthToken = "";

const PROVIDER_DEFAULTS = {
  auto: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini"
  },
  agnes: {
    baseUrl: "https://apihub.agnes-ai.com/v1",
    model: "agnes-2.0-flash"
  },
  "openai-compatible": {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini"
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514"
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.5-flash"
  }
};

const MASCOT_STATE_IMAGES = {
  normal: "src/assets/mascot-states/normal.png",
  resting: "src/assets/mascot-states/resting.png",
  thinking: "src/assets/mascot-states/thinking.png",
  suggesting: "src/assets/mascot-states/suggesting.png",
  success: "src/assets/mascot-states/success.png",
  clapping: "src/assets/mascot-states/clapping.png"
};

const MASCOT_STATE_LABEL_KEYS = {
  normal: "stateNormal",
  resting: "stateResting",
  thinking: "stateThinking",
  suggesting: "stateSuggesting",
  success: "stateSuccess",
  clapping: "stateClapping"
};

const UI_MESSAGES = {
  "zh-CN": {
    brandTitle: "Smart Prompt Desktop",
    brandSubtitle: "本地提示词副驾",
    uiLocale: "界面语言",
    localeAuto: "自动",
    localeZh: "中文",
    localeEn: "英文",
    heroEyebrow: "极简、本地、会学习",
    heroTitleLine1: "让提示词在你的",
    heroTitleLine2: "工具里变好。",
    heroText: "真实 LLM、技能库、桌面输入守卫和自学习证据，都收在一个本地工作台里。",
    proofPromptFirst: "提示词优先",
    proofAggregateOnly: "只用聚合证据",
    proofNoAutoSubmit: "不自动发送",
    startService: "启动服务",
    stopService: "停止服务",
    restartService: "重启服务",
    firstRunEyebrow: "首次启动",
    firstRunTitle: "干净开始",
    testProvider: "测试 Provider",
    privacyNoBody: "不上传整页正文",
    privacyNoTitle: "不上传页面标题",
    privacyNoSubmit: "不自动提交",
    privacyKeys: "密钥加密保存",
    desktopCompanionEyebrow: "桌面伴随",
    desktopCompanionTitle: "工具输入融合",
    inspectForeground: "识别前台窗口",
    desktopMascotAction: "识别前台工具并准备输入",
    desktopSurfaceWaiting: "尚未锁定前台工具。",
    desktopSurfaceReady: "{profile} 已锁定；候选 {candidateCount}；安全候选 {safeCandidateCount}；标题 hash {titleHash}",
    desktopSurfaceGuarded: "{profile} 已识别，但安全输入候选仍未满足守卫。",
    desktopDraftLabel: "草稿",
    desktopDraftPlaceholder: "写下你想让当前工具完成的事。",
    desktopPromptLabel: "Prompt",
    desktopPromptPlaceholder: "生成后的 prompt 可在填入前继续编辑。",
    generateDesktopPrompt: "生成",
    fillForegroundInput: "填入前台",
    desktopFusionIdle: "等待前台工具。",
    desktopFusionNeedsDraft: "先写草稿。",
    desktopFusionDraftReady: "草稿已就绪，可生成或填入前台。",
    desktopFusionGenerated: "已生成，可编辑后填入前台。",
    desktopFusionFilled: "已填入前台；未自动提交。",
    desktopFusionBlocked: "前台填入被守卫拦截。",
    desktopFusionEvidence: "{profile} | 候选 {candidateCount} | 安全 {safeCandidateCount} | 最佳 {bestCandidateIndex} | no-submit {noSubmit}",
    desktopPromptHandoffIdle: "Add prompt",
    desktopPromptHandoffNeedsDraft: "Draft focused",
    desktopPromptHandoffReady: "Prompt ready",
    desktopPromptHandoffClickMascot: "Click mascot",
    desktopPromptHandoffFocusInput: "Focus input",
    desktopPromptHandoffGuarded: "Guarded",
    desktopModeSelected: "模式：{mode}",
    desktopLocaleSelected: "输入语言：{locale}",
    safeFillText: "安全填入自测文本",
    safeFillPlaceholder: "仅用于本地自测；真实前台填入必须显式守卫。",
    runSafeFillTest: "运行安全填入测试",
    learningEyebrow: "学习闭环",
    learningTitle: "自反省",
    refresh: "刷新",
    reflections: "反省记录",
    evolutionCandidates: "进化候选",
    evidenceEyebrow: "证据",
    pilotOutcomes: "内测结果",
    strategies: "策略",
    collectionTargets: "采样目标",
    qualityEyebrow: "质量",
    qualityLift: "质量提升",
    cohorts: "队列",
    liftDeltas: "提升差值",
    recommendations: "建议",
    segmentsEyebrow: "分段",
    qualitySegments: "质量分段",
    improving: "改善中",
    regressing: "退化中",
    collecting: "采集中",
    feedbackEyebrow: "反馈",
    outcomeFollowup: "结果补标",
    diagnosticsEyebrow: "诊断",
    diagnosticsTitle: "导出与重置",
    exportDiagnostics: "导出诊断",
    clearLocalData: "清空本地数据",
    providerEyebrow: "Provider",
    llmSettings: "LLM 设置",
    providerLabel: "Provider",
    baseUrl: "Base URL",
    model: "模型",
    apiKey: "API Key",
    agnesKey: "Agnes Key",
    openaiKey: "OpenAI-compatible Key",
    anthropicKey: "Anthropic Key",
    geminiKey: "Gemini Key",
    storedByService: "由本地服务保存",
    saveSettings: "保存设置",
    libraryEyebrow: "本地库",
    skillLibrary: "Skill 库",
    folderPath: "文件夹路径",
    skillFolderPlaceholder: "C:\\Users\\you\\.codex\\skills",
    importFolder: "导入文件夹",
    promptLibrary: "Prompt 库",
    title: "标题",
    prompt: "Prompt",
    promptTitlePlaceholder: "可复用 prompt 标题",
    promptBodyPlaceholder: "在本地保存一个可复用 prompt",
    savePrompt: "保存 Prompt",
    shortcutEyebrow: "伴随触发",
    shortcut: "快捷键",
    globalShortcut: "全局快捷键",
    saveShortcut: "保存快捷键",
    checking: "检查中",
    serviceOnline: "服务在线",
    serviceOffline: "服务离线",
    serviceProcessRunning: "服务进程运行中",
    serviceProcessStopped: "服务进程已停止",
    serviceExited: "服务退出：{status}",
    runServiceManually: "请手动运行本地服务",
    stopServiceManually: "请从终端停止本地服务",
    restartServiceManually: "请从终端重启本地服务",
    shortcutTriggered: "快捷键触发：{shortcut}",
    shortcutCaptured: "快捷键捕获：{profile}",
    noImportedSkills: "还没有导入 skill。",
    noSavedPrompts: "还没有保存 prompt。",
    delete: "删除",
    providerStatusUnavailable: "Provider 状态不可用。",
    providerStatus: "当前：{selected}；自动：{auto}；可用：{ready}",
    none: "无",
    complete: "完成",
    firstRunProgressInitial: "0/5 就绪",
    firstRunProgress: "{ready}/{total} 就绪；缺少：{missing}",
    providerTestNotRun: "Provider 测试未运行。",
    testingProvider: "正在测试 provider",
    providerReady: "{provider} {model} 就绪（{generatedBy}，{promptLength} 字符）",
    providerTestFailed: "provider 测试失败：{message}",
    desktopSnapshotMissing: "未加载桌面输入快照。",
    targetToolNotInspected: "尚未识别目标工具。",
    signalsPending: "光标与焦点信号待识别。",
    guardPending: "前台窗口守卫待确认。",
    desktopSnapshotStatus: "{status}；{profile}；{candidateCount} 个候选；最佳 {bestCandidateIndex} 分数 {bestCandidateScore}",
    tool: "工具",
    titleHash: "标题 hash",
    process: "进程",
    candidates: "候选",
    focused: "焦点",
    caret: "光标",
    guard: "守卫",
    pending: "待确认",
    bestIndex: "最佳序号",
    noSubmit: "不提交",
    stateNormal: "正常",
    stateResting: "休息中",
    stateThinking: "思考中",
    stateSuggesting: "建议中",
    stateSuccess: "成功",
    stateClapping: "鼓掌",
    fillTestNotRun: "填入测试未运行。",
    fillDetail: "通过 {pass} | 写入 {write} | 验证 {verified} | 策略 {strategy} | 自动提交 {autoSubmit}",
    learningMissing: "未加载学习报告。",
    noReflections: "还没有反省记录。",
    noEvolutionCandidates: "还没有进化候选。",
    learningStatusDetail: "{status}；{reflections} 条反省；{candidates} 个候选；{promotionMode}",
    manualReview: "人工审核",
    noPilotOutcome: "未加载内测结果报告。",
    noStrategyOutcomes: "还没有策略结果。",
    noCollectionTargets: "还没有采样目标。",
    noQualityLift: "未加载质量提升报告。",
    noQualityCohorts: "还没有质量提升队列。",
    noQualityComparisons: "还没有质量提升对比。",
    noQualityRecommendations: "还没有质量提升建议。",
    noQualitySegments: "未加载质量分段。",
    noImprovingSegments: "还没有改善分段。",
    noRegressingSegments: "还没有退化分段。",
    noCollectingSegments: "还没有采集中分段。",
    noPendingOutcomes: "没有待补标结果。",
    pendingOutcomes: "{count} 个待补标结果；仅元数据",
    success: "成功",
    needsWork: "需调整",
    failed: "失败",
    diagnosticsEmpty: "尚未导出诊断。",
    diagnosticsExported: "诊断已导出",
    localDataCleared: "本地数据已清空",
    pilotOutcomesRefreshed: "内测结果已刷新",
    qualityLiftRefreshed: "质量提升已刷新",
    qualitySegmentsRefreshed: "质量分段已刷新",
    outcomeFollowupsRefreshed: "结果补标已刷新",
    desktopInputInspected: "桌面输入已识别",
    desktopFillComplete: "桌面填入自测完成",
    learningRefreshed: "学习闭环已刷新",
    outcomeRecorded: "结果已记录：{label}"
  },
  en: {
    brandTitle: "Smart Prompt Desktop",
    brandSubtitle: "Local prompt copilot",
    uiLocale: "Interface language",
    localeAuto: "Auto",
    localeZh: "中文",
    localeEn: "English",
    heroEyebrow: "Minimal, local, learning",
    heroTitleLine1: "Make prompts better",
    heroTitleLine2: "inside your tools.",
    heroText: "Real LLMs, skill libraries, desktop input guards, and learning evidence in one local workbench.",
    proofPromptFirst: "Prompt-first",
    proofAggregateOnly: "Aggregate-only",
    proofNoAutoSubmit: "No auto-submit",
    startService: "Start Service",
    stopService: "Stop Service",
    restartService: "Restart Service",
    firstRunEyebrow: "First Run",
    firstRunTitle: "Start clean",
    testProvider: "Test Provider",
    privacyNoBody: "No full page body",
    privacyNoTitle: "No page title",
    privacyNoSubmit: "No auto-submit",
    privacyKeys: "Keys encrypted",
    desktopCompanionEyebrow: "Desktop Companion",
    desktopCompanionTitle: "Tool input fusion",
    inspectForeground: "Inspect Foreground",
    desktopMascotAction: "Inspect foreground tool and prepare input",
    desktopSurfaceWaiting: "No foreground tool locked.",
    desktopSurfaceReady: "{profile} locked; candidates {candidateCount}; safe {safeCandidateCount}; title hash {titleHash}",
    desktopSurfaceGuarded: "{profile} detected, but the guarded input candidate is not ready.",
    desktopDraftLabel: "Draft",
    desktopDraftPlaceholder: "Write what you want the current tool to do.",
    desktopPromptLabel: "Prompt",
    desktopPromptPlaceholder: "Generated prompt stays editable before foreground fill.",
    generateDesktopPrompt: "Generate",
    fillForegroundInput: "Fill Foreground",
    desktopFusionIdle: "Waiting for a foreground tool.",
    desktopFusionNeedsDraft: "Add a draft first.",
    desktopFusionDraftReady: "Draft ready to generate or fill.",
    desktopFusionGenerated: "Generated and ready to edit before fill.",
    desktopFusionFilled: "Filled foreground; no auto-submit.",
    desktopFusionBlocked: "Foreground fill blocked by guard.",
    desktopFusionEvidence: "{profile} | candidates {candidateCount} | safe {safeCandidateCount} | best {bestCandidateIndex} | no-submit {noSubmit}",
    desktopPromptHandoffIdle: "Add prompt",
    desktopPromptHandoffNeedsDraft: "Draft focused",
    desktopPromptHandoffReady: "Prompt ready",
    desktopPromptHandoffClickMascot: "Click mascot",
    desktopPromptHandoffFocusInput: "Focus input",
    desktopPromptHandoffGuarded: "Guarded",
    desktopModeSelected: "Mode: {mode}",
    desktopLocaleSelected: "Input language: {locale}",
    safeFillText: "Safe fill self-test text",
    safeFillPlaceholder: "Used only for local self-test unless a guarded foreground fill is explicitly wired.",
    runSafeFillTest: "Run Safe Fill Test",
    learningEyebrow: "Learning Loop",
    learningTitle: "Self-reflection",
    refresh: "Refresh",
    reflections: "Reflections",
    evolutionCandidates: "Evolution Candidates",
    evidenceEyebrow: "Evidence",
    pilotOutcomes: "Pilot Outcomes",
    strategies: "Strategies",
    collectionTargets: "Collection Targets",
    qualityEyebrow: "Quality",
    qualityLift: "Quality Lift",
    cohorts: "Cohorts",
    liftDeltas: "Lift Deltas",
    recommendations: "Recommendations",
    segmentsEyebrow: "Segments",
    qualitySegments: "Quality Segments",
    improving: "Improving",
    regressing: "Regressing",
    collecting: "Collecting",
    feedbackEyebrow: "Feedback",
    outcomeFollowup: "Outcome Follow-up",
    diagnosticsEyebrow: "Diagnostics",
    diagnosticsTitle: "Export and reset",
    exportDiagnostics: "Export Diagnostics",
    clearLocalData: "Clear Local Data",
    providerEyebrow: "Provider",
    llmSettings: "LLM Settings",
    providerLabel: "Provider",
    baseUrl: "Base URL",
    model: "Model",
    apiKey: "API Key",
    agnesKey: "Agnes Key",
    openaiKey: "OpenAI-compatible Key",
    anthropicKey: "Anthropic Key",
    geminiKey: "Gemini Key",
    storedByService: "Stored by local service",
    saveSettings: "Save Settings",
    libraryEyebrow: "Library",
    skillLibrary: "Skill Library",
    folderPath: "Folder path",
    skillFolderPlaceholder: "C:\\Users\\you\\.codex\\skills",
    importFolder: "Import Folder",
    promptLibrary: "Prompt Library",
    title: "Title",
    prompt: "Prompt",
    promptTitlePlaceholder: "Reusable prompt title",
    promptBodyPlaceholder: "Save a reusable prompt locally",
    savePrompt: "Save Prompt",
    shortcutEyebrow: "Companion Trigger",
    shortcut: "Shortcut",
    globalShortcut: "Global shortcut",
    saveShortcut: "Save Shortcut",
    checking: "checking",
    serviceOnline: "service online",
    serviceOffline: "service offline",
    serviceProcessRunning: "service process running",
    serviceProcessStopped: "service process stopped",
    serviceExited: "service {status}",
    runServiceManually: "run local service manually",
    stopServiceManually: "stop local service from terminal",
    restartServiceManually: "restart local service from terminal",
    shortcutTriggered: "shortcut triggered: {shortcut}",
    shortcutCaptured: "shortcut captured: {profile}",
    noImportedSkills: "No imported skills yet.",
    noSavedPrompts: "No saved prompts yet.",
    delete: "Delete",
    providerStatusUnavailable: "Provider status unavailable.",
    providerStatus: "Selected: {selected}; auto: {auto}; ready: {ready}",
    none: "none",
    complete: "complete",
    firstRunProgressInitial: "0/5 ready",
    firstRunProgress: "{ready}/{total} ready; missing: {missing}",
    providerTestNotRun: "Provider test not run.",
    testingProvider: "testing provider",
    providerReady: "{provider} {model} ready ({generatedBy}, {promptLength} chars)",
    providerTestFailed: "provider test failed: {message}",
    desktopSnapshotMissing: "No desktop input snapshot loaded.",
    targetToolNotInspected: "Target tool not inspected.",
    signalsPending: "Caret and focus signals pending.",
    guardPending: "Foreground guard pending.",
    desktopSnapshotStatus: "{status}; {profile}; {candidateCount} candidates; best {bestCandidateIndex} score {bestCandidateScore}",
    tool: "Tool",
    titleHash: "Title hash",
    process: "Process",
    candidates: "Candidates",
    focused: "Focused",
    caret: "Caret",
    guard: "Guard",
    pending: "pending",
    bestIndex: "Best index",
    noSubmit: "No submit",
    stateNormal: "normal",
    stateResting: "resting",
    stateThinking: "thinking",
    stateSuggesting: "suggesting",
    stateSuccess: "success",
    stateClapping: "clapping",
    fillTestNotRun: "No fill test run.",
    fillDetail: "pass {pass} | write {write} | verified {verified} | strategy {strategy} | autoSubmit {autoSubmit}",
    learningMissing: "No learning report loaded.",
    noReflections: "No reflections yet.",
    noEvolutionCandidates: "No evolution candidates yet.",
    learningStatusDetail: "{status}; {reflections} reflections; {candidates} candidates; {promotionMode}",
    manualReview: "manual review",
    noPilotOutcome: "No pilot outcome report loaded.",
    noStrategyOutcomes: "No strategy outcomes yet.",
    noCollectionTargets: "No collection targets yet.",
    noQualityLift: "No quality lift report loaded.",
    noQualityCohorts: "No quality lift cohorts yet.",
    noQualityComparisons: "No quality lift comparisons yet.",
    noQualityRecommendations: "No quality lift recommendations yet.",
    noQualitySegments: "No quality lift segments loaded.",
    noImprovingSegments: "No improving segments yet.",
    noRegressingSegments: "No regressing segments yet.",
    noCollectingSegments: "No collecting segments yet.",
    noPendingOutcomes: "No pending outcomes.",
    pendingOutcomes: "{count} pending outcomes; metadata only",
    success: "Success",
    needsWork: "Needs work",
    failed: "Failed",
    diagnosticsEmpty: "No diagnostics exported.",
    diagnosticsExported: "diagnostics exported",
    localDataCleared: "local data cleared",
    pilotOutcomesRefreshed: "pilot outcomes refreshed",
    qualityLiftRefreshed: "quality lift refreshed",
    qualitySegmentsRefreshed: "quality lift segments refreshed",
    outcomeFollowupsRefreshed: "outcome follow-ups refreshed",
    desktopInputInspected: "desktop input inspected",
    desktopFillComplete: "desktop fill self-test complete",
    learningRefreshed: "learning loop refreshed",
    outcomeRecorded: "outcome recorded: {label}"
  }
};

let desktopSnapshotState = null;
let currentLocale = "zh-CN";
let desktopPromptMode = "idea";
const desktopOverlayState = {
  visible: false,
  lastPayload: null,
  lastReadyAt: 0,
  autoStarted: false,
  pollInFlight: false,
  pollPending: false,
  fastPollInFlight: false,
  fastPollPending: false,
  timer: null,
  fastTimer: null,
  pollBackoffMs: 500,
  fastPollBackoffMs: 100,
  fastState: null,
  fastSignature: "",
  lastFastTraceSignature: "",
  lastFastSupported: false,
  collapseTimer: null
};
const codexTargetState = {
  inspectResponse: null,
  lease: null,
  targetSignature: "",
  openingTargetSignature: "",
  openingDraftHash: "",
  openingDraftText: "",
  projectScopeToken: "",
  sessionId: "",
  generationId: "",
  undoToken: "",
  undoDraftHash: "",
  undoOpeningDraftText: "",
  transactionId: "",
  pendingOutcome: null,
  learningCandidate: null,
  learningFeatureTokens: [],
  inspectInFlight: false,
  inspectPending: false,
  sequence: 0
};
const controlCenterLearningState = {
  artifacts: [],
  proposals: [],
  policies: [],
  rollouts: [],
  learningPaused: false,
  selectedCandidate: null,
  refreshInFlight: null,
  policyActionContexts: new Map(),
  policyActionSequence: 0
};
const DESKTOP_OVERLAY_SIZE = { width: 320, height: 360 };
const DESKTOP_OVERLAY_COMPACT_SIZE = { width: 72, height: 72 };
const DESKTOP_OVERLAY_COMPACT_GAP = 12;
const DESKTOP_OVERLAY_SUBMIT_AVOIDANCE_WIDTH = 120;
const DESKTOP_OVERLAY_POLL_MS = 500;
const DESKTOP_OVERLAY_FAST_POLL_MS = 100;
const DESKTOP_OVERLAY_MAX_BACKOFF_MS = 60000;
const DESKTOP_OVERLAY_STICKY_MS = 4200;
const DESKTOP_OVERLAY_GUARD_FEEDBACK_MS = 650;
const DESKTOP_OVERLAY_SUCCESS_FEEDBACK_MS = 900;
const DESKTOP_PROMPT_STATE_SYNC_MS = 180;
const DESKTOP_OVERLAY_DRAFT_MAX_LENGTH = 400;
const DESKTOP_OVERLAY_PROFILES = new Set(["codex", "workbuddy", "trae"]);
const DESKTOP_PROMPT_MODES = new Set(["idea", "continue", "polish"]);
const CODEX_OUTCOME_FAILURE_REASONS = new Set([
  "missing_context",
  "wrong_format",
  "not_actionable",
  "too_long",
  "token_waste",
  "tool_mismatch",
  "low_quality",
  "insert_failed"
]);
const desktopOverlayLogic = globalThis.SmartPromptDesktopOverlayLogic;
if (!desktopOverlayLogic) {
  throw new Error("Smart Prompt desktop overlay logic is not loaded.");
}
const desktopPromptStateSync = {
  timer: null,
  inFlight: false
};

const phase3ControlCenterActive = document.body?.dataset?.phase3ControlCenter === "true";
const legacyRoot = typeof document.querySelector === "function"
  ? document.querySelector(".legacy-shell")
  : null;
if (phase3ControlCenterActive && legacyRoot?.querySelector) {
  const duplicateLearningStatus = legacyRoot.querySelector("#learning-status");
  if (duplicateLearningStatus) duplicateLearningStatus.id = "legacy-learning-status";
}

function getLegacyElement(id) {
  if (legacyRoot?.querySelector) {
    const scopedId = id === "learning-status" && phase3ControlCenterActive
      ? "legacy-learning-status"
      : id;
    return legacyRoot.querySelector(`#${scopedId}`);
  }
  return document.getElementById(id);
}

const els = {
  uiLocale: getLegacyElement("ui-locale"),
  status: getLegacyElement("service-status"),
  provider: getLegacyElement("provider"),
  providerStatus: getLegacyElement("provider-status"),
  baseUrl: getLegacyElement("base-url"),
  model: getLegacyElement("model"),
  apiKey: getLegacyElement("api-key"),
  agnesApiKey: getLegacyElement("agnes-api-key"),
  openaiApiKey: getLegacyElement("openai-api-key"),
  anthropicApiKey: getLegacyElement("anthropic-api-key"),
  geminiApiKey: getLegacyElement("gemini-api-key"),
  startService: getLegacyElement("start-service"),
  stopService: getLegacyElement("stop-service"),
  restartService: getLegacyElement("restart-service"),
  firstRunProgress: getLegacyElement("first-run-progress"),
  privacyBoundary: getLegacyElement("privacy-boundary"),
  testProvider: getLegacyElement("test-provider"),
  providerTestStatus: getLegacyElement("provider-test-status"),
  refreshPilotOutcomes: getLegacyElement("refresh-pilot-outcomes"),
  pilotOutcomeStatus: getLegacyElement("pilot-outcome-status"),
  pilotOutcomeSummary: getLegacyElement("pilot-outcome-summary"),
  pilotOutcomeStrategies: getLegacyElement("pilot-outcome-strategies"),
  pilotOutcomeTargets: getLegacyElement("pilot-outcome-targets"),
  refreshQualityLift: getLegacyElement("refresh-quality-lift"),
  qualityLiftStatus: getLegacyElement("quality-lift-status"),
  qualityLiftSummary: getLegacyElement("quality-lift-summary"),
  qualityLiftCohorts: getLegacyElement("quality-lift-cohorts"),
  qualityLiftComparisons: getLegacyElement("quality-lift-comparisons"),
  qualityLiftRecommendations: getLegacyElement("quality-lift-recommendations"),
  refreshQualityLiftSegments: getLegacyElement("refresh-quality-lift-segments"),
  qualityLiftSegmentsStatus: getLegacyElement("quality-lift-segments-status"),
  qualityLiftSegmentsImproving: getLegacyElement("quality-lift-segments-improving"),
  qualityLiftSegmentsRegressing: getLegacyElement("quality-lift-segments-regressing"),
  qualityLiftSegmentsCollecting: getLegacyElement("quality-lift-segments-collecting"),
  refreshOutcomeFollowups: getLegacyElement("refresh-outcome-followups"),
  outcomeFollowupStatus: getLegacyElement("outcome-followup-status"),
  outcomeFollowupList: getLegacyElement("outcome-followup-list"),
  refreshDesktopSnapshot: getLegacyElement("refresh-desktop-snapshot"),
  desktopCompanionStatus: getLegacyElement("desktop-companion-status"),
  desktopToolSummary: getLegacyElement("desktop-tool-summary"),
  desktopSignalSummary: getLegacyElement("desktop-signal-summary"),
  desktopGuardSummary: getLegacyElement("desktop-guard-summary"),
  desktopSupportedProfiles: getLegacyElement("desktop-supported-profiles"),
  desktopMascotImage: getLegacyElement("desktop-mascot-image"),
  desktopMascotState: getLegacyElement("desktop-mascot-state"),
  desktopFusionConsole: getLegacyElement("desktop-fusion-console"),
  desktopMascotButton: getLegacyElement("desktop-mascot-button"),
  desktopFusionMascotImage: getLegacyElement("desktop-fusion-mascot-image"),
  desktopFusionMascotState: getLegacyElement("desktop-fusion-mascot-state"),
  desktopInputSurface: getLegacyElement("desktop-input-surface"),
  desktopDraftInput: getLegacyElement("desktop-draft-input"),
  desktopGeneratedPrompt: getLegacyElement("desktop-generated-prompt"),
  desktopPromptHandoff: getLegacyElement("desktop-prompt-handoff"),
  generateDesktopPrompt: getLegacyElement("generate-desktop-prompt"),
  fillForegroundInput: getLegacyElement("fill-foreground-input"),
  desktopFusionEvidence: getLegacyElement("desktop-fusion-evidence"),
  desktopFillText: getLegacyElement("desktop-fill-text"),
  runDesktopSelfTest: getLegacyElement("run-desktop-self-test"),
  desktopFillResult: getLegacyElement("desktop-fill-result"),
  refreshLearning: getLegacyElement("refresh-learning"),
  learningStatus: getLegacyElement("learning-status"),
  selfImprovementSummary: getLegacyElement("self-improvement-summary"),
  evolutionCandidateSummary: getLegacyElement("evolution-candidate-summary"),
  exportDiagnostics: getLegacyElement("export-diagnostics"),
  clearLocalData: getLegacyElement("clear-local-data"),
  diagnosticsOutput: getLegacyElement("diagnostics-output"),
  saveSettings: getLegacyElement("save-settings"),
  skillFolder: getLegacyElement("skill-folder"),
  importFolder: getLegacyElement("import-folder"),
  skillList: getLegacyElement("skill-list"),
  promptTitle: getLegacyElement("prompt-title"),
  promptBody: getLegacyElement("prompt-body"),
  savePrompt: getLegacyElement("save-prompt"),
  promptList: getLegacyElement("prompt-list"),
  shortcut: getLegacyElement("shortcut"),
  saveShortcut: getLegacyElement("save-shortcut")
};

const firstRunState = {
  settings: null,
  providerStatus: null,
  skills: []
};

function normalizeLocale(value) {
  const text = String(value || "").toLowerCase();
  if (text.startsWith("zh")) return "zh-CN";
  if (text.startsWith("en")) return "en";
  return "zh-CN";
}

function getStoredLocaleSetting() {
  return localStorage.getItem("smartPromptDesktopLocale") || "zh-CN";
}

function getAutoLocale() {
  const browserLocale = typeof navigator !== "undefined" ? navigator.language : "";
  return normalizeLocale(browserLocale || document.documentElement.lang || "zh-CN");
}

function resolveLocale(setting = getStoredLocaleSetting()) {
  return setting === "auto" ? getAutoLocale() : normalizeLocale(setting);
}

function t(key, values = {}) {
  const template = UI_MESSAGES[currentLocale]?.[key] || UI_MESSAGES.en[key] || key;
  return template.replace(/\{([^}]+)\}/g, (_, name) => {
    return values[name] === undefined || values[name] === null ? "" : String(values[name]);
  });
}

function applyLocale(setting = getStoredLocaleSetting()) {
  currentLocale = resolveLocale(setting);
  document.documentElement.lang = currentLocale;
  if (els.uiLocale) {
    els.uiLocale.value = setting;
    const autoOption = typeof els.uiLocale.querySelector === "function"
      ? els.uiLocale.querySelector('option[value="auto"]')
      : null;
    if (autoOption) autoOption.textContent = t("localeAuto");
  }
  if (typeof document.querySelectorAll === "function") {
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
      element.placeholder = t(element.dataset.i18nPlaceholder);
    });
    document.querySelectorAll("[data-i18n-aria]").forEach((element) => {
      element.setAttribute("aria-label", t(element.dataset.i18nAria));
    });
    document.querySelectorAll("input, textarea").forEach((element) => {
      element.lang = currentLocale;
      element.dir = "auto";
    });
  }
}

function setLocaleSetting(setting) {
  localStorage.setItem("smartPromptDesktopLocale", setting || "auto");
  applyLocale(setting || "auto");
}

async function serviceRequest(path, options, retrying = false) {
  const token = await getServiceAuthToken(path);
  const response = await fetch(`${SERVICE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {})
    }
  });
  const body = await parseServiceJsonResponse(response, path);
  if (response.status === 401 && path !== "/auth/bootstrap" && !retrying) {
    serviceAuthToken = "";
    return serviceRequest(path, options, true);
  }
  if (!response.ok || body.ok === false) {
    throw new Error(body?.error?.message || `Service failed: ${response.status}`);
  }
  return body;
}

async function getServiceAuthToken(path) {
  if (path === "/health" || path === "/auth/bootstrap") return "";
  if (serviceAuthToken) return serviceAuthToken;
  const response = await fetch(`${SERVICE_URL}/auth/bootstrap`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json"
    }
  });
  const body = await parseServiceJsonResponse(response, "/auth/bootstrap");
  if (!response.ok || body.ok === false || !body.auth?.token) {
    throw new Error(body?.error?.message || `Service auth failed: ${response.status}`);
  }
  serviceAuthToken = body.auth.token;
  return serviceAuthToken;
}

async function parseServiceJsonResponse(response, path) {
  const text = await response.text();
  if (!text.trim()) {
    if (response.ok) return {};
    const error = new Error(`Service ${path} returned empty response: ${response.status}`);
    error.code = "service_empty_response";
    error.status = response.status;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (parseError) {
    const error = new Error(`Service ${path} returned non-JSON: ${response.status} ${text.slice(0, 200)}`);
    error.code = "service_non_json_response";
    error.status = response.status;
    error.cause = parseError;
    throw error;
  }
}

function setStatus(text, ok) {
  els.status.textContent = text;
  els.status.classList.toggle("is-online", Boolean(ok));
  els.status.classList.toggle("is-offline", !ok);
}

async function refreshLocalServiceStatus() {
  if (window.__TAURI__?.core?.invoke) {
    const status = await window.__TAURI__.core.invoke("get_local_service_status");
    document.documentElement.dataset.localServiceStatus = status;
    if (status === "running") setStatus(t("serviceProcessRunning"), true);
    if (status === "stopped") setStatus(t("serviceProcessStopped"), false);
    if (status.startsWith("exited:")) setStatus(t("serviceExited", { status }), false);
    return status;
  }
  return "";
}

function recordShortcutTrigger(shortcut) {
  window.__smartPromptShortcutHits = (window.__smartPromptShortcutHits || 0) + 1;
  document.documentElement.dataset.shortcutHits = String(window.__smartPromptShortcutHits);
  document.documentElement.dataset.lastShortcut = shortcut || "";
  setStatus(t("shortcutTriggered", { shortcut: shortcut || "unknown" }), true);
  if (String(desktopOverlayState.fastState?.detectedToolProfile || "").toLowerCase() === "codex") {
    openCodexPromptSession({ source: "shortcut" }).catch((error) => setStatus(error.message, false));
    return;
  }
  refreshDesktopSnapshot({ source: "shortcut" }).catch((error) => setStatus(error.message, false));
}

function renderSkills(skills) {
  if (!skills?.length) {
    els.skillList.innerHTML = `<div class="skill-row">${escapeHtml(t("noImportedSkills"))}</div>`;
    return;
  }
  els.skillList.innerHTML = skills.slice(0, 20).map((skill) => {
    const id = encodeURIComponent(skill.id || "");
    return `<div class="skill-row library-row"><div><strong>${escapeHtml(skill.name)}</strong><br>${escapeHtml(skill.description || "")}</div><button type="button" class="row-action button-ghost" data-action="delete-skill" data-skill-id="${id}">${escapeHtml(t("delete"))}</button></div>`;
  }).join("");
}

function renderPrompts(prompts) {
  if (!prompts?.length) {
    els.promptList.innerHTML = `<div class="skill-row">${escapeHtml(t("noSavedPrompts"))}</div>`;
    return;
  }
  els.promptList.innerHTML = prompts.slice(0, 20).map((prompt) => {
    const body = String(prompt.body || "").slice(0, 180);
    const id = encodeURIComponent(prompt.id || "");
    return `<div class="skill-row library-row"><div><strong>${escapeHtml(prompt.title)}</strong><br>${escapeHtml(body)}</div><button type="button" class="row-action button-ghost" data-action="delete-prompt" data-prompt-id="${id}">${escapeHtml(t("delete"))}</button></div>`;
  }).join("");
}

function renderProviderStatus(status) {
  if (!status?.providers) {
    els.providerStatus.textContent = t("providerStatusUnavailable");
    return;
  }
  const ready = status.providers
    .filter((provider) => provider.keyAvailable)
    .map((provider) => provider.label)
    .join(", ") || t("none");
  els.providerStatus.textContent = t("providerStatus", {
    selected: status.selected,
    auto: status.auto?.provider || "n/a",
    ready
  });
}

function renderFirstRunProgress(nextState = {}) {
  firstRunState.settings = nextState.settings || firstRunState.settings;
  firstRunState.providerStatus = nextState.providerStatus || firstRunState.providerStatus;
  firstRunState.skills = Array.isArray(nextState.skills) ? nextState.skills : firstRunState.skills;

  const settings = firstRunState.settings || {};
  const providerStatus = firstRunState.providerStatus || {};
  const providerConfigured = Boolean(settings.provider && settings.model);
  const providerKeyReady = Boolean(providerStatus.providers?.some((provider) => provider.keyAvailable));
  const providerTested = localStorage.getItem("smartPromptProviderTestPass") === "true";
  const skillImported = firstRunState.skills.length > 0;
  const privacyVisible = Boolean(els.privacyBoundary);
  const steps = [
    ["provider", providerConfigured],
    ["key", providerKeyReady],
    ["test", providerTested],
    ["skill", skillImported],
    ["privacy", privacyVisible]
  ];
  const readyCount = steps.filter(([, ready]) => ready).length;
  const missing = steps.filter(([, ready]) => !ready).map(([label]) => label).join(", ") || t("complete");

  els.firstRunProgress.textContent = t("firstRunProgress", { ready: readyCount, total: steps.length, missing });
  els.firstRunProgress.dataset.providerConfigured = String(providerConfigured);
  els.firstRunProgress.dataset.providerKeyReady = String(providerKeyReady);
  els.firstRunProgress.dataset.providerTested = String(providerTested);
  els.firstRunProgress.dataset.skillImported = String(skillImported);
  els.firstRunProgress.dataset.privacyVisible = String(privacyVisible);
  els.firstRunProgress.dataset.firstRunReady = String(readyCount === steps.length);
}

function setMascotState(name) {
  const state = MASCOT_STATE_IMAGES[name] ? name : "normal";
  if (els.desktopMascotImage) els.desktopMascotImage.src = MASCOT_STATE_IMAGES[state];
  if (els.desktopFusionMascotImage) els.desktopFusionMascotImage.src = MASCOT_STATE_IMAGES[state];
  if (els.desktopMascotButton) els.desktopMascotButton.dataset.state = state;
  if (els.desktopMascotState) {
    els.desktopMascotState.dataset.i18n = MASCOT_STATE_LABEL_KEYS[state] || "stateNormal";
    els.desktopMascotState.textContent = t(els.desktopMascotState.dataset.i18n);
    els.desktopMascotState.dataset.mascotState = state;
  }
  if (els.desktopFusionMascotState) {
    els.desktopFusionMascotState.dataset.i18n = MASCOT_STATE_LABEL_KEYS[state] || "stateNormal";
    els.desktopFusionMascotState.textContent = t(els.desktopFusionMascotState.dataset.i18n);
    els.desktopFusionMascotState.dataset.mascotState = state;
  }
  updateDesktopMascotOverlayState(state);
}

function renderInlineStats(items) {
  return items.map(([label, value]) => {
    return `<span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>`;
  }).join("");
}

function renderDesktopSupportedProfiles(profiles = []) {
  const supported = Array.isArray(profiles) && profiles.length
    ? profiles
    : ["codex", "claude-code", "hermes", "workbuddy", "trae"];
  els.desktopSupportedProfiles.innerHTML = supported
    .map((profile) => `<span>${escapeHtml(profile)}</span>`)
    .join("");
  els.desktopSupportedProfiles.dataset.supportedProfileCount = String(supported.length);
}

function getDesktopSnapshotReadiness(snapshot = desktopSnapshotState) {
  return desktopOverlayLogic.getDesktopSnapshotReadiness(snapshot, {
    overlayProfiles: DESKTOP_OVERLAY_PROFILES
  });
}

function isCodexBrowserLikeComposerCandidate(profile, candidate) {
  return desktopOverlayLogic.isCodexBrowserLikeComposerCandidate(profile, candidate);
}

function isDesktopOverlayVisualAnchorCandidate(candidate, profile = "unknown") {
  return desktopOverlayLogic.isDesktopOverlayVisualAnchorCandidate(candidate, profile);
}

function getBestDesktopCandidate(snapshot = desktopSnapshotState) {
  return desktopOverlayLogic.getBestDesktopCandidate(snapshot);
}

function isDesktopOverlayCandidate(candidate) {
  return desktopOverlayLogic.isDesktopOverlayCandidate(candidate);
}

function getDesktopOverlayCandidate(snapshot = desktopSnapshotState, readiness = getDesktopSnapshotReadiness(snapshot)) {
  return desktopOverlayLogic.getDesktopOverlayCandidate(snapshot, readiness);
}

function getDesktopOverlayVisualAnchor(snapshot = desktopSnapshotState, profile = "unknown") {
  return desktopOverlayLogic.getDesktopOverlayVisualAnchor(snapshot, profile);
}

function getDesktopOverlayVisualAnchorPriority(candidate) {
  return desktopOverlayLogic.getDesktopOverlayVisualAnchorPriority(candidate);
}

function getDesktopOverlayVisualAnchorReason(candidate, visualOnly = false) {
  return desktopOverlayLogic.getDesktopOverlayVisualAnchorReason(candidate, visualOnly);
}

function getDesktopOverlayVisualAnchorMeta(candidate, visualOnly = false) {
  return desktopOverlayLogic.getDesktopOverlayVisualAnchorMeta(candidate, visualOnly);
}

function getDesktopOverlayPlacement(candidate) {
  return desktopOverlayLogic.getDesktopOverlayPlacement(candidate, {
    overlaySize: DESKTOP_OVERLAY_SIZE,
    compactSize: DESKTOP_OVERLAY_COMPACT_SIZE,
    compactGap: DESKTOP_OVERLAY_COMPACT_GAP,
    submitAvoidanceWidth: DESKTOP_OVERLAY_SUBMIT_AVOIDANCE_WIDTH
  });
}

function isFastForegroundSupported(state = {}) {
  return desktopOverlayLogic.isFastForegroundSupported(state, {
    overlayProfiles: DESKTOP_OVERLAY_PROFILES
  });
}

function getFastForegroundSignature(state = {}) {
  return desktopOverlayLogic.getFastForegroundSignature(state);
}

function recordFastForegroundState(state = {}, source = "poll") {
  const signature = getFastForegroundSignature(state);
  const supported = isFastForegroundSupported(state);
  const changed = signature !== desktopOverlayState.fastSignature;
  const traceChanged = signature !== desktopOverlayState.lastFastTraceSignature;
  desktopOverlayState.fastState = state;
  desktopOverlayState.fastSignature = signature;
  if (traceChanged) {
    desktopOverlayState.lastFastTraceSignature = signature;
    traceDesktopOverlayRuntime("overlay-fast-window-state", {
      source,
      profile: String(state?.detectedToolProfile || "unknown"),
      supported: Boolean(supported),
      isVisible: Boolean(state?.isVisible),
      isMinimized: Boolean(state?.isMinimized),
      isCloaked: Boolean(state?.isCloaked),
      isUsable: Boolean(state?.isUsable)
    });
  }
  document.documentElement.dataset.desktopFastToolProfile = String(state?.detectedToolProfile || "unknown");
  document.documentElement.dataset.desktopFastToolUsable = String(Boolean(state?.isUsable));
  document.documentElement.dataset.desktopFastToolSupported = String(supported);
  return { signature, supported, changed };
}

function getFastForegroundAnchorRect(state = {}) {
  return desktopOverlayLogic.getFastForegroundAnchorRect(state);
}

function buildFastForegroundOverlayPayload(state = {}, overlayMode = "compact") {
  if (!isFastForegroundSupported(state)) return null;
  const anchorRect = getFastForegroundAnchorRect(state);
  if (!anchorRect) return null;
  const candidate = {
    index: -1,
    controlType: "FastForegroundWindow",
    isEnabled: true,
    isKeyboardFocusable: false,
    hasValuePattern: false,
    hasTextPattern: false,
    boundingRect: anchorRect,
    inputSignals: {
      score: 0,
      hasKeyboardFocus: false,
      focusedElementMatch: false,
      caretWithinBounds: false,
      caretWindowMatch: false,
      cursorWithinBounds: false,
      nearWindowBottom: true,
      broadDocument: false,
      semanticComposerHint: false,
      visualFallback: true,
      profileComposerCandidate: false
    }
  };
  const placement = getDesktopOverlayPlacement(candidate);
  if (!placement) return null;
  return withDesktopPromptOverlayMeta({
    ...placement,
    profile: String(state.detectedToolProfile || "unknown"),
    state: "thinking",
    overlayMode,
    titleHash: String(state.titleHash || ""),
    candidateIndex: -1,
    noAutoSubmit: true,
    visualOnly: true,
    fastWindowProbe: true,
    visualAnchor: {
      index: -1,
      controlType: "FastForegroundWindow",
      reason: "fast-window-probe",
      visualOnly: true,
      bounds: anchorRect
    },
    visualAnchorIndex: -1,
    visualAnchorReason: "fast-window-probe",
    candidateCount: 0,
    safeCandidateCount: 0,
    browserLikeComposerCandidateCount: 0,
    readinessReason: "fast-window-probe",
    overlayReadinessReason: "fast-window-probe",
    overlayReady: false
  });
}

function hashText(value) {
  const text = String(value || "");
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function createCodexClientToken(prefix) {
  codexTargetState.sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${codexTargetState.sequence.toString(36)}`;
}

function getCodexTargetSignature(lease = {}) {
  return [
    lease.target,
    lease.hwnd,
    lease.pid,
    lease.runtimeIdentityHash,
    lease.focusIdentityHash,
    lease.projectScopeToken
  ].map((value) => String(value ?? "")).join("|");
}

function isCodexAdapterReady(response = {}) {
  const lease = response.lease || {};
  const capabilities = lease.capabilities || {};
  return Boolean(
    response.result?.status === "ready"
      && response.result?.target === "codex"
      && lease.target === "codex"
      && lease.focused === true
      && capabilities.exactRead === true
      && capabilities.fullReplace === true
      && (capabilities.directSetValue === true || capabilities.controlledClipboard === true)
      && /^[a-f0-9]{64}$/.test(String(lease.draftHash || ""))
      && Boolean(lease.leaseId)
      && Boolean(lease.projectScopeToken)
  );
}

function getCodexAdapterReason(response = {}, fallback = "target_missing") {
  return String(response.result?.reasonToken || response.error?.code || fallback);
}

function getCodexPromptReason(reasonToken) {
  const reason = String(reasonToken || "");
  if (reason.includes("focus")) return "target-not-focused";
  if (reason.includes("missing") || reason.includes("foreground")) return "target-missing";
  if (reason.includes("readback") || reason.includes("exact_read")) return "readback-unavailable";
  if (reason.includes("clipboard") || reason.includes("unsupported")) return "target-unsupported";
  if (reason.includes("draft_changed") || reason.includes("target_changed") || reason.includes("window_changed")) {
    return "target-unsafe";
  }
  if (reason.includes("safety") || reason.includes("stale") || reason.includes("transaction")) return "target-unsafe";
  return "insert-failed";
}

function clearCodexUndo(reason = "invalidated") {
  if (!codexTargetState.undoToken) return false;
  codexTargetState.undoToken = "";
  codexTargetState.undoDraftHash = "";
  codexTargetState.undoOpeningDraftText = "";
  codexTargetState.transactionId = "";
  if (desktopOverlayState.lastPayload) {
    desktopOverlayState.lastPayload = {
      ...desktopOverlayState.lastPayload,
      canUndo: false,
      collapseRequested: false,
      undoInvalidationReason: reason
    };
    invokeDesktopOverlay("set_mascot_overlay_state", desktopOverlayState.lastPayload)
      .catch((error) => warnAsyncFailure("codex-undo-invalidation", error));
  }
  return true;
}

function clearCodexPromptSession(reason = "target_changed") {
  clearCodexUndo(reason);
  codexTargetState.undoToken = "";
  codexTargetState.undoDraftHash = "";
  codexTargetState.undoOpeningDraftText = "";
  codexTargetState.transactionId = "";
  codexTargetState.inspectResponse = null;
  codexTargetState.lease = null;
  codexTargetState.targetSignature = "";
  codexTargetState.openingTargetSignature = "";
  codexTargetState.openingDraftHash = "";
  codexTargetState.openingDraftText = "";
  codexTargetState.projectScopeToken = "";
  codexTargetState.sessionId = "";
  codexTargetState.generationId = "";
  codexTargetState.pendingOutcome = null;
  codexTargetState.learningCandidate = null;
  codexTargetState.learningFeatureTokens = [];
  applyCodexOpeningDraft("");
}

function rememberCodexInspect(response = {}) {
  if (!isCodexAdapterReady(response)) {
    if (codexTargetState.targetSignature) clearCodexUndo("target_changed");
    codexTargetState.inspectResponse = response;
    codexTargetState.lease = null;
    codexTargetState.targetSignature = "";
    return false;
  }
  const signature = getCodexTargetSignature(response.lease);
  if (codexTargetState.targetSignature && signature !== codexTargetState.targetSignature) {
    clearCodexUndo("target_changed");
  } else if (codexTargetState.undoToken && codexTargetState.undoDraftHash
      && response.lease.draftHash !== codexTargetState.undoDraftHash) {
    clearCodexUndo("target_content_changed");
  }
  codexTargetState.inspectResponse = response;
  codexTargetState.lease = response.lease;
  codexTargetState.targetSignature = signature;
  return true;
}

async function inspectCodexTarget() {
  const response = await serviceRequest("/target/codex/inspect", {
    method: "POST",
    body: JSON.stringify({})
  });
  rememberCodexInspect(response);
  return response;
}

function buildCodexAdapterOverlayPayload(response, state = "suggesting", overlayMode = "compact") {
  if (!isCodexAdapterReady(response)) return null;
  const fastState = desktopOverlayState.fastState || {};
  if (!isFastForegroundSupported(fastState)
      || String(fastState.detectedToolProfile || "").toLowerCase() !== "codex") return null;
  const base = buildFastForegroundOverlayPayload(fastState, overlayMode);
  if (!base) return null;
  return withDesktopPromptOverlayMeta({
    ...base,
    profile: "codex",
    state,
    overlayMode,
    titleHash: "",
    candidateIndex: -1,
    noAutoSubmit: true,
    visualOnly: false,
    fastWindowProbe: false,
    codexAdapterReady: true,
    codexAdapterStatus: "ready",
    exactRead: true,
    fullReplace: true,
    overlayReady: true,
    readinessReason: "ready",
    overlayReadinessReason: "ready",
    pendingOutcome: codexTargetState.pendingOutcome,
    learningCandidate: codexTargetState.learningCandidate
  });
}

async function syncCodexAdapterOverlay(response, options = {}) {
  if (!isCodexAdapterReady(response)) {
    await hideDesktopMascotOverlay();
    return false;
  }
  const payload = buildCodexAdapterOverlayPayload(
    response,
    options.state || "suggesting",
    options.overlayMode || getDesktopOverlayRefreshMode()
  );
  if (!payload) {
    await hideDesktopMascotOverlay();
    return false;
  }
  desktopOverlayState.visible = true;
  desktopOverlayState.lastPayload = { ...payload, ...(options.payload || {}) };
  desktopOverlayState.lastReadyAt = Date.now();
  return invokeDesktopOverlay(options.updateOnly ? "set_mascot_overlay_state" : "show_mascot_overlay", desktopOverlayState.lastPayload);
}

async function refreshCodexAdapterInspect(options = {}) {
  if (codexTargetState.inspectInFlight) {
    codexTargetState.inspectPending = true;
    return null;
  }
  codexTargetState.inspectInFlight = true;
  let ready = false;
  try {
    const response = await inspectCodexTarget();
    ready = isCodexAdapterReady(response);
    await syncCodexAdapterOverlay(response, options);
  } catch (error) {
    codexTargetState.inspectResponse = null;
    codexTargetState.lease = null;
    codexTargetState.targetSignature = "";
    clearCodexUndo("target_changed");
    await hideDesktopMascotOverlay();
    if (!options.silent) throw error;
  } finally {
    codexTargetState.inspectInFlight = false;
    if (codexTargetState.inspectPending) {
      codexTargetState.inspectPending = false;
      refreshCodexAdapterInspect({ silent: true }).catch((error) => warnAsyncFailure("codex-target-pending-inspect", error));
    }
  }
  return ready;
}

function applyCodexOpeningDraft(text) {
  const draft = String(text || "");
  if (els.desktopDraftInput) els.desktopDraftInput.value = draft;
  if (els.desktopGeneratedPrompt) {
    els.desktopGeneratedPrompt.value = "";
    delete els.desktopGeneratedPrompt.dataset.generatedBy;
    delete els.desktopGeneratedPrompt.dataset.promptLength;
    delete els.desktopGeneratedPrompt.dataset.generationId;
  }
  updateDesktopFusionControls();
}

function normalizeCodexLearningFeature(value, maxLength) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_.:+-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
}

function getCodexLearningFeatureTokens(card = {}) {
  const scenario = normalizeCodexLearningFeature(card.taskScenario, 120);
  const mode = normalizeCodexLearningFeature(card.mode, 80);
  const model = normalizeCodexLearningFeature(card.modelFamilyToken, 120);
  const learningPattern = normalizeCodexLearningFeature(card.learningPatternToken, 180);
  if (!scenario || !mode || !model) return [];
  const tokens = [
    `scenario:${scenario}`,
    `mode:${mode}`,
    `model:${model}`,
    "target:codex"
  ];
  if (learningPattern) tokens.push(`learning:${learningPattern}`);
  return tokens;
}

async function refreshCodexLearningReminder({ updateOverlay = true, input = null } = {}) {
  const projectScopeToken = codexTargetState.projectScopeToken;
  let featureTokens = codexTargetState.learningFeatureTokens;
  if (projectScopeToken && typeof input === "string") {
    const context = getDesktopGenerationContext();
    const resolved = await serviceRequest("/learning/v1/reminder/resolve", {
      method: "POST",
      body: JSON.stringify({
        projectScopeToken,
        input,
        taskScenarioToken: context.taskScenario,
        modeToken: context.mode
      })
    });
    featureTokens = Array.isArray(resolved?.featureTokens) ? resolved.featureTokens : [];
    codexTargetState.learningFeatureTokens = featureTokens;
    codexTargetState.learningCandidate = resolved?.reminder || null;
    if (updateOverlay) {
      await updateCodexAttentionPayload({
        learningCandidate: codexTargetState.learningCandidate,
        overlayAction: ""
      });
    }
    return codexTargetState.learningCandidate;
  }
  if (!projectScopeToken || featureTokens.length < 4 || featureTokens.length > 5) {
    codexTargetState.learningCandidate = null;
    if (updateOverlay) await updateCodexAttentionPayload({ learningCandidate: null, overlayAction: "" });
    return null;
  }
  const featureQuery = featureTokens
    .map((token) => `featureToken=${encodeURIComponent(token)}`)
    .join("&");
  const candidate = await serviceRequest(
    `/learning/v1/reminder?projectScopeToken=${encodeURIComponent(projectScopeToken)}&${featureQuery}`,
    { method: "GET" }
  );
  codexTargetState.learningCandidate = candidate?.reminder || null;
  if (updateOverlay) {
    await updateCodexAttentionPayload({
      learningCandidate: codexTargetState.learningCandidate,
      overlayAction: ""
    });
  }
  return codexTargetState.learningCandidate;
}

async function loadCodexOpenAttention(projectScopeToken, input) {
  const claimPromise = serviceRequest("/outcomes/v2/claim", {
    method: "POST",
    body: JSON.stringify({
      askId: createCodexClientToken("ask"),
      target: "codex",
      projectScopeToken
    })
  }).catch((error) => {
    warnAsyncFailure("codex-outcome-claim", error);
    return null;
  });
  const claim = await claimPromise;
  codexTargetState.pendingOutcome = claim?.result?.state === "question" ? claim.result : null;
  await refreshCodexLearningReminder({ updateOverlay: false, input }).catch((error) => {
    warnAsyncFailure("codex-candidate-reminder", error);
    codexTargetState.learningCandidate = null;
  });
}

async function openCodexPromptSession(options = {}) {
  const inspected = await inspectCodexTarget();
  if (!isCodexAdapterReady(inspected)) {
    await hideDesktopMascotOverlay();
    if (!options.silent) setStatus(t("desktopFusionBlocked"), false);
    return false;
  }
  const read = await serviceRequest("/target/codex/read", {
    method: "POST",
    body: JSON.stringify({ leaseId: inspected.lease.leaseId })
  });
  if (read.result?.status !== "ready" || typeof read.draftText !== "string") {
    await hideDesktopMascotOverlay();
    if (!options.silent) setStatus(t("desktopFusionBlocked"), false);
    return false;
  }
  codexTargetState.openingDraftHash = inspected.lease.draftHash;
  codexTargetState.openingDraftText = read.draftText;
  codexTargetState.openingTargetSignature = getCodexTargetSignature(inspected.lease);
  codexTargetState.projectScopeToken = inspected.lease.projectScopeToken;
  codexTargetState.sessionId = createCodexClientToken("desktop-session");
  codexTargetState.generationId = "";
  codexTargetState.pendingOutcome = null;
  codexTargetState.learningCandidate = null;
  codexTargetState.learningFeatureTokens = [];
  applyCodexOpeningDraft(read.draftText);
  await loadCodexOpenAttention(codexTargetState.projectScopeToken, read.draftText);
  await syncCodexAdapterOverlay(inspected, {
    state: codexTargetState.undoToken ? "success" : "suggesting",
    overlayMode: "expanded",
    updateOnly: desktopOverlayState.visible,
    payload: {
      overlayAction: "",
      promptReady: Boolean(read.draftText),
      promptKind: read.draftText ? "draft" : "none",
      promptText: read.draftText,
      promptTextLength: read.draftText.length,
      promptTextHash: hashText(read.draftText),
      openingDraftHash: codexTargetState.openingDraftHash,
      projectScopeToken: codexTargetState.projectScopeToken,
      sessionId: codexTargetState.sessionId,
      pendingOutcome: codexTargetState.pendingOutcome,
      learningCandidate: codexTargetState.learningCandidate,
      fillVerified: Boolean(codexTargetState.undoToken),
      verified: Boolean(codexTargetState.undoToken),
      verification: codexTargetState.undoToken ? "machine" : "none",
      canUndo: Boolean(codexTargetState.undoToken)
    }
  });
  setMascotState("suggesting");
  if (!options.silent) setStatus(t("desktopInputInspected"), true);
  return true;
}

function getDesktopPromptOverlayMeta() {
  const draft = els.desktopDraftInput?.value?.trim() || "";
  const prompt = els.desktopGeneratedPrompt?.value?.trim() || "";
  const promptText = prompt || draft || "";
  return {
    promptReady: Boolean(prompt || draft),
    promptKind: prompt ? "generated" : draft ? "draft" : "none",
    promptMode: desktopPromptMode,
    locale: currentLocale,
    promptText,
    promptTextLength: promptText.length,
    promptTextHash: hashText(promptText)
  };
}

function getMascotOverlayPromptText(payload = {}) {
  if (!Object.prototype.hasOwnProperty.call(payload, "promptText")) return null;
  return String(payload.promptText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .slice(0, 8000);
}

function applyMascotOverlayPromptText(payload = {}) {
  const text = getMascotOverlayPromptText(payload);
  if (text === null) return false;
  const promptKind = String(payload.promptKind || "").toLowerCase() === "draft" ? "draft" : "generated";
  if (promptKind === "draft") {
    if (els.desktopDraftInput) els.desktopDraftInput.value = text;
    if (els.desktopGeneratedPrompt) {
      els.desktopGeneratedPrompt.value = "";
      delete els.desktopGeneratedPrompt.dataset.generatedBy;
      delete els.desktopGeneratedPrompt.dataset.promptLength;
    }
  } else if (els.desktopGeneratedPrompt) {
    els.desktopGeneratedPrompt.value = text;
    els.desktopGeneratedPrompt.dataset.generatedBy = els.desktopGeneratedPrompt.dataset.generatedBy || "overlay-preview";
    els.desktopGeneratedPrompt.dataset.promptLength = String(text.length);
  }
  scheduleDesktopPromptStateSync();
  updateDesktopFusionControls();
  return true;
}

function prepareMascotOverlayGenerateInput(payload = {}) {
  const text = getMascotOverlayPromptText(payload);
  const promptKind = String(payload.promptKind || "").toLowerCase();
  if (text !== null && promptKind === "generated" && text.trim()) {
    if (els.desktopDraftInput) els.desktopDraftInput.value = text;
    if (els.desktopGeneratedPrompt) {
      els.desktopGeneratedPrompt.value = "";
      delete els.desktopGeneratedPrompt.dataset.generatedBy;
      delete els.desktopGeneratedPrompt.dataset.promptLength;
    }
    scheduleDesktopPromptStateSync();
    updateDesktopFusionControls();
    return true;
  }
  return applyMascotOverlayPromptText(payload);
}

function withDesktopPromptOverlayMeta(payload) {
  if (!payload) return payload;
  return {
    ...payload,
    ...getDesktopPromptOverlayMeta()
  };
}

function sanitizeDesktopOverlayTracePayload(value, depth = 0) {
  if (depth > 4) return null;
  if (value === null || value === undefined) return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") return value.slice(0, 96);
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => sanitizeDesktopOverlayTracePayload(item, depth + 1));
  }
  if (typeof value !== "object") return String(value).slice(0, 32);
  const blockedKeys = new Set([
    "text",
    "prompt",
    "draft",
    "promptText",
    "windowTitle",
    "title",
    "name",
    "value",
    "clipboard"
  ]);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !blockedKeys.has(key))
    .map(([key, item]) => [key, sanitizeDesktopOverlayTracePayload(item, depth + 1)]));
}

function traceDesktopOverlayRuntime(event, payload = {}) {
  if (!window.__TAURI__?.core?.invoke) return;
  const safePayload = sanitizeDesktopOverlayTracePayload(payload);
  window.__TAURI__.core.invoke("trace_runtime_event", {
    event: String(event || "event").slice(0, 80),
    payload: safePayload
  }).catch((error) => warnAsyncFailure("trace-runtime-event", error));
}

function getErrorTraceMeta(error) {
  const message = String(error?.message || error || "");
  return {
    messageLength: message.length,
    messageHash: hashText(message)
  };
}

function warnAsyncFailure(scope, error) {
  if (!window?.console || typeof window.console.warn !== "function") return;
  window.console.warn(`[smart-prompt] ${scope} failed`, getErrorTraceMeta(error));
}

function getDesktopOverlaySnapshotTraceMeta(snapshot = desktopSnapshotState) {
  const readiness = getDesktopSnapshotReadiness(snapshot);
  const candidates = Array.isArray(snapshot?.candidates) ? snapshot.candidates : [];
  const visualAnchorCount = candidates.filter((candidate) =>
    isDesktopOverlayVisualAnchorCandidate(candidate, readiness.profile)
  ).length;
  return {
    pass: Boolean(snapshot?.pass),
    profile: readiness.profile,
    candidateCount: readiness.candidateCount,
    safeCandidateCount: readiness.safeCandidateCount,
    bestCandidateIndex: readiness.bestCandidateIndex,
    exposedCandidateCount: candidates.length,
    browserLikeComposerCandidateCount: readiness.browserLikeComposerCandidateCount,
    visualAnchorCount,
    readinessReason: readiness.readinessReason,
    foregroundWindowHidden: readiness.foregroundWindowHidden,
    overlayEligible: readiness.overlayEligible,
    overlayReady: readiness.overlayReady,
    titleHashPresent: Boolean(readiness.titleHash)
  };
}

function buildDesktopOverlayPayload(snapshot = desktopSnapshotState, state = "suggesting", overlayMode = "compact") {
  const readiness = getDesktopSnapshotReadiness(snapshot);
  const safeCandidate = readiness.overlayReady ? getDesktopOverlayCandidate(snapshot, readiness) : null;
  const visualOnly = !safeCandidate && readiness.overlayEligible && readiness.readinessReason === "no-safe-candidate";
  const candidate = safeCandidate || (visualOnly ? getDesktopOverlayVisualAnchor(snapshot, readiness.profile) : null);
  const placement = getDesktopOverlayPlacement(candidate);
  if (!placement) return null;
  const visualAnchor = getDesktopOverlayVisualAnchorMeta(candidate, visualOnly);
  return withDesktopPromptOverlayMeta({
    ...placement,
    profile: readiness.profile,
    state,
    overlayMode,
    titleHash: readiness.titleHash,
    candidateIndex: safeCandidate ? readiness.bestCandidateIndex : -1,
    noAutoSubmit: true,
    visualOnly,
    visualAnchor,
    visualAnchorIndex: visualAnchor.index,
    visualAnchorReason: visualAnchor.reason,
    candidateCount: readiness.candidateCount,
    safeCandidateCount: readiness.safeCandidateCount,
    browserLikeComposerCandidateCount: readiness.browserLikeComposerCandidateCount,
    readinessReason: readiness.readinessReason,
    overlayReadinessReason: readiness.overlayReadinessReason,
    overlayReady: readiness.overlayReady
  });
}

async function invokeDesktopOverlay(command, payload = null) {
  if (!window.__TAURI__?.core?.invoke) return false;
  try {
    if (payload) await window.__TAURI__.core.invoke(command, { payload });
    else await window.__TAURI__.core.invoke(command);
    return true;
  } catch (error) {
    warnAsyncFailure("desktop-overlay-invoke", error);
    return false;
  }
}

async function hideDesktopMascotOverlay() {
  if (desktopOverlayState.collapseTimer) {
    clearTimeout(desktopOverlayState.collapseTimer);
    desktopOverlayState.collapseTimer = null;
  }
  desktopOverlayState.visible = false;
  desktopOverlayState.lastPayload = null;
  desktopOverlayState.lastReadyAt = 0;
  traceDesktopOverlayRuntime("overlay-hide-requested", {});
  await invokeDesktopOverlay("hide_mascot_overlay");
}

function isVerifiedCodexFill(fill = {}, readiness = getDesktopSnapshotReadiness()) {
  const summary = fill.summary || {};
  const target = fill.target || {};
  const foreground = fill.foreground || {};
  return Boolean(
    readiness?.profile === "codex"
      && fill.pass === true
      && fill.writeAttempted === true
      && fill.verified === true
      && foreground.detectedToolProfile === "codex"
      && foreground.expectedTitleHashMatched === true
      && foreground.expectedToolProfileMatched === true
      && Number(target.index) === Number(readiness.bestCandidateIndex)
      && Number(summary.requestedTextLength || 0) > 0
      && Number(summary.requestedTextLength) === Number(summary.verifiedTextLength)
      && Boolean(summary.requestedTextHash)
      && summary.requestedTextHash === summary.verifiedTextHash
      && summary.autoSubmit === false
      && Number(summary.submitSignalCount || 0) === 0
      && (!fill.clipboardFallbackTried || fill.clipboardRestored === true)
  );
}

async function getCodexActivationStatus() {
  try {
    const response = await serviceRequest("/activation/codex/status", { method: "GET" });
    return response.activation || null;
  } catch (error) {
    warnAsyncFailure("codex-activation-status", error);
    return null;
  }
}

async function beginCodexActivationLoop() {
  const status = await getCodexActivationStatus();
  if (!status || status.progress === "activated" || status.progress === "awaiting_codex_loop") return status;
  if (status.progress !== "model_ready") return status;
  try {
    const response = await serviceRequest("/activation/codex/loop-start", {
      method: "POST",
      body: JSON.stringify({ contractVersion: "codex-activation@2" })
    });
    return response.activation || status;
  } catch (error) {
    warnAsyncFailure("codex-activation-loop-start", error);
    return status;
  }
}

async function completeCodexActivation(transactionId) {
  if (!transactionId) return null;
  try {
    const response = await serviceRequest("/activation/codex/complete", {
      method: "POST",
      body: JSON.stringify({
        contractVersion: "codex-activation@2",
        transactionId
      })
    });
    return response.activation || null;
  } catch (error) {
    warnAsyncFailure("codex-activation-complete", error);
    return null;
  }
}

function showVerifiedDesktopFill(transactionId, pendingOutcome = null, activation = null) {
  if (!desktopOverlayState.visible || !desktopOverlayState.lastPayload) return;
  if (desktopOverlayState.collapseTimer) clearTimeout(desktopOverlayState.collapseTimer);
  const successPayload = withDesktopPromptOverlayMeta({
    ...desktopOverlayState.lastPayload,
    state: "success",
    overlayMode: "expanded",
    fillVerified: true,
    verified: true,
    verification: "machine",
    noAutoSubmit: true,
    canUndo: Boolean(codexTargetState.undoToken),
    collapseRequested: true,
    transactionId,
    pendingOutcome,
    activationProgress: activation?.progress || ""
  });
  desktopOverlayState.lastPayload = successPayload;
  invokeDesktopOverlay("set_mascot_overlay_state", successPayload);
  desktopOverlayState.collapseTimer = setTimeout(() => {
    desktopOverlayState.collapseTimer = null;
    if (!desktopOverlayState.visible || desktopOverlayState.lastPayload?.transactionId !== transactionId) return;
    const compactPayload = withDesktopPromptOverlayMeta({
      ...desktopOverlayState.lastPayload,
      overlayMode: "compact",
      collapseRequested: false
    });
    desktopOverlayState.lastPayload = compactPayload;
    invokeDesktopOverlay("set_mascot_overlay_state", compactPayload);
  }, DESKTOP_OVERLAY_SUCCESS_FEEDBACK_MS);
}

async function keepDesktopMascotOverlayDuringTransientMiss(state = "resting") {
  if (!desktopOverlayState.visible || !desktopOverlayState.lastPayload || !desktopOverlayState.lastReadyAt) return false;
  if (Date.now() - desktopOverlayState.lastReadyAt > DESKTOP_OVERLAY_STICKY_MS) return false;
  const payload = {
    ...desktopOverlayState.lastPayload,
    state
  };
  const nextPayload = withDesktopPromptOverlayMeta(payload);
  desktopOverlayState.lastPayload = nextPayload;
  return invokeDesktopOverlay("set_mascot_overlay_state", nextPayload);
}

function canKeepDesktopOverlayDuringTransientMiss(readiness) {
  if (!readiness?.overlayEligible) return false;
  if (readiness.readinessReason !== "missing-summary") return false;
  const lastPayload = desktopOverlayState.lastPayload || {};
  if (!desktopOverlayState.visible || !lastPayload.profile) return false;
  if (String(lastPayload.profile || "") !== readiness.profile) return false;
  if (readiness.titleHash && lastPayload.titleHash && String(lastPayload.titleHash) !== readiness.titleHash) return false;
  return Boolean(readiness.titleHash || lastPayload.titleHash);
}

function isDesktopSnapshotAllowedByFastForeground(readiness) {
  const state = desktopOverlayState.fastState;
  if (!state) return true;
  if (!isFastForegroundSupported(state)) return !readiness?.overlayEligible;
  if (!readiness?.overlayEligible) return true;
  return String(state.detectedToolProfile || "unknown") === String(readiness.profile || "unknown");
}

function getDesktopOverlayRefreshMode(requestedMode = "") {
  if (requestedMode === "expanded" || requestedMode === "compact") return requestedMode;
  return desktopOverlayState.visible
    && desktopOverlayState.lastPayload?.overlayMode === "expanded"
    ? "expanded"
    : "compact";
}

async function syncDesktopMascotOverlay(snapshot = desktopSnapshotState, state = "suggesting", overlayMode = "compact") {
  const readiness = getDesktopSnapshotReadiness(snapshot);
  if (!isDesktopSnapshotAllowedByFastForeground(readiness)) {
    traceDesktopOverlayRuntime("overlay-stale-snapshot-hidden", {
      ...getDesktopOverlaySnapshotTraceMeta(snapshot),
      fastProfile: String(desktopOverlayState.fastState?.detectedToolProfile || "unknown"),
      fastUsable: Boolean(desktopOverlayState.fastState?.isUsable),
      fastSupported: Boolean(desktopOverlayState.fastState?.overlaySupportedProfile)
    });
    await hideDesktopMascotOverlay();
    return false;
  }
  if (readiness.ready && !readiness.overlayEligible) {
    await hideDesktopMascotOverlay();
    return false;
  }
  const payload = buildDesktopOverlayPayload(snapshot, state, overlayMode);
  if (!payload) {
    traceDesktopOverlayRuntime("overlay-payload-missing", {
      ...getDesktopOverlaySnapshotTraceMeta(snapshot),
      state,
      overlayMode
    });
    if (canKeepDesktopOverlayDuringTransientMiss(readiness)
      && await keepDesktopMascotOverlayDuringTransientMiss("resting")) return true;
    await hideDesktopMascotOverlay();
    return false;
  }
  traceDesktopOverlayRuntime("overlay-payload-built", {
    profile: payload.profile,
    state: payload.state,
    overlayMode: payload.overlayMode,
    visualOnly: payload.visualOnly,
    candidateIndex: payload.candidateIndex,
    visualAnchorIndex: payload.visualAnchorIndex,
    visualAnchorReason: payload.visualAnchorReason,
    candidateCount: payload.candidateCount,
    safeCandidateCount: payload.safeCandidateCount,
    browserLikeComposerCandidateCount: payload.browserLikeComposerCandidateCount,
    x: Math.round(Number(payload.x || 0)),
    y: Math.round(Number(payload.y || 0)),
    compactX: Math.round(Number(payload.compactX || 0)),
    compactY: Math.round(Number(payload.compactY || 0)),
    promptReady: payload.promptReady,
    promptKind: payload.promptKind,
    promptTextLength: payload.promptTextLength,
    promptTextHashPresent: Boolean(payload.promptTextHash)
  });
  desktopOverlayState.visible = true;
  desktopOverlayState.lastPayload = payload;
  desktopOverlayState.lastReadyAt = Date.now();
  const shown = await invokeDesktopOverlay("show_mascot_overlay", payload);
  traceDesktopOverlayRuntime("overlay-show-result", {
    shown,
    visualOnly: payload.visualOnly,
    candidateIndex: payload.candidateIndex,
    visualAnchorIndex: payload.visualAnchorIndex,
    visualAnchorReason: payload.visualAnchorReason,
    overlayMode: payload.overlayMode
  });
  return shown;
}

function updateDesktopMascotOverlayState(state) {
  if (!desktopOverlayState.visible || !desktopOverlayState.lastPayload) return;
  const payload = {
    ...desktopOverlayState.lastPayload,
    state
  };
  const nextPayload = withDesktopPromptOverlayMeta(payload);
  desktopOverlayState.lastPayload = nextPayload;
  invokeDesktopOverlay("set_mascot_overlay_state", nextPayload);
}

function showDesktopMascotOverlayGuard(reason = "payload_guard") {
  if (!desktopOverlayState.visible || !desktopOverlayState.lastPayload) {
    hideDesktopMascotOverlay().catch((error) => warnAsyncFailure("overlay-guard-hide-missing-payload", error));
    return;
  }
  const payload = withDesktopPromptOverlayMeta({
    ...desktopOverlayState.lastPayload,
    state: "resting",
    overlayMode: "expanded",
    guardReason: reason,
    noAutoSubmit: true
  });
  desktopOverlayState.lastPayload = payload;
  invokeDesktopOverlay("set_mascot_overlay_state", payload);
  setTimeout(() => {
    hideDesktopMascotOverlay().catch((error) => warnAsyncFailure("overlay-guard-hide-timeout", error));
  }, DESKTOP_OVERLAY_GUARD_FEEDBACK_MS);
}

function updateDesktopFusionControls() {
  const readiness = getDesktopSnapshotReadiness();
  const draft = els.desktopDraftInput?.value?.trim() || "";
  const prompt = els.desktopGeneratedPrompt?.value?.trim() || "";
  if (els.generateDesktopPrompt) els.generateDesktopPrompt.disabled = !draft;
  if (els.fillForegroundInput) els.fillForegroundInput.disabled = !readiness.ready || !(prompt || draft);
  if (desktopOverlayState.visible && desktopOverlayState.lastPayload) {
    updateDesktopMascotOverlayState(desktopOverlayState.lastPayload.state || "suggesting");
  }
  renderDesktopPromptHandoff();
}

function buildDesktopPromptStatePayload() {
  const readiness = getDesktopSnapshotReadiness();
  return {
    source: "desktop-shell",
    draft: els.desktopDraftInput?.value || "",
    prompt: els.desktopGeneratedPrompt?.value || "",
    generatedBy: els.desktopGeneratedPrompt?.dataset?.generatedBy || "",
    noAutoSubmit: true,
    promptMode: desktopPromptMode,
    readiness: {
      profile: readiness.profile,
      titleHash: readiness.titleHash,
      candidateIndex: readiness.bestCandidateIndex,
      browserLikeComposerCandidateCount: readiness.browserLikeComposerCandidateCount,
      ready: readiness.ready,
      overlayReady: readiness.overlayReady,
      readinessReason: readiness.readinessReason,
      overlayReadinessReason: readiness.overlayReadinessReason
    }
  };
}

function desktopPromptPayloadHasText(payload = {}) {
  return Boolean(String(payload.draft || "").trim() || String(payload.prompt || "").trim());
}

async function shouldPreserveExternalDesktopPromptState(payload = {}) {
  if (desktopPromptPayloadHasText(payload)) return false;
  try {
    const state = await serviceRequest("/desktop/prompt-state", { method: "GET" });
    const promptState = state?.desktopPrompt;
    return Boolean(
      promptState
        && promptState.source !== "desktop-shell"
        && promptState.prepared
        && Number(promptState.activeTextLength || 0) > 0
    );
  } catch (error) {
    warnAsyncFailure("desktop-prompt-state-preserve", error);
    return false;
  }
}

async function syncDesktopPromptState(options = {}) {
  if (desktopPromptStateSync.inFlight) {
    if (!options.force) return;
    for (let attempt = 0; attempt < 8 && desktopPromptStateSync.inFlight; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (desktopPromptStateSync.inFlight) return;
  }
  desktopPromptStateSync.inFlight = true;
  try {
    const payload = buildDesktopPromptStatePayload();
    if (await shouldPreserveExternalDesktopPromptState(payload)) return;
    await serviceRequest("/desktop/prompt-state", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  } catch (error) {
    if (!options.silent) setStatus(error.message, false);
  } finally {
    desktopPromptStateSync.inFlight = false;
  }
}

function scheduleDesktopPromptStateSync() {
  if (desktopPromptStateSync.timer) clearTimeout(desktopPromptStateSync.timer);
  desktopPromptStateSync.timer = setTimeout(() => {
    syncDesktopPromptState({ silent: true }).catch((error) => warnAsyncFailure("desktop-prompt-state-sync", error));
  }, DESKTOP_PROMPT_STATE_SYNC_MS);
}

function renderDesktopPromptHandoff(mode = "") {
  if (!els.desktopPromptHandoff) return;
  const promptMeta = getDesktopPromptOverlayMeta();
  const readiness = getDesktopSnapshotReadiness();
  const missingFromOverlay = els.desktopFusionEvidence?.dataset?.overlayClickPrompt === "missing";
  let handoffState = "idle";
  let messageKey = "desktopPromptHandoffIdle";
  let action = "add-prompt";
  if (promptMeta.promptReady) {
    if (readiness.overlayReady) {
      handoffState = "ready";
      messageKey = "desktopPromptHandoffClickMascot";
      action = "click-mascot";
    } else if (readiness.overlayEligible) {
      handoffState = "focus-target";
      messageKey = "desktopPromptHandoffFocusInput";
      action = "focus-input";
    } else {
      handoffState = "guarded";
      messageKey = "desktopPromptHandoffGuarded";
      action = "guarded";
    }
  } else if (mode === "needs-draft" || missingFromOverlay) {
    handoffState = "needs-draft";
    messageKey = "desktopPromptHandoffNeedsDraft";
    action = "add-prompt";
  } else if (!readiness.ready && readiness.overlayEligible) {
    handoffState = "idle";
    messageKey = "desktopPromptHandoffIdle";
    action = "add-prompt";
  }
  els.desktopPromptHandoff.textContent = t(messageKey);
  els.desktopPromptHandoff.dataset.handoffState = handoffState;
  els.desktopPromptHandoff.dataset.handoffAction = action;
  els.desktopPromptHandoff.dataset.promptReady = String(promptMeta.promptReady);
  els.desktopPromptHandoff.dataset.promptKind = promptMeta.promptKind;
  els.desktopPromptHandoff.dataset.promptMode = promptMeta.promptMode;
  els.desktopPromptHandoff.dataset.detectedToolProfile = readiness.profile;
  els.desktopPromptHandoff.dataset.safeCandidateCount = String(readiness.safeCandidateCount);
  els.desktopPromptHandoff.dataset.browserLikeComposerCandidateCount = String(readiness.browserLikeComposerCandidateCount);
  els.desktopPromptHandoff.dataset.overlayReady = String(readiness.overlayReady);
  els.desktopPromptHandoff.dataset.readinessReason = readiness.readinessReason;
  els.desktopPromptHandoff.dataset.overlayReadinessReason = readiness.overlayReadinessReason;
  els.desktopPromptHandoff.dataset.noAutoSubmit = "true";
}

function renderDesktopFusionSurface(snapshot = desktopSnapshotState) {
  if (!els.desktopInputSurface || !els.desktopFusionEvidence) return;
  const readiness = getDesktopSnapshotReadiness(snapshot);
  if (!snapshot?.summary) {
    els.desktopInputSurface.textContent = t("desktopSurfaceWaiting");
    els.desktopInputSurface.dataset.fusionReady = "";
    els.desktopInputSurface.dataset.readinessReason = readiness.readinessReason;
    els.desktopInputSurface.dataset.overlayEligible = String(readiness.overlayEligible);
    els.desktopInputSurface.dataset.overlayReady = String(readiness.overlayReady);
    els.desktopInputSurface.dataset.overlayReadinessReason = readiness.overlayReadinessReason;
    els.desktopFusionEvidence.textContent = t("desktopFusionIdle");
    els.desktopFusionEvidence.dataset.fusionState = "idle";
    els.desktopFusionEvidence.dataset.readinessReason = readiness.readinessReason;
    els.desktopFusionEvidence.dataset.overlayEligible = String(readiness.overlayEligible);
    els.desktopFusionEvidence.dataset.overlayReady = String(readiness.overlayReady);
    els.desktopFusionEvidence.dataset.overlayReadinessReason = readiness.overlayReadinessReason;
    els.desktopFusionEvidence.dataset.browserLikeComposerCandidateCount = String(readiness.browserLikeComposerCandidateCount);
    if (els.desktopFusionConsole) els.desktopFusionConsole.dataset.fusionState = "idle";
    updateDesktopFusionControls();
    return;
  }

  els.desktopInputSurface.textContent = readiness.ready
    ? t("desktopSurfaceReady", readiness)
    : t("desktopSurfaceGuarded", readiness);
  els.desktopInputSurface.dataset.fusionReady = String(readiness.ready);
  els.desktopInputSurface.dataset.detectedToolProfile = readiness.profile;
  els.desktopInputSurface.dataset.safeCandidateCount = String(readiness.safeCandidateCount);
  els.desktopInputSurface.dataset.readinessReason = readiness.readinessReason;
  els.desktopInputSurface.dataset.overlayEligible = String(readiness.overlayEligible);
  els.desktopInputSurface.dataset.overlayReady = String(readiness.overlayReady);
  els.desktopInputSurface.dataset.overlayReadinessReason = readiness.overlayReadinessReason;
  els.desktopFusionEvidence.textContent = t("desktopFusionEvidence", {
    ...readiness,
    noSubmit: true
  });
  els.desktopFusionEvidence.dataset.fusionState = readiness.ready ? "ready" : "guarded";
  els.desktopFusionEvidence.dataset.detectedToolProfile = readiness.profile;
  els.desktopFusionEvidence.dataset.candidateCount = String(readiness.candidateCount);
  els.desktopFusionEvidence.dataset.safeCandidateCount = String(readiness.safeCandidateCount);
  els.desktopFusionEvidence.dataset.browserLikeComposerCandidateCount = String(readiness.browserLikeComposerCandidateCount);
  els.desktopFusionEvidence.dataset.bestCandidateIndex = String(readiness.bestCandidateIndex);
  els.desktopFusionEvidence.dataset.noAutoSubmit = "true";
  els.desktopFusionEvidence.dataset.readinessReason = readiness.readinessReason;
  els.desktopFusionEvidence.dataset.overlayEligible = String(readiness.overlayEligible);
  els.desktopFusionEvidence.dataset.overlayReady = String(readiness.overlayReady);
  els.desktopFusionEvidence.dataset.overlayReadinessReason = readiness.overlayReadinessReason;
  if (els.desktopFusionConsole) els.desktopFusionConsole.dataset.fusionState = readiness.ready ? "ready" : "guarded";
  updateDesktopFusionControls();
  scheduleDesktopPromptStateSync();
}

function getDesktopGenerationContext() {
  const readiness = getDesktopSnapshotReadiness();
  return {
    mode: desktopPromptMode,
    tool: readiness.profile === "unknown" ? "desktop" : readiness.profile,
    adapterId: `desktop-${readiness.profile === "unknown" ? "generic" : readiness.profile}`,
    site: "local-desktop",
    inputKind: "desktop-uia",
    taskScenario: "desktop-tool-input",
    locale: currentLocale
  };
}

function renderDesktopFusionGenerated(result = {}) {
  const card = result.card || result.promptCard || {};
  const prompt = card.prompt || result.prompt || "";
  if (els.desktopGeneratedPrompt && prompt) {
    els.desktopGeneratedPrompt.value = prompt;
    els.desktopGeneratedPrompt.dataset.generatedBy = card.generatedBy || result.generatedBy || "service";
    els.desktopGeneratedPrompt.dataset.promptLength = String(prompt.length);
    if (card.generationId || result.generationId) {
      els.desktopGeneratedPrompt.dataset.generationId = card.generationId || result.generationId;
    }
  }
  if (els.desktopFusionEvidence) {
    els.desktopFusionEvidence.textContent = t("desktopFusionGenerated");
    els.desktopFusionEvidence.dataset.fusionState = "generated";
    els.desktopFusionEvidence.dataset.generatedBy = card.generatedBy || result.generatedBy || "service";
    els.desktopFusionEvidence.dataset.promptLength = String(prompt.length);
  }
  if (els.desktopFusionConsole) els.desktopFusionConsole.dataset.fusionState = "generated";
  updateDesktopFusionControls();
  scheduleDesktopPromptStateSync();
}

function renderDesktopFusionFillResult(payload = {}) {
  const fill = payload.fill || payload.desktopFill || payload;
  if (!fill?.schemaVersion || !els.desktopFusionEvidence) return;
  const summary = fill.summary || {};
  const noAutoSubmit = !summary.autoSubmit && Number(summary.submitSignalCount || 0) === 0;
  els.desktopFusionEvidence.textContent = fill.pass
    ? t("desktopFusionFilled")
    : t("desktopFusionBlocked");
  els.desktopFusionEvidence.dataset.fusionState = fill.pass ? "filled" : "blocked";
  els.desktopFusionEvidence.dataset.foregroundFill = String(Boolean(fill.confirmForeground));
  els.desktopFusionEvidence.dataset.fillPass = String(Boolean(fill.pass));
  els.desktopFusionEvidence.dataset.writeAttempted = String(Boolean(fill.writeAttempted));
  els.desktopFusionEvidence.dataset.verified = String(Boolean(fill.verified));
  els.desktopFusionEvidence.dataset.noAutoSubmit = String(noAutoSubmit);
  els.desktopFusionEvidence.dataset.strategy = fill.strategy || fill.reason || "";
  if (els.desktopFusionConsole) els.desktopFusionConsole.dataset.fusionState = fill.pass ? "filled" : "blocked";
  updateDesktopFusionControls();
}

function renderDesktopSnapshot(payload = {}) {
  const snapshot = payload.snapshot || payload.desktopInputSnapshot || payload;
  desktopSnapshotState = snapshot?.summary ? snapshot : null;
  renderDesktopSupportedProfiles(snapshot?.supportedToolProfiles || []);
  if (!snapshot?.summary) {
    els.desktopCompanionStatus.textContent = t("desktopSnapshotMissing");
    els.desktopCompanionStatus.dataset.desktopSnapshotStatus = "missing";
    els.desktopToolSummary.textContent = t("targetToolNotInspected");
    els.desktopSignalSummary.textContent = t("signalsPending");
    els.desktopGuardSummary.textContent = t("guardPending");
    renderDesktopFusionSurface(null);
    setMascotState("resting");
    return;
  }

  const foreground = snapshot.foreground || {};
  const summary = snapshot.summary || {};
  const profile = summary.detectedToolProfile || foreground.detectedToolProfile || "unknown";
  const candidateCount = Number(summary.candidateCount || snapshot.candidates?.length || 0);
  const safeCandidateCount = Number(summary.safeCandidateCount ?? candidateCount);
  const bestCandidateIndex = Number(summary.bestCandidateIndex ?? -1);
  const bestCandidateScore = Number(summary.bestCandidateScore || 0);
  const ready = Boolean(snapshot.pass && profile !== "unknown" && candidateCount > 0 && safeCandidateCount > 0 && bestCandidateIndex >= 0);
  const status = ready ? "ready" : profile !== "unknown" ? "guarded" : "observing";

  els.desktopCompanionStatus.textContent = t("desktopSnapshotStatus", { status, profile, candidateCount, bestCandidateIndex, bestCandidateScore });
  els.desktopCompanionStatus.dataset.desktopSnapshotStatus = status;
  els.desktopCompanionStatus.dataset.detectedToolProfile = profile;
  els.desktopCompanionStatus.dataset.candidateCount = String(candidateCount);
  els.desktopCompanionStatus.dataset.safeCandidateCount = String(safeCandidateCount);
  els.desktopCompanionStatus.dataset.bestCandidateIndex = String(bestCandidateIndex);
  els.desktopCompanionStatus.dataset.bestCandidateScore = String(bestCandidateScore);

  els.desktopToolSummary.innerHTML = renderInlineStats([
    [t("tool"), profile],
    [t("titleHash"), foreground.titleHash || "n/a"],
    [t("process"), foreground.processName || "n/a"]
  ]);
  els.desktopSignalSummary.innerHTML = renderInlineStats([
    [t("candidates"), candidateCount],
    ["safe", safeCandidateCount],
    [t("focused"), Number(summary.focusedCandidateCount || 0)],
    [t("caret"), Number(summary.caretCandidateCount || 0)]
  ]);
  els.desktopGuardSummary.innerHTML = renderInlineStats([
    [t("guard"), ready ? "hash + profile" : t("pending")],
    [t("bestIndex"), bestCandidateIndex],
    [t("noSubmit"), "true"]
  ]);
  renderDesktopFusionSurface(snapshot);
  setMascotState(ready ? "suggesting" : profile !== "unknown" ? "thinking" : "resting");
}

function renderDesktopFillResult(payload = {}) {
  const fill = payload.fill || payload.desktopFill || payload;
  if (!fill?.schemaVersion) {
    els.desktopFillResult.textContent = t("fillTestNotRun");
    els.desktopFillResult.dataset.fillPass = "false";
    return;
  }
  const summary = fill.summary || {};
  els.desktopFillResult.textContent = t("fillDetail", {
    pass: Boolean(fill.pass),
    write: Boolean(fill.writeAttempted),
    verified: Boolean(fill.verified),
    strategy: fill.strategy || fill.reason || "n/a",
    autoSubmit: Boolean(summary.autoSubmit)
  });
  els.desktopFillResult.dataset.fillPass = String(Boolean(fill.pass));
  els.desktopFillResult.dataset.writeAttempted = String(Boolean(fill.writeAttempted));
  els.desktopFillResult.dataset.noAutoSubmit = String(!summary.autoSubmit && Number(summary.submitSignalCount || 0) === 0);
  renderDesktopFusionFillResult(fill);
  setMascotState(fill.pass ? "success" : "resting");
}

function renderLearningRows(items, emptyText, kind) {
  if (!items?.length) {
    return `<div class="skill-row">${escapeHtml(emptyText)}</div>`;
  }
  return items.slice(0, 6).map((item) => {
    const title = kind === "candidate"
      ? `${item.action || "action"} / ${item.status || "review"}`
      : `${item.type || "reflection"} / ${item.source || "source"}`;
    const detail = kind === "candidate"
      ? [
        `priority ${item.priority || "medium"}`,
        item.strategyId ? `strategy ${item.strategyId}` : "",
        item.reasonToken ? `reason ${item.reasonToken}` : "",
        t("manualReview")
      ].filter(Boolean).join(" | ")
      : [
        `severity ${item.severity || "medium"}`,
        item.strategyId ? `strategy ${item.strategyId}` : "",
        item.reasonToken ? `reason ${item.reasonToken}` : "",
        item.nextAction || "Review aggregate evidence."
      ].filter(Boolean).join(" | ");
    return `<div class="skill-row outcome-row" data-learning-${kind}="${escapeHtml(item.id || title)}"><strong>${escapeHtml(title)}</strong><br>${escapeHtml(detail)}</div>`;
  }).join("");
}

function renderLearningDashboard(reflectionPayload = {}, candidatePayload = {}) {
  const selfImprovementReport = reflectionPayload.selfImprovementReport
    || reflectionPayload.diagnostics?.selfImprovementReport
    || reflectionPayload.report;
  const evolutionCandidateReport = candidatePayload.evolutionCandidateReport
    || reflectionPayload.evolutionCandidateReport
    || candidatePayload.diagnostics?.evolutionCandidateReport
    || candidatePayload.report;

  if (!selfImprovementReport?.readiness && !evolutionCandidateReport?.readiness) {
    els.learningStatus.textContent = t("learningMissing");
    els.learningStatus.dataset.learningStatus = "missing";
    els.selfImprovementSummary.innerHTML = `<div class="skill-row">${escapeHtml(t("noReflections"))}</div>`;
    els.evolutionCandidateSummary.innerHTML = `<div class="skill-row">${escapeHtml(t("noEvolutionCandidates"))}</div>`;
    return;
  }

  const readiness = selfImprovementReport?.readiness || {};
  const candidateReadiness = evolutionCandidateReport?.readiness || {};
  els.learningStatus.textContent = t("learningStatusDetail", {
    status: readiness.status || candidateReadiness.status || "collecting",
    reflections: readiness.reflectionCount || 0,
    candidates: candidateReadiness.candidateCount || 0,
    promotionMode: evolutionCandidateReport?.promotionMode || "manual_review_required"
  });
  els.learningStatus.dataset.learningStatus = readiness.status || candidateReadiness.status || "collecting";
  els.learningStatus.dataset.reflectionCount = String(readiness.reflectionCount || 0);
  els.learningStatus.dataset.candidateCount = String(candidateReadiness.candidateCount || 0);
  els.learningStatus.dataset.mutationAllowed = String(Boolean(evolutionCandidateReport?.mutationAllowed));
  els.learningStatus.dataset.requiresCritic = String(Boolean(evolutionCandidateReport?.requiresCritic));
  els.selfImprovementSummary.innerHTML = renderLearningRows(selfImprovementReport?.reflections || [], t("noReflections"), "reflection");
  els.evolutionCandidateSummary.innerHTML = renderLearningRows(evolutionCandidateReport?.candidates || [], t("noEvolutionCandidates"), "candidate");
}

function formatPercent(value) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "n/a";
}

function formatScore(value) {
  return typeof value === "number" ? value.toFixed(2) : "n/a";
}

function formatSignedPercent(value) {
  if (typeof value !== "number") return "n/a";
  const rounded = Math.round(value * 100);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function formatSignedScore(value) {
  if (typeof value !== "number") return "n/a";
  const formatted = value.toFixed(2);
  return `${value > 0 ? "+" : ""}${formatted}`;
}

function renderPilotOutcomeRows(items, emptyText, type) {
  if (!items?.length) {
    return `<div class="skill-row">${escapeHtml(emptyText)}</div>`;
  }
  return items.slice(0, 6).map((item) => {
    const label = `${item.dimension || type}: ${item.key || "unknown"}`;
    const detail = [
      `${item.status || "unknown"}`,
      `${item.outcomeCount || 0}/${item.minOutcomeEvents || 3}`,
      `success ${formatPercent(item.outcomeSuccessRate)}`,
      `score ${formatScore(item.avgOutcomeScore)}`
    ].join(" · ");
    return `<div class="skill-row outcome-row" data-outcome-${type}="${escapeHtml(item.key || "unknown")}"><strong>${escapeHtml(label)}</strong><br>${escapeHtml(detail)}</div>`;
  }).join("");
}

function renderPilotOutcomeDashboard(payload = {}) {
  const report = payload.pilotOutcomeReadinessReport || payload.pilotOutcomeReadiness || payload.report || payload.diagnostics?.pilotOutcomeReadinessReport;
  if (!report?.readiness) {
    els.pilotOutcomeStatus.textContent = t("noPilotOutcome");
    els.pilotOutcomeStatus.dataset.pilotOutcomeStatus = "missing";
    els.pilotOutcomeSummary.innerHTML = "";
    els.pilotOutcomeStrategies.innerHTML = `<div class="skill-row">${escapeHtml(t("noStrategyOutcomes"))}</div>`;
    els.pilotOutcomeTargets.innerHTML = `<div class="skill-row">${escapeHtml(t("noCollectionTargets"))}</div>`;
    return;
  }

  const readiness = report.readiness;
  const status = readiness.status || "unknown";
  els.pilotOutcomeStatus.textContent = `${status}; ${readiness.totalOutcomeEvents || 0} outcomes; ${readiness.readyTaskScenarioCohorts || 0} ready, ${readiness.collectingTaskScenarioCohorts || 0} collecting, ${readiness.emptyTaskScenarioCohorts || 0} empty`;
  els.pilotOutcomeStatus.dataset.pilotOutcomeStatus = status;
  els.pilotOutcomeStatus.dataset.totalOutcomeEvents = String(readiness.totalOutcomeEvents || 0);
  els.pilotOutcomeStatus.dataset.readyTaskScenarioCohorts = String(readiness.readyTaskScenarioCohorts || 0);
  els.pilotOutcomeStatus.dataset.collectingTaskScenarioCohorts = String(readiness.collectingTaskScenarioCohorts || 0);
  els.pilotOutcomeStatus.dataset.emptyTaskScenarioCohorts = String(readiness.emptyTaskScenarioCohorts || 0);

  const summaryItems = [
    ["Status", status],
    ["Outcomes", readiness.totalOutcomeEvents || 0],
    [t("success"), formatPercent(readiness.outcomeSuccessRate)],
    ["Avg score", formatScore(readiness.avgOutcomeScore)]
  ];
  els.pilotOutcomeSummary.innerHTML = summaryItems.map(([label, value]) => {
    return `<div class="outcome-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }).join("");

  const strategyRows = [
    ...(report.winningStrategies || []).map((item) => ({ ...item, dimension: "winner" })),
    ...(report.riskStrategies || []).map((item) => ({ ...item, dimension: "risk" }))
  ];
  els.pilotOutcomeStrategies.innerHTML = renderPilotOutcomeRows(strategyRows, t("noStrategyOutcomes"), "strategy");
  els.pilotOutcomeTargets.innerHTML = renderPilotOutcomeRows(report.collectionTargets || [], t("noCollectionTargets"), "target");
  els.pilotOutcomeTargets.dataset.targetCount = String(report.collectionTargets?.length || 0);
}

function renderQualityLiftCohortRows(items) {
  if (!items?.length) {
    return `<div class="skill-row">${escapeHtml(t("noQualityCohorts"))}</div>`;
  }
  return items.slice(0, 3).map((item) => {
    const detail = [
      `${item.status || "unknown"}`,
      `outcomes ${item.outcomeCount || 0}/${item.minOutcomeEvents || 3}`,
      `success ${formatPercent(item.outcomeSuccessRate)}`,
      `score ${formatScore(item.avgOutcomeScore)}`,
      `retry ${formatPercent(item.retryUsageRate)}`,
      `undo ${formatPercent(item.undoUsageRate)}`
    ].join(" | ");
    return `<div class="skill-row outcome-row" data-quality-lift-cohort="${escapeHtml(item.cohort || "unknown")}"><strong>${escapeHtml(item.cohort || "unknown")}</strong><br>${escapeHtml(detail)}</div>`;
  }).join("");
}

function renderQualityLiftComparisonRows(items) {
  if (!items?.length) {
    return `<div class="skill-row">${escapeHtml(t("noQualityComparisons"))}</div>`;
  }
  return items.slice(0, 2).map((item) => {
    const deltas = item.deltas || {};
    const detail = [
      `${item.status || "unknown"}`,
      `${item.decision || "collecting"}`,
      `success ${formatSignedPercent(deltas.outcomeSuccessRateLift)}`,
      `score ${formatSignedScore(deltas.avgOutcomeScoreLift)}`,
      `insert ${formatSignedPercent(deltas.insertSuccessRateLift)}`,
      `save ${formatSignedPercent(deltas.saveRateLift)}`,
      `retry ${formatSignedPercent(deltas.retryUsageRateLift)}`,
      `undo ${formatSignedPercent(deltas.undoUsageRateLift)}`
    ].join(" | ");
    return `<div class="skill-row outcome-row" data-quality-lift-comparison="${escapeHtml(item.name || "unknown")}"><strong>${escapeHtml(item.name || "unknown")}</strong><br>${escapeHtml(detail)}</div>`;
  }).join("");
}

function renderQualityLiftRecommendationRows(items) {
  if (!items?.length) {
    return `<div class="skill-row">${escapeHtml(t("noQualityRecommendations"))}</div>`;
  }
  return items.slice(0, 5).map((item) => {
    const detail = `[${item.priority || "medium"}] ${item.recommendation || item.key || "Review quality lift samples."}`;
    return `<div class="skill-row outcome-row" data-quality-lift-recommendation="${escapeHtml(item.key || "unknown")}"><strong>${escapeHtml(item.key || "recommendation")}</strong><br>${escapeHtml(detail)}</div>`;
  }).join("");
}

function renderQualityLiftDashboard(payload = {}) {
  const report = payload.promptQualityLiftReport || payload.promptQualityLift || payload.report || payload.diagnostics?.promptQualityLiftReport;
  if (!report?.readiness) {
    els.qualityLiftStatus.textContent = t("noQualityLift");
    els.qualityLiftStatus.dataset.qualityLiftStatus = "missing";
    els.qualityLiftSummary.innerHTML = "";
    els.qualityLiftCohorts.innerHTML = `<div class="skill-row">${escapeHtml(t("noQualityCohorts"))}</div>`;
    els.qualityLiftComparisons.innerHTML = `<div class="skill-row">${escapeHtml(t("noQualityComparisons"))}</div>`;
    els.qualityLiftRecommendations.innerHTML = `<div class="skill-row">${escapeHtml(t("noQualityRecommendations"))}</div>`;
    return;
  }

  const readiness = report.readiness;
  const status = readiness.status || "unknown";
  const primary = (report.comparisons || []).find((item) => item.name === "outcome_weighted_vs_baseline")
    || (report.comparisons || [])[0]
    || {};
  const deltas = primary.deltas || {};
  const decision = readiness.primaryDecision || primary.decision || "collecting";

  els.qualityLiftStatus.textContent = `${status}; ${readiness.eventCount || 0} events; decision ${decision}; baseline ${readiness.baselineOutcomeCount || 0}, guided ${readiness.strategyGuidedOutcomeCount || 0}, weighted ${readiness.outcomeWeightedOutcomeCount || 0}`;
  els.qualityLiftStatus.dataset.qualityLiftStatus = status;
  els.qualityLiftStatus.dataset.primaryDecision = decision;
  els.qualityLiftStatus.dataset.eventCount = String(readiness.eventCount || 0);
  els.qualityLiftStatus.dataset.comparable = String(Boolean(readiness.comparable));
  els.qualityLiftStatus.dataset.baselineOutcomeCount = String(readiness.baselineOutcomeCount || 0);
  els.qualityLiftStatus.dataset.strategyGuidedOutcomeCount = String(readiness.strategyGuidedOutcomeCount || 0);
  els.qualityLiftStatus.dataset.outcomeWeightedOutcomeCount = String(readiness.outcomeWeightedOutcomeCount || 0);

  const summaryItems = [
    ["Decision", decision],
    ["Weighted outcomes", `${readiness.outcomeWeightedOutcomeCount || 0}/${readiness.minOutcomeEvents || 3}`],
    ["Success lift", formatSignedPercent(deltas.outcomeSuccessRateLift)],
    ["Score lift", formatSignedScore(deltas.avgOutcomeScoreLift)]
  ];
  els.qualityLiftSummary.innerHTML = summaryItems.map(([label, value]) => {
    return `<div class="outcome-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }).join("");

  els.qualityLiftCohorts.innerHTML = renderQualityLiftCohortRows(report.cohorts || []);
  els.qualityLiftCohorts.dataset.cohortCount = String(report.cohorts?.length || 0);
  els.qualityLiftComparisons.innerHTML = renderQualityLiftComparisonRows(report.comparisons || []);
  els.qualityLiftComparisons.dataset.comparisonCount = String(report.comparisons?.length || 0);
  els.qualityLiftComparisons.dataset.primaryDecision = decision;
  els.qualityLiftRecommendations.innerHTML = renderQualityLiftRecommendationRows(report.recommendations || []);
  els.qualityLiftRecommendations.dataset.recommendationCount = String(report.recommendations?.length || 0);
}

function renderQualityLiftSegmentRows(items, emptyText, kind) {
  if (!items?.length) {
    return `<div class="skill-row">${escapeHtml(emptyText)}</div>`;
  }
  return items.slice(0, 6).map((item) => {
    const title = `${item.dimension || "segment"} / ${item.key || "unknown"}`;
    const detail = [
      item.readinessStatus || "unknown",
      item.primaryDecision || "collecting",
      `success ${formatSignedPercent(item.successLift)}`,
      `score ${formatSignedScore(item.avgOutcomeScoreLift)}`,
      `retry ${formatSignedPercent(item.retryUsageRateLift)}`,
      `undo ${formatSignedPercent(item.undoUsageRateLift)}`,
      `weighted ${item.outcomeWeightedOutcomeCount || 0}/${item.minOutcomeEvents || 3}`
    ].join(" | ");
    return `<div class="skill-row outcome-row" data-quality-lift-segment-kind="${escapeHtml(kind)}" data-quality-lift-segment="${escapeHtml(title)}"><strong>${escapeHtml(title)}</strong><br>${escapeHtml(detail)}</div>`;
  }).join("");
}

function renderQualityLiftSegmentsDashboard(payload = {}) {
  const report = payload.promptQualityLiftSegmentsReport
    || payload.promptQualityLiftSegments
    || payload.qualityLiftSegmentsReport
    || payload.report
    || payload.diagnostics?.promptQualityLiftSegmentsReport;
  if (!report?.readiness) {
    els.qualityLiftSegmentsStatus.textContent = t("noQualitySegments");
    els.qualityLiftSegmentsStatus.dataset.qualityLiftSegmentsStatus = "missing";
    els.qualityLiftSegmentsImproving.innerHTML = `<div class="skill-row">${escapeHtml(t("noImprovingSegments"))}</div>`;
    els.qualityLiftSegmentsRegressing.innerHTML = `<div class="skill-row">${escapeHtml(t("noRegressingSegments"))}</div>`;
    els.qualityLiftSegmentsCollecting.innerHTML = `<div class="skill-row">${escapeHtml(t("noCollectingSegments"))}</div>`;
    return;
  }

  const readiness = report.readiness;
  const status = readiness.status || "unknown";
  els.qualityLiftSegmentsStatus.textContent = `${status}; ${readiness.segmentCount || 0} segments; ready ${readiness.readySegmentCount || 0}; improving ${readiness.improvingSegmentCount || 0}; regressing ${readiness.regressingSegmentCount || 0}; collecting ${readiness.collectingSegmentCount || 0}`;
  els.qualityLiftSegmentsStatus.dataset.qualityLiftSegmentsStatus = status;
  els.qualityLiftSegmentsStatus.dataset.segmentCount = String(readiness.segmentCount || 0);
  els.qualityLiftSegmentsStatus.dataset.readySegmentCount = String(readiness.readySegmentCount || 0);
  els.qualityLiftSegmentsStatus.dataset.improvingSegmentCount = String(readiness.improvingSegmentCount || 0);
  els.qualityLiftSegmentsStatus.dataset.regressingSegmentCount = String(readiness.regressingSegmentCount || 0);
  els.qualityLiftSegmentsStatus.dataset.collectingSegmentCount = String(readiness.collectingSegmentCount || 0);

  els.qualityLiftSegmentsImproving.innerHTML = renderQualityLiftSegmentRows(report.topImproving || [], t("noImprovingSegments"), "improving");
  els.qualityLiftSegmentsImproving.dataset.segmentCount = String(report.topImproving?.length || 0);
  els.qualityLiftSegmentsRegressing.innerHTML = renderQualityLiftSegmentRows(report.topRegressing || [], t("noRegressingSegments"), "regressing");
  els.qualityLiftSegmentsRegressing.dataset.segmentCount = String(report.topRegressing?.length || 0);
  els.qualityLiftSegmentsCollecting.innerHTML = renderQualityLiftSegmentRows(report.collectingSegments || [], t("noCollectingSegments"), "collecting");
  els.qualityLiftSegmentsCollecting.dataset.segmentCount = String(report.collectingSegments?.length || 0);
}

function renderOutcomeFollowups(payload = {}) {
  const items = payload.pendingOutcomes || payload.outcomeFollowups || [];
  const count = Number(payload.pendingOutcomeCount ?? items.length);
  els.outcomeFollowupStatus.textContent = t("pendingOutcomes", { count });
  els.outcomeFollowupStatus.dataset.pendingOutcomeCount = String(count);
  els.outcomeFollowupStatus.dataset.metadataOnly = String(Boolean(payload.privacy?.metadataOnly ?? true));
  if (!items.length) {
    els.outcomeFollowupList.innerHTML = `<div class="skill-row">${escapeHtml(t("noPendingOutcomes"))}</div>`;
    return;
  }
  els.outcomeFollowupList.innerHTML = items.slice(0, 8).map((item) => {
    const generationId = encodeURIComponent(item.generationId || "");
    const title = [
      item.mode || "mode",
      item.tool || "tool",
      item.site || "local",
      item.taskScenario || "general"
    ].filter(Boolean).join(" / ");
    const detail = [
      `strategy ${item.promptStrategyId || item.strategyId || "unknown"}`,
      `arm ${item.experimentArm || "n/a"}`,
      `cohort ${item.qualityLiftCohort || "n/a"}`,
      `length ${item.promptLength || 0}`,
      `last ${item.lastAction || "generated"}`
    ].join(" | ");
    return `<div class="skill-row outcome-followup-row" data-outcome-generation="${escapeHtml(item.generationId || "")}"><div><strong>${escapeHtml(title)}</strong><br>${escapeHtml(detail)}</div><div class="outcome-followup-actions"><button type="button" class="row-action button-ghost" data-action="record-outcome-followup" data-generation-id="${generationId}" data-outcome-label="success">${escapeHtml(t("success"))}</button><button type="button" class="row-action button-ghost" data-action="record-outcome-followup" data-generation-id="${generationId}" data-outcome-label="needs-work">${escapeHtml(t("needsWork"))}</button><button type="button" class="row-action button-ghost" data-action="record-outcome-followup" data-generation-id="${generationId}" data-outcome-label="failed">${escapeHtml(t("failed"))}</button></div></div>`;
  }).join("");
}

function setKeyPlaceholder(element, redacted, label) {
  element.value = "";
  element.placeholder = redacted ? `Stored ${redacted}` : label;
}

function collectProviderKeys() {
  const providerKeys = {};
  if (els.agnesApiKey.value) providerKeys.agnes = els.agnesApiKey.value;
  if (els.openaiApiKey.value) providerKeys["openai-compatible"] = els.openaiApiKey.value;
  if (els.anthropicApiKey.value) providerKeys.anthropic = els.anthropicApiKey.value;
  if (els.geminiApiKey.value) providerKeys.gemini = els.geminiApiKey.value;
  return providerKeys;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function applyProviderDefaults() {
  const defaults = PROVIDER_DEFAULTS[els.provider.value] || PROVIDER_DEFAULTS["openai-compatible"];
  els.baseUrl.value = defaults.baseUrl;
  els.model.value = defaults.model;
}

async function loadServiceState() {
  try {
    await serviceRequest("/health", { method: "GET" });
    const settings = await serviceRequest("/settings", { method: "GET" });
    const providerStatus = await serviceRequest("/llm/providers", { method: "GET" });
    const skills = await serviceRequest("/skills", { method: "GET" });
    const prompts = await serviceRequest("/prompts", { method: "GET" });
    const pilotOutcomes = await serviceRequest("/metrics/pilot-outcomes", { method: "GET" });
    const qualityLift = await serviceRequest("/metrics/prompt-quality-lift", { method: "GET" });
    const qualityLiftSegments = await serviceRequest("/metrics/prompt-quality-lift-segments", { method: "GET" });
    const outcomeFollowups = await serviceRequest("/outcomes/pending", { method: "GET" });
    let learningReflections = {};
    let evolutionCandidates = {};
    try {
      learningReflections = await serviceRequest("/learning/reflections", { method: "GET" });
      evolutionCandidates = await serviceRequest("/learning/evolution-candidates", { method: "GET" });
    } catch (error) {
      warnAsyncFailure("learning-dashboard-optional-load", error);
      learningReflections = {};
      evolutionCandidates = {};
    }
    els.provider.value = settings.settings.provider || els.provider.value;
    els.baseUrl.value = settings.settings.baseUrl || els.baseUrl.value;
    els.model.value = settings.settings.model || els.model.value;
    setKeyPlaceholder(els.apiKey, settings.settings.apiKey, t("storedByService"));
    setKeyPlaceholder(els.agnesApiKey, settings.settings.providerKeys?.agnes, "Agnes API key");
    setKeyPlaceholder(els.openaiApiKey, settings.settings.providerKeys?.["openai-compatible"], "OpenAI-compatible API key");
    setKeyPlaceholder(els.anthropicApiKey, settings.settings.providerKeys?.anthropic, "Anthropic API key");
    setKeyPlaceholder(els.geminiApiKey, settings.settings.providerKeys?.gemini, "Gemini API key");
    renderSkills(skills.skills);
    renderPrompts(prompts.prompts);
    renderProviderStatus(providerStatus);
    renderPilotOutcomeDashboard(pilotOutcomes);
    renderQualityLiftDashboard(qualityLift);
    renderQualityLiftSegmentsDashboard(qualityLiftSegments);
    renderOutcomeFollowups(outcomeFollowups);
    renderLearningDashboard(learningReflections, evolutionCandidates);
    if (!desktopSnapshotState) renderDesktopSnapshot();
    renderFirstRunProgress({ settings: settings.settings, providerStatus, skills: skills.skills });
    setStatus(t("serviceOnline"), true);
  } catch {
    setStatus(t("serviceOffline"), false);
  }
}

async function saveSettings() {
  localStorage.setItem("smartPromptProviderTestPass", "false");
  const providerKeys = collectProviderKeys();
  const payload = {
    provider: els.provider.value,
    baseUrl: els.baseUrl.value,
    model: els.model.value
  };
  if (els.apiKey.value) payload.apiKey = els.apiKey.value;
  if (Object.keys(providerKeys).length) payload.providerKeys = providerKeys;
  await serviceRequest("/settings", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  els.apiKey.value = "";
  els.agnesApiKey.value = "";
  els.openaiApiKey.value = "";
  els.anthropicApiKey.value = "";
  els.geminiApiKey.value = "";
  await loadServiceState();
}

async function testProvider() {
  els.providerTestStatus.textContent = t("testingProvider");
  els.providerTestStatus.dataset.providerTestPass = "pending";
  try {
    const result = await serviceRequest("/llm/test", {
      method: "POST",
      body: JSON.stringify({ mode: "idea" })
    });
    localStorage.setItem("smartPromptProviderTestPass", "true");
    localStorage.setItem("smartPromptProviderTestedAt", result.testedAt || new Date().toISOString());
    els.providerTestStatus.textContent = t("providerReady", {
      provider: result.provider || els.provider.value,
      model: result.model || els.model.value,
      generatedBy: result.generatedBy,
      promptLength: result.promptLength
    });
    els.providerTestStatus.dataset.providerTestPass = "true";
    els.providerTestStatus.dataset.promptLength = String(result.promptLength || 0);
    const providerStatus = await serviceRequest("/llm/providers", { method: "GET" });
    renderProviderStatus(providerStatus);
    renderFirstRunProgress({ providerStatus });
  } catch (error) {
    localStorage.setItem("smartPromptProviderTestPass", "false");
    els.providerTestStatus.textContent = t("providerTestFailed", { message: error.message });
    els.providerTestStatus.dataset.providerTestPass = "false";
    renderFirstRunProgress();
    throw error;
  }
}

async function importFolder() {
  const result = await serviceRequest("/skills/import-folder", {
    method: "POST",
    body: JSON.stringify({ path: els.skillFolder.value })
  });
  renderSkills(result.skills);
  renderFirstRunProgress({ skills: result.skills });
}

async function deleteSkill(id) {
  if (!id) return;
  const result = await serviceRequest(`/skills/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
  renderSkills(result.skills);
  renderFirstRunProgress({ skills: result.skills });
}

async function savePrompt() {
  const result = await serviceRequest("/prompts", {
    method: "POST",
    body: JSON.stringify({
      title: els.promptTitle.value,
      body: els.promptBody.value,
      source: "desktop-shell"
    })
  });
  els.promptTitle.value = "";
  els.promptBody.value = "";
  renderPrompts(result.prompts);
}

async function deletePrompt(id) {
  if (!id) return;
  const result = await serviceRequest(`/prompts/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
  renderPrompts(result.prompts);
}

function handleSkillListAction(event) {
  const button = event.target.closest('button[data-action="delete-skill"]');
  if (!button) return;
  deleteSkill(decodeURIComponent(button.dataset.skillId || "")).catch((error) => setStatus(error.message, false));
}

function handlePromptListAction(event) {
  const button = event.target.closest('button[data-action="delete-prompt"]');
  if (!button) return;
  deletePrompt(decodeURIComponent(button.dataset.promptId || "")).catch((error) => setStatus(error.message, false));
}

async function saveShortcut() {
  if (window.__TAURI__?.core?.invoke) {
    await window.__TAURI__.core.invoke("set_global_shortcut", { shortcut: els.shortcut.value });
  }
  localStorage.setItem("smartPromptShortcut", els.shortcut.value);
}

async function bindTauriEvents() {
  if (window.__TAURI__?.event?.listen) {
    window.__TAURI__.event.listen("smart-prompt-shortcut", (event) => {
      recordShortcutTrigger(event.payload);
    }).catch((error) => setStatus(error.message, false));
    window.__TAURI__.event.listen("smart-prompt-overlay-click", (event) => {
      return handleMascotOverlayClick(event.payload).catch((error) => setStatus(error.message, false));
    }).catch((error) => setStatus(error.message, false));
    window.__TAURI__.event.listen("smart-prompt-overlay-draft", (event) => {
      return handleMascotOverlayDraftSubmission(event.payload).catch((error) => setStatus(error.message, false));
    }).catch((error) => setStatus(error.message, false));
    window.__TAURI__.event.listen("smart-prompt-foreground-window-state", (event) => {
      return handleFastForegroundState(event.payload, "native-event").catch((error) => setStatus(error.message, false));
    }).catch((error) => setStatus(error.message, false));
  }
  window.__smartPromptEventsReady = true;
}

async function startLocalService() {
  if (window.__TAURI__?.core?.invoke) {
    const status = await window.__TAURI__.core.invoke("start_local_service");
    document.documentElement.dataset.localServiceStatus = status;
    await loadServiceState();
    return;
  }
  setStatus(t("runServiceManually"), false);
}

async function stopLocalService() {
  if (window.__TAURI__?.core?.invoke) {
    const status = await window.__TAURI__.core.invoke("stop_local_service");
    document.documentElement.dataset.localServiceStatus = status;
    setStatus("service process stopped", false);
    return;
  }
  setStatus(t("stopServiceManually"), false);
}

async function restartLocalService() {
  if (window.__TAURI__?.core?.invoke) {
    const status = await window.__TAURI__.core.invoke("restart_local_service");
    serviceAuthToken = "";
    document.documentElement.dataset.localServiceStatus = status;
    await loadServiceState();
    return;
  }
  setStatus(t("restartServiceManually"), false);
}

async function exportDiagnostics() {
  const result = await serviceRequest("/diagnostics/export", { method: "GET" });
  els.diagnosticsOutput.textContent = JSON.stringify(result.diagnostics, null, 2);
  els.diagnosticsOutput.dataset.diagnostics = "exported";
  renderPilotOutcomeDashboard(result);
  renderQualityLiftDashboard(result);
  renderQualityLiftSegmentsDashboard(result);
  renderLearningDashboard(result.diagnostics || result, result.diagnostics || result);
  setStatus(t("diagnosticsExported"), true);
}

async function refreshPilotOutcomes() {
  const result = await serviceRequest("/metrics/pilot-outcomes", { method: "GET" });
  renderPilotOutcomeDashboard(result);
  setStatus(t("pilotOutcomesRefreshed"), true);
}

async function refreshQualityLift() {
  const result = await serviceRequest("/metrics/prompt-quality-lift", { method: "GET" });
  renderQualityLiftDashboard(result);
  setStatus(t("qualityLiftRefreshed"), true);
}

async function refreshQualityLiftSegments() {
  const result = await serviceRequest("/metrics/prompt-quality-lift-segments", { method: "GET" });
  renderQualityLiftSegmentsDashboard(result);
  setStatus(t("qualitySegmentsRefreshed"), true);
}

async function refreshOutcomeFollowups() {
  const result = await serviceRequest("/outcomes/pending", { method: "GET" });
  renderOutcomeFollowups(result);
  setStatus(t("outcomeFollowupsRefreshed"), true);
}

async function refreshDesktopSnapshot(options = {}) {
  if (!options.silent) setMascotState("thinking");
  const result = await serviceRequest("/desktop/input-snapshot", { method: "GET" });
  renderDesktopSnapshot(result);
  const profile = result.snapshot?.summary?.detectedToolProfile
    || result.snapshot?.foreground?.detectedToolProfile
    || "unknown";
  if (String(profile).toLowerCase() === "codex") {
    await refreshCodexAdapterInspect({
      silent: true,
      state: options.overlayState || "suggesting",
      overlayMode: getDesktopOverlayRefreshMode(options.overlayMode)
    });
  } else {
    await syncDesktopMascotOverlay(
      result.snapshot,
      options.overlayState || "suggesting",
      getDesktopOverlayRefreshMode(options.overlayMode)
    );
  }
  if (!options.silent) {
    setStatus(options.source === "shortcut" ? t("shortcutCaptured", { profile }) : t("desktopInputInspected"), true);
  }
}

async function activateDesktopMascot() {
  await refreshDesktopSnapshot({ source: "mascot" });
  els.desktopDraftInput?.focus?.();
}

async function generateDesktopPrompt() {
  const input = els.desktopDraftInput.value.trim();
  if (!input) {
    setStatus(t("desktopFusionNeedsDraft"), false);
    setMascotState("resting");
    return;
  }
  const codexSessionActive = Boolean(
    codexTargetState.projectScopeToken
      && codexTargetState.sessionId
      && String(desktopOverlayState.lastPayload?.profile || "").toLowerCase() === "codex"
      && desktopOverlayState.lastPayload?.codexAdapterReady === true
  );
  if (codexSessionActive) clearCodexUndo("generation");
  setMascotState("thinking");
  const context = getDesktopGenerationContext();
  const requestBody = {
    input,
    context: codexSessionActive
      ? {
        ...context,
        tool: "codex",
        adapterId: "target-codex-v1",
        inputKind: "codex-composer",
        target: "codex",
        projectScopeToken: codexTargetState.projectScopeToken,
        sessionId: codexTargetState.sessionId
      }
      : context,
    allowTemplateFallback: true
  };
  if (codexSessionActive) {
    requestBody.target = "codex";
    requestBody.projectScopeToken = codexTargetState.projectScopeToken;
    requestBody.sessionId = codexTargetState.sessionId;
  }
  const result = await serviceRequest("/generate", {
    method: "POST",
    body: JSON.stringify(requestBody)
  });
  if (codexSessionActive) {
    const card = result.card || result.promptCard || {};
    codexTargetState.generationId = String(card.generationId || result.generationId || "");
    if (!codexTargetState.generationId) {
      throw new Error("Codex generation did not return a generationId.");
    }
    codexTargetState.learningFeatureTokens = getCodexLearningFeatureTokens(card);
  }
  renderDesktopFusionGenerated(result);
  if (codexSessionActive) {
    await refreshCodexLearningReminder().catch((error) => {
      warnAsyncFailure("codex-candidate-reminder-after-generate", error);
      codexTargetState.learningCandidate = null;
      updateCodexAttentionPayload({ learningCandidate: null, overlayAction: "" })
        .catch((updateError) => warnAsyncFailure("codex-candidate-reminder-clear", updateError));
    });
  }
  setMascotState("suggesting");
  setStatus(t("desktopFusionGenerated"), true);
}

async function showCodexAdapterGuard(inspected, reasonToken) {
  const reason = getCodexPromptReason(reasonToken);
  if (isCodexAdapterReady(inspected)) {
    const hasGeneratedPrompt = Boolean(els.desktopGeneratedPrompt?.value?.trim());
    const hasDraftPrompt = Boolean(els.desktopDraftInput?.value?.trim());
    await syncCodexAdapterOverlay(inspected, {
      state: "resting",
      overlayMode: "expanded",
      updateOnly: desktopOverlayState.visible,
      payload: {
        overlayAction: "",
        guardReason: reason,
        fillVerified: false,
        verified: false,
        verification: "none",
        canUndo: false,
        collapseRequested: false,
        promptReady: hasGeneratedPrompt || hasDraftPrompt,
        promptKind: hasGeneratedPrompt ? "generated" : hasDraftPrompt ? "draft" : "none"
      }
    });
  } else {
    await hideDesktopMascotOverlay();
  }
  setMascotState("resting");
  setStatus(t("desktopFusionBlocked"), false);
  return false;
}

async function fillCodexTargetInput(textOverride = null) {
  const text = typeof textOverride === "string"
    ? textOverride.trim()
    : els.desktopGeneratedPrompt?.value?.trim() || "";
  if (!text || !codexTargetState.generationId || !codexTargetState.openingDraftHash
      || !codexTargetState.openingTargetSignature || !codexTargetState.projectScopeToken) {
    return showCodexAdapterGuard(codexTargetState.inspectResponse, "generation_binding_missing");
  }

  await beginCodexActivationLoop();
  setMascotState("thinking");
  const inspected = await inspectCodexTarget();
  if (!isCodexAdapterReady(inspected)) {
    return showCodexAdapterGuard(inspected, getCodexAdapterReason(inspected));
  }
  const freshSignature = getCodexTargetSignature(inspected.lease);
  if (freshSignature !== codexTargetState.openingTargetSignature
      || inspected.lease.projectScopeToken !== codexTargetState.projectScopeToken
      || inspected.lease.draftHash !== codexTargetState.openingDraftHash) {
    clearCodexUndo("target_changed");
    return showCodexAdapterGuard(inspected, "draft_changed_since_open");
  }

  const allowClipboardFallback = inspected.lease.capabilities?.controlledClipboard === true;
  const inserted = await serviceRequest("/target/codex/insert", {
    method: "POST",
    body: JSON.stringify({
      leaseId: inspected.lease.leaseId,
      text,
      expectedDraftHash: codexTargetState.openingDraftHash,
      generationId: codexTargetState.generationId,
      allowClipboardFallback
    })
  });
  const transactionId = String(inserted.transaction?.transactionId || "");
  const verified = inserted.result?.status === "ready"
    && inserted.result?.verified === true
    && inserted.result?.verification === "machine"
    && inserted.result?.readbackMatched === true
    && inserted.result?.noAutoSubmit === true
    && inserted.transaction?.target === "codex"
    && inserted.transaction?.projectScopeToken === codexTargetState.projectScopeToken
    && Boolean(transactionId)
    && Boolean(inserted.undoToken);
  if (!verified) {
    return showCodexAdapterGuard(inspected, inserted.result?.reasonToken || "insert_failed");
  }

  codexTargetState.undoToken = String(inserted.undoToken);
  codexTargetState.undoDraftHash = "";
  codexTargetState.undoOpeningDraftText = codexTargetState.openingDraftText;
  codexTargetState.transactionId = transactionId;
  codexTargetState.pendingOutcome = inserted.pendingOutcome || null;
  const insertedInspect = await inspectCodexTarget().catch((error) => {
    warnAsyncFailure("codex-post-insert-inspect", error);
    return null;
  });
  if (isCodexAdapterReady(insertedInspect)
      && getCodexTargetSignature(insertedInspect.lease) === codexTargetState.openingTargetSignature
      && insertedInspect.lease.projectScopeToken === codexTargetState.projectScopeToken) {
    codexTargetState.undoDraftHash = insertedInspect.lease.draftHash;
  }
  const activation = await completeCodexActivation(transactionId);
  showVerifiedDesktopFill(transactionId, codexTargetState.pendingOutcome, activation);
  setMascotState("success");
  if (els.desktopFusionEvidence) {
    els.desktopFusionEvidence.textContent = t("desktopFusionFilled");
    els.desktopFusionEvidence.dataset.fusionState = "filled";
    els.desktopFusionEvidence.dataset.foregroundFill = "true";
    els.desktopFusionEvidence.dataset.fillPass = "true";
    els.desktopFusionEvidence.dataset.verified = "true";
    els.desktopFusionEvidence.dataset.verification = "machine";
    els.desktopFusionEvidence.dataset.transactionId = transactionId;
    els.desktopFusionEvidence.dataset.noAutoSubmit = "true";
  }
  setStatus(t("desktopFusionFilled"), true);
  return true;
}

async function undoCodexTargetInsert() {
  const undoToken = codexTargetState.undoToken;
  const restoredDraft = codexTargetState.undoOpeningDraftText;
  if (!undoToken) return false;
  setMascotState("thinking");
  const undone = await serviceRequest("/target/codex/undo", {
    method: "POST",
    body: JSON.stringify({
      undoToken,
      allowClipboardFallback: codexTargetState.lease?.capabilities?.controlledClipboard === true
    })
  });
  const restored = desktopOverlayLogic.isMachineVerifiedCodexUndo(undone.result);
  if (!restored) {
    return showCodexAdapterGuard(codexTargetState.inspectResponse, undone.result?.reasonToken || "undo_failed");
  }

  codexTargetState.undoToken = "";
  codexTargetState.undoDraftHash = "";
  codexTargetState.undoOpeningDraftText = "";
  codexTargetState.transactionId = "";
  codexTargetState.pendingOutcome = null;
  applyCodexOpeningDraft(restoredDraft);
  const inspected = await inspectCodexTarget();
  if (!isCodexAdapterReady(inspected)) {
    await hideDesktopMascotOverlay();
    return false;
  }
  codexTargetState.openingDraftHash = inspected.lease.draftHash;
  codexTargetState.openingDraftText = restoredDraft;
  codexTargetState.openingTargetSignature = getCodexTargetSignature(inspected.lease);
  await syncCodexAdapterOverlay(inspected, {
    state: "suggesting",
    overlayMode: "expanded",
    updateOnly: desktopOverlayState.visible,
    payload: {
      overlayAction: "",
      promptReady: Boolean(restoredDraft),
      promptKind: restoredDraft ? "draft" : "none",
      promptText: restoredDraft,
      promptTextLength: restoredDraft.length,
      promptTextHash: hashText(restoredDraft),
      fillVerified: false,
      verified: false,
      verification: "none",
      canUndo: false,
      collapseRequested: false,
      pendingOutcome: null
    }
  });
  setMascotState("suggesting");
  setStatus(t("desktopInputInspected"), true);
  return true;
}

async function fillForegroundInput(textOverride = null) {
  const readiness = getDesktopSnapshotReadiness();
  const text = typeof textOverride === "string"
    ? textOverride.trim()
    : els.desktopGeneratedPrompt.value.trim() || els.desktopDraftInput.value.trim();
  if (!readiness.ready || !text) {
    setStatus(t("desktopFusionBlocked"), false);
    setMascotState("resting");
    updateDesktopFusionControls();
    return;
  }
  await syncDesktopPromptState({ silent: true, force: true });
  await beginCodexActivationLoop();
  setMascotState("thinking");
  const result = await serviceRequest("/desktop/fill", {
    method: "POST",
    body: JSON.stringify({
      text,
      confirmForeground: true,
      allowClipboardFallback: true,
      allowTextPatternVerification: true,
      expectedTitleHash: readiness.titleHash,
      expectedToolProfile: readiness.profile,
      candidateIndex: readiness.bestCandidateIndex
    })
  });
  renderDesktopFillResult(result);
  const verified = isVerifiedCodexFill(result.fill, readiness);
  if (verified) {
    const eventId = `activation-verified_insert-${Date.now()}`;
    showVerifiedDesktopFill(eventId);
  } else if (desktopOverlayState.visible && desktopOverlayState.lastPayload) {
    const blockedPayload = withDesktopPromptOverlayMeta({
      ...desktopOverlayState.lastPayload,
      state: "resting",
      overlayMode: "expanded",
      fillVerified: false,
      verified: false,
      verification: "none",
      canUndo: false,
      collapseRequested: false,
      guardReason: result.fill?.reason || "readback_unavailable"
    });
    desktopOverlayState.lastPayload = blockedPayload;
    await invokeDesktopOverlay("set_mascot_overlay_state", blockedPayload);
  }
  setStatus(verified ? t("desktopFusionFilled") : t("desktopFusionBlocked"), verified);
}

async function refreshDesktopOverlaySnapshot() {
  if (String(desktopOverlayState.fastState?.detectedToolProfile || "").toLowerCase() === "codex") {
    return refreshCodexAdapterInspect({
      silent: true,
      overlayMode: getDesktopOverlayRefreshMode()
    });
  }
  if (desktopOverlayState.pollInFlight) {
    desktopOverlayState.pollPending = true;
    return null;
  }
  desktopOverlayState.pollInFlight = true;
  const startedAt = Date.now();
  let ok = false;
  traceDesktopOverlayRuntime("overlay-snapshot-start", {});
  try {
    const result = await serviceRequest("/desktop/input-snapshot", { method: "GET" });
    traceDesktopOverlayRuntime("overlay-snapshot-result", {
      ...getDesktopOverlaySnapshotTraceMeta(result.snapshot),
      durationMs: Date.now() - startedAt
    });
    renderDesktopSnapshot(result);
    await syncDesktopMascotOverlay(result.snapshot, "suggesting", getDesktopOverlayRefreshMode());
    ok = true;
  } catch (error) {
    traceDesktopOverlayRuntime("overlay-snapshot-error", {
      ...getErrorTraceMeta(error),
      durationMs: Date.now() - startedAt
    });
    await hideDesktopMascotOverlay();
  } finally {
    desktopOverlayState.pollInFlight = false;
    if (desktopOverlayState.pollPending) {
      desktopOverlayState.pollPending = false;
      refreshDesktopOverlaySnapshot().catch((error) => warnAsyncFailure("desktop-overlay-pending-snapshot", error));
    }
  }
  return ok;
}

async function showFastForegroundMascotOverlay(state, options = {}) {
  if (desktopOverlayState.visible && !desktopOverlayState.lastPayload?.fastWindowProbe && !options.force) return true;
  const payload = buildFastForegroundOverlayPayload(state, getDesktopOverlayRefreshMode());
  if (!payload) return false;
  desktopOverlayState.visible = true;
  desktopOverlayState.lastPayload = payload;
  desktopOverlayState.lastReadyAt = Date.now();
  traceDesktopOverlayRuntime("overlay-fast-window-show", {
    profile: payload.profile,
    x: Math.round(Number(payload.compactX || payload.x || 0)),
    y: Math.round(Number(payload.compactY || payload.y || 0)),
    promptReady: payload.promptReady,
    promptKind: payload.promptKind,
    promptTextLength: payload.promptTextLength,
    fastWindowProbe: true
  });
  return invokeDesktopOverlay("show_mascot_overlay", payload);
}

async function handleFastForegroundState(state, source = "poll") {
  const previousProfile = String(desktopOverlayState.fastState?.detectedToolProfile || "").toLowerCase();
  const { supported, changed } = recordFastForegroundState(state, source);
  const profile = String(state?.detectedToolProfile || "").toLowerCase();
  const preserveVerifiedCodexTransaction = Boolean(
    codexTargetState.undoToken
      || codexTargetState.transactionId
      || codexTargetState.pendingOutcome
  );
  if (previousProfile === "codex" && profile !== "codex" && !preserveVerifiedCodexTransaction) {
    clearCodexPromptSession("target_changed");
  }
  if (!supported) {
    if (desktopOverlayState.visible || desktopOverlayState.lastFastSupported) {
      traceDesktopOverlayRuntime("overlay-fast-window-hide", {
        source,
        profile: String(state?.detectedToolProfile || "unknown"),
        isVisible: Boolean(state?.isVisible),
        isMinimized: Boolean(state?.isMinimized),
        isCloaked: Boolean(state?.isCloaked),
        isUsable: Boolean(state?.isUsable)
      });
      await hideDesktopMascotOverlay();
    }
    desktopOverlayState.lastFastSupported = false;
    return false;
  }
  desktopOverlayState.lastFastSupported = true;
  if (profile === "codex") {
    if (desktopOverlayState.visible && desktopOverlayState.lastPayload?.codexAdapterReady !== true) {
      await hideDesktopMascotOverlay();
    }
    if (changed || !desktopOverlayState.visible) {
      await refreshCodexAdapterInspect({ silent: true, overlayMode: getDesktopOverlayRefreshMode() });
    }
    return true;
  }
  if (!desktopOverlayState.visible || changed) {
    await showFastForegroundMascotOverlay(state, { force: changed });
  }
  if ((changed || desktopOverlayState.lastPayload?.fastWindowProbe) && !desktopOverlayState.pollInFlight) {
    refreshDesktopOverlaySnapshot().catch((error) => warnAsyncFailure("desktop-overlay-fast-followup-snapshot", error));
  }
  return true;
}

async function refreshDesktopOverlayFastState() {
  if (!window.__TAURI__?.core?.invoke) return null;
  if (desktopOverlayState.fastPollInFlight) {
    desktopOverlayState.fastPollPending = true;
    return null;
  }
  desktopOverlayState.fastPollInFlight = true;
  let ok = false;
  try {
    const state = await window.__TAURI__.core.invoke("get_foreground_window_state");
    await handleFastForegroundState(state, "poll");
    ok = true;
  } catch (error) {
    traceDesktopOverlayRuntime("overlay-fast-window-error", {
      ...getErrorTraceMeta(error),
      message: String(error?.message || error || "").slice(0, 96)
    });
  } finally {
    desktopOverlayState.fastPollInFlight = false;
    if (desktopOverlayState.fastPollPending) {
      desktopOverlayState.fastPollPending = false;
      refreshDesktopOverlayFastState().catch((error) => warnAsyncFailure("desktop-overlay-pending-fast-state", error));
    }
  }
  return ok;
}

function nextDesktopOverlayBackoff(current, minimum, ok) {
  if (ok === null) return current;
  if (ok) return minimum;
  return Math.min(DESKTOP_OVERLAY_MAX_BACKOFF_MS, Math.max(minimum, current || minimum) * 2);
}

function scheduleDesktopOverlaySnapshotPoll() {
  if (!desktopOverlayState.autoStarted || typeof setTimeout !== "function") return;
  desktopOverlayState.timer = setTimeout(async () => {
    const ok = await refreshDesktopOverlaySnapshot();
    desktopOverlayState.pollBackoffMs = nextDesktopOverlayBackoff(desktopOverlayState.pollBackoffMs, DESKTOP_OVERLAY_POLL_MS, ok);
    scheduleDesktopOverlaySnapshotPoll();
  }, desktopOverlayState.pollBackoffMs);
}

function scheduleDesktopOverlayFastPoll() {
  if (!desktopOverlayState.autoStarted || typeof setTimeout !== "function") return;
  desktopOverlayState.fastTimer = setTimeout(async () => {
    const ok = await refreshDesktopOverlayFastState();
    desktopOverlayState.fastPollBackoffMs = nextDesktopOverlayBackoff(desktopOverlayState.fastPollBackoffMs, DESKTOP_OVERLAY_FAST_POLL_MS, ok);
    scheduleDesktopOverlayFastPoll();
  }, desktopOverlayState.fastPollBackoffMs);
}

function startDesktopOverlayAutoDetect() {
  if (desktopOverlayState.autoStarted || !window.__TAURI__?.core?.invoke || typeof setTimeout !== "function") return;
  desktopOverlayState.autoStarted = true;
  desktopOverlayState.pollBackoffMs = DESKTOP_OVERLAY_POLL_MS;
  desktopOverlayState.fastPollBackoffMs = DESKTOP_OVERLAY_FAST_POLL_MS;
  window.__smartPromptOverlayAutoDetectReady = true;
  traceDesktopOverlayRuntime("overlay-auto-detect-start", {});
  window.__TAURI__.core.invoke("start_local_service")
    .then((status) => traceDesktopOverlayRuntime("overlay-start-service-result", { status: String(status || "") }))
    .catch((error) => traceDesktopOverlayRuntime("overlay-start-service-error", getErrorTraceMeta(error)));
  scheduleDesktopOverlaySnapshotPoll();
  scheduleDesktopOverlayFastPoll();
  refreshDesktopOverlayFastState().catch((error) => warnAsyncFailure("desktop-overlay-initial-fast-state", error));
  refreshDesktopOverlaySnapshot().catch((error) => warnAsyncFailure("desktop-overlay-initial-snapshot", error));
}

function startDesktopOverlayAutoDetectWhenReady(attempt = 0) {
  if (desktopOverlayState.autoStarted) return;
  if (window.__TAURI__?.core?.invoke && typeof setTimeout === "function") {
    traceDesktopOverlayRuntime("overlay-tauri-ready", { attempt });
    startDesktopOverlayAutoDetect();
    return;
  }
  if (typeof setTimeout === "function" && attempt < 40) {
    setTimeout(() => startDesktopOverlayAutoDetectWhenReady(attempt + 1), 250);
  }
}

function isDesktopShellHidden() {
  return document.hidden === true || document.visibilityState === "hidden";
}

function handleDesktopShellVisibilityChange() {
  const hidden = isDesktopShellHidden();
  document.documentElement.dataset.desktopShellVisible = hidden ? "false" : "true";
  if (hidden) {
    hideDesktopMascotOverlay().catch((error) => warnAsyncFailure("desktop-shell-hidden-overlay-hide", error));
    return;
  }
  if (desktopOverlayState.autoStarted) {
    refreshDesktopOverlayFastState()
      .then(() => {
        if (isFastForegroundSupported(desktopOverlayState.fastState)) {
          refreshDesktopOverlaySnapshot().catch((error) => warnAsyncFailure("desktop-shell-visible-snapshot", error));
        }
      })
      .catch((error) => warnAsyncFailure("desktop-shell-visible-fast-state", error));
  }
}

function bindDesktopShellVisibilityGuard() {
  document.documentElement.dataset.desktopShellVisible = isDesktopShellHidden() ? "false" : "true";
  if (typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", handleDesktopShellVisibilityChange);
  }
  if (typeof window.addEventListener === "function") {
    window.addEventListener("pagehide", () => {
      hideDesktopMascotOverlay().catch((error) => warnAsyncFailure("desktop-shell-pagehide-overlay-hide", error));
    });
  }
}

function isMascotOverlayPayloadAligned(payload, readiness) {
  if (!payload) return false;
  return Boolean(
    payload.visualOnly !== true
      && payload.noAutoSubmit === true
      && String(payload.profile || "") === readiness.profile
      && String(payload.titleHash || "") === readiness.titleHash
      && Number(payload.candidateIndex) === readiness.bestCandidateIndex
  );
}

function getCodexOutcomeId(pendingOutcome = codexTargetState.pendingOutcome) {
  return String(
    pendingOutcome?.outcome?.outcomeId
      || pendingOutcome?.outcomeId
      || pendingOutcome?.id
      || ""
  );
}

function getCodexCandidateId(candidate = codexTargetState.learningCandidate) {
  return String(candidate?.artifactId || candidate?.candidateId || candidate?.id || "");
}

async function updateCodexAttentionPayload(overrides = {}) {
  if (!desktopOverlayState.visible || !desktopOverlayState.lastPayload) return;
  desktopOverlayState.lastPayload = {
    ...desktopOverlayState.lastPayload,
    pendingOutcome: codexTargetState.pendingOutcome,
    learningCandidate: codexTargetState.learningCandidate,
    ...overrides
  };
  await invokeDesktopOverlay("set_mascot_overlay_state", desktopOverlayState.lastPayload);
}

async function submitCodexOutcomeFeedback(payload = {}) {
  const action = String(payload.overlayAction || "").toLowerCase();
  const outcomeId = String(payload.outcomeId || "");
  if (!outcomeId || outcomeId !== getCodexOutcomeId()) return false;
  const body = {
    feedbackId: createCodexClientToken("feedback"),
    outcomeId,
    taskOutcomeToken: action === "outcome-completed" ? "completed" : "not_completed"
  };
  if (action === "outcome-reason") {
    const reasonToken = String(payload.value || "");
    if (!CODEX_OUTCOME_FAILURE_REASONS.has(reasonToken)) return false;
    body.reasonToken = reasonToken;
  } else if (action !== "outcome-completed" && action !== "outcome-not-completed") {
    return false;
  }
  const response = await serviceRequest("/outcomes/v2/feedback", {
    method: "POST",
    body: JSON.stringify(body)
  });
  const feedback = response?.result;
  if (action === "outcome-not-completed") {
    if (feedback?.state !== "reason_required") {
      throw new Error("Outcome failure reason was not requested by the service.");
    }
    codexTargetState.pendingOutcome = feedback;
    await updateCodexAttentionPayload({
      pendingOutcome: codexTargetState.pendingOutcome,
      overlayAction: ""
    });
    return true;
  }
  const resolved = action === "outcome-completed"
    ? feedback?.state === "completed" || feedback?.outcome?.status === "succeeded"
    : feedback?.state === "not_completed" || feedback?.outcome?.status === "failed";
  if (!resolved) throw new Error("Outcome feedback was not finalized by the service.");
  codexTargetState.pendingOutcome = null;
  await updateCodexAttentionPayload({ pendingOutcome: null, overlayAction: "" });
  return true;
}

function getControlCenterPolicyIdentity(policy = {}) {
  const policyId = String(policy.policyId || policy.id || "");
  const version = Number(policy.version ?? policy.policyVersion);
  return policyId && Number.isInteger(version) && version > 0 ? { policyId, version } : null;
}

function findControlCenterPolicy(policyId, version) {
  return controlCenterLearningState.policies.find((policy) => {
    const identity = getControlCenterPolicyIdentity(policy);
    return identity?.policyId === policyId && identity.version === version;
  }) || null;
}

function annotateControlCenterPolicyActions() {
  controlCenterLearningState.policyActionContexts.clear();
  if (typeof document.querySelectorAll !== "function") return;
  const policies = controlCenterLearningState.policies
    .map((policy) => ({ policy, identity: getControlCenterPolicyIdentity(policy) }))
    .filter((entry) => entry.identity);
  const rows = [...document.querySelectorAll('[data-learning-kind="policy"]')];
  rows.forEach((row, index) => {
    const entry = policies[index];
    if (!entry || typeof row.querySelectorAll !== "function") return;
    const actionKey = `policy-action-${controlCenterLearningState.policyActionSequence += 1}`;
    controlCenterLearningState.policyActionContexts.set(actionKey, entry.identity);
    if (row.dataset) {
      row.dataset.policyId = entry.identity.policyId;
      row.dataset.policyVersion = String(entry.identity.version);
    }
    row.querySelectorAll('button[data-learning-action^="policy-"]').forEach((button) => {
      button.dataset.learningValue = actionKey;
    });
  });
}

function resolveControlCenterPolicyAction(value) {
  const mapped = controlCenterLearningState.policyActionContexts.get(value);
  if (mapped) {
    const policy = findControlCenterPolicy(mapped.policyId, mapped.version);
    return policy ? { ...mapped, policy } : null;
  }
  const matches = controlCenterLearningState.policies
    .map((policy) => ({ policy, identity: getControlCenterPolicyIdentity(policy) }))
    .filter((entry) => entry.identity?.policyId === value);
  return matches.length === 1 ? { ...matches[0].identity, policy: matches[0].policy } : null;
}

function dispatchControlCenterLearningData() {
  if (typeof window.dispatchEvent !== "function" || typeof CustomEvent !== "function") return false;
  const dispatched = window.dispatchEvent(new CustomEvent("smart-prompt-learning-data", {
    detail: {
      artifacts: controlCenterLearningState.artifacts,
      proposals: controlCenterLearningState.proposals,
      policies: controlCenterLearningState.policies,
      rollouts: controlCenterLearningState.rollouts,
      learningPaused: controlCenterLearningState.learningPaused,
      selectedCandidate: controlCenterLearningState.selectedCandidate
    }
  }));
  annotateControlCenterPolicyActions();
  return dispatched;
}

async function refreshControlCenterLearningV1() {
  if (controlCenterLearningState.refreshInFlight) return controlCenterLearningState.refreshInFlight;
  controlCenterLearningState.refreshInFlight = Promise.all([
    serviceRequest("/learning/v1/artifacts", { method: "GET" }),
    serviceRequest("/learning/v1/global-proposals", { method: "GET" }),
    serviceRequest("/policies/v1", { method: "GET" }),
    serviceRequest("/policies/v1/rollouts", { method: "GET" })
  ]).then(([artifacts, proposals, policies, rollouts]) => {
    controlCenterLearningState.artifacts = artifacts.artifacts || [];
    controlCenterLearningState.proposals = proposals.proposals || [];
    controlCenterLearningState.policies = policies.policies || [];
    controlCenterLearningState.rollouts = rollouts.rollouts || [];
    controlCenterLearningState.learningPaused = policies.learningPaused === true;
    dispatchControlCenterLearningData();
    return controlCenterLearningState;
  }).finally(() => {
    controlCenterLearningState.refreshInFlight = null;
  });
  return controlCenterLearningState.refreshInFlight;
}

async function persistControlCenterLearningAction(actionId, value, policyAction = null) {
  if (actionId === "candidate-review") {
    const detail = await serviceRequest(`/learning/v1/candidate?artifactId=${encodeURIComponent(value)}`, { method: "GET" });
    controlCenterLearningState.selectedCandidate = detail.candidate || null;
    return serviceRequest("/learning/v1/candidates/review", {
      method: "POST",
      body: JSON.stringify({ artifactId: value, decision: { action: "accept" } })
    });
  }
  if (actionId === "candidate-ignore") {
    return serviceRequest("/learning/v1/candidates/ignore", {
      method: "POST",
      body: JSON.stringify({ artifactId: value })
    });
  }
  if (actionId === "promotion-confirm" || actionId === "promotion-dismiss") {
    return serviceRequest("/learning/v1/global-proposals/confirm", {
      method: "POST",
      body: JSON.stringify({ proposalId: value, confirmed: actionId === "promotion-confirm" })
    });
  }
  if (actionId === "policy-start-canary") {
    if (!policyAction) throw new Error("The selected policy version is unavailable.");
    return serviceRequest("/policies/v1/canary", {
      method: "POST",
      body: JSON.stringify({
        policyId: policyAction.policyId,
        version: policyAction.version,
        canaryShareBps: 1000
      })
    });
  }
  if (actionId === "policy-learning-pause") {
    return serviceRequest("/policies/v1/pause", {
      method: "POST",
      body: JSON.stringify({ reason: "manual" })
    });
  }
  if (actionId === "policy-learning-resume") {
    return serviceRequest("/policies/v1/resume", {
      method: "POST",
      body: JSON.stringify({})
    });
  }
  if (actionId === "policy-rollback") {
    if (!policyAction) throw new Error("The selected policy version is unavailable.");
    return serviceRequest("/policies/v1/rollback", {
      method: "POST",
      body: JSON.stringify({
        policyId: policyAction.policyId,
        version: policyAction.version,
        reason: "manual"
      })
    });
  }
  return null;
}

function showControlCenterLearningActionUnavailable() {
  const status = document.querySelector?.('[data-control-page-view="learning"] #learning-status');
  if (!status) return;
  status.textContent = "Action unavailable.";
  status.dataset.tone = "error";
}

async function handleControlCenterLearningAction(event) {
  const actionId = String(event?.detail?.id || "");
  const value = String(event?.detail?.value || "");
  const handledActions = new Set([
    "candidate-review",
    "candidate-ignore",
    "promotion-confirm",
    "promotion-dismiss",
    "policy-learning-pause",
    "policy-learning-resume",
    "policy-start-canary",
    "policy-rollback"
  ]);
  if (!value || !handledActions.has(actionId)) return;
  const versionedPolicyAction = actionId === "policy-start-canary" || actionId === "policy-rollback";
  const policyAction = versionedPolicyAction
    ? resolveControlCenterPolicyAction(value)
    : null;
  if (versionedPolicyAction && !policyAction) return;
  event.preventDefault?.();
  try {
    await persistControlCenterLearningAction(actionId, value, policyAction);
    await refreshControlCenterLearningV1();
  } catch (error) {
    showControlCenterLearningActionUnavailable();
    warnAsyncFailure("control-center-learning-action", error);
  }
}

function bindControlCenterLearningBridge() {
  if (!phase3ControlCenterActive) return;
  window.addEventListener?.("smart-prompt-learning-action", handleControlCenterLearningAction);
  document.addEventListener?.("click", (event) => {
    const pageButton = event.target?.closest?.('[data-control-page="learning"]');
    if (!pageButton) return;
    refreshControlCenterLearningV1().catch((error) => warnAsyncFailure("control-center-learning-refresh", error));
  });
  setTimeout(() => {
    refreshControlCenterLearningV1().catch((error) => warnAsyncFailure("control-center-learning-initial", error));
  }, 0);
}

async function ignoreCodexLearningCandidate(payload = {}) {
  const candidateId = String(payload.candidateId || payload.value || "");
  if (!candidateId || candidateId !== getCodexCandidateId()) return false;
  await serviceRequest("/learning/v1/candidates/ignore", {
    method: "POST",
    body: JSON.stringify({ artifactId: candidateId })
  });
  codexTargetState.learningCandidate = null;
  await updateCodexAttentionPayload({ learningCandidate: null, overlayAction: "" });
  refreshControlCenterLearningV1().catch((error) => warnAsyncFailure("candidate-ignore-learning-refresh", error));
  return true;
}

async function openControlCenterLearning(candidateId) {
  const detail = await serviceRequest(`/learning/v1/candidate?artifactId=${encodeURIComponent(candidateId)}`, { method: "GET" });
  controlCenterLearningState.selectedCandidate = detail.candidate || null;
  await refreshControlCenterLearningV1().catch((error) => warnAsyncFailure("candidate-review-learning-refresh", error));
  await invokeDesktopOverlay("show_main_window");
  const root = typeof document.querySelector === "function" ? document.querySelector("#phase3-control-center") : null;
  if (root?.dataset) root.dataset.learningCandidateId = candidateId;
  root?.querySelector?.('[data-control-page="learning"]')?.click?.();
  return true;
}

async function reviewCodexLearningCandidate(payload = {}) {
  const candidateId = String(payload.candidateId || payload.value || "");
  if (!candidateId || candidateId !== getCodexCandidateId()) return false;
  return openControlCenterLearning(candidateId);
}

function getMascotOverlayAction(payload) {
  const action = String(payload?.overlayAction || "").toLowerCase();
  if ([
    "open",
    "draft",
    "fill",
    "undo",
    "invalidate-undo",
    "generate",
    "mode",
    "locale",
    "refresh",
    "review",
    "outcome-good",
    "outcome-fix",
    "outcome-completed",
    "outcome-not-completed",
    "outcome-reason",
    "candidate-ignore",
    "candidate-review"
  ].includes(action)) return action;
  return "";
}

function getMascotOverlayLocale(payload) {
  return normalizeLocale(payload?.locale || currentLocale);
}

function applyMascotOverlayLocale(payload = {}) {
  const nextLocale = getMascotOverlayLocale(payload);
  if (nextLocale !== currentLocale || localStorage.getItem("smartPromptDesktopLocale") !== nextLocale) {
    setLocaleSetting(nextLocale);
  }
  return nextLocale;
}

function getMascotOverlayPromptMode(payload) {
  const mode = String(payload?.promptMode || "").toLowerCase();
  return DESKTOP_PROMPT_MODES.has(mode) ? mode : desktopPromptMode;
}

function setDesktopPromptMode(mode, options = {}) {
  if (!DESKTOP_PROMPT_MODES.has(mode)) return false;
  desktopPromptMode = mode;
  document.documentElement.dataset.desktopPromptMode = mode;
  if (els.desktopPromptHandoff) els.desktopPromptHandoff.dataset.promptMode = mode;
  if (options.updateControls !== false) updateDesktopFusionControls();
  scheduleDesktopPromptStateSync();
  return true;
}

async function blockMascotOverlayClick() {
  setMascotState("resting");
  showDesktopMascotOverlayGuard("payload_guard");
  if (els.desktopFusionEvidence) {
    els.desktopFusionEvidence.textContent = t("desktopFusionBlocked");
    els.desktopFusionEvidence.dataset.fusionState = "blocked";
    els.desktopFusionEvidence.dataset.overlayClickGuard = "blocked";
    els.desktopFusionEvidence.dataset.noAutoSubmit = "true";
  }
  if (els.desktopFusionConsole) els.desktopFusionConsole.dataset.fusionState = "blocked";
  setStatus(t("desktopFusionBlocked"), false);
  updateDesktopFusionControls();
}

async function showDesktopPromptDraftFromOverlay() {
  setMascotState("suggesting");
  await invokeDesktopOverlay("show_main_window");
  els.desktopDraftInput?.focus?.();
  if (els.desktopFusionEvidence) {
    els.desktopFusionEvidence.textContent = t("desktopFusionNeedsDraft");
    els.desktopFusionEvidence.dataset.fusionState = "needs-draft";
    els.desktopFusionEvidence.dataset.overlayClickPrompt = "missing";
    delete els.desktopFusionEvidence.dataset.overlayClickGuard;
    els.desktopFusionEvidence.dataset.noAutoSubmit = "true";
  }
  if (els.desktopFusionConsole) els.desktopFusionConsole.dataset.fusionState = "needs-draft";
  setStatus(t("desktopFusionNeedsDraft"), false);
  renderDesktopPromptHandoff("needs-draft");
  updateDesktopFusionControls();
  await hideDesktopMascotOverlay();
}

async function showDesktopPromptEditorFromOverlay() {
  const promptReady = Boolean(els.desktopGeneratedPrompt?.value?.trim() || els.desktopDraftInput?.value?.trim());
  setMascotState("suggesting");
  await invokeDesktopOverlay("show_main_window");
  if (els.desktopGeneratedPrompt?.value?.trim()) els.desktopGeneratedPrompt.focus?.();
  else els.desktopDraftInput?.focus?.();
  if (els.desktopFusionEvidence) {
    els.desktopFusionEvidence.textContent = promptReady ? t("desktopFusionGenerated") : t("desktopFusionNeedsDraft");
    els.desktopFusionEvidence.dataset.fusionState = promptReady ? "generated" : "needs-draft";
    els.desktopFusionEvidence.dataset.overlayClickPrompt = promptReady ? "edit" : "missing";
    delete els.desktopFusionEvidence.dataset.overlayClickGuard;
    els.desktopFusionEvidence.dataset.noAutoSubmit = "true";
  }
  if (els.desktopFusionConsole) els.desktopFusionConsole.dataset.fusionState = promptReady ? "generated" : "needs-draft";
  setStatus(promptReady ? t("desktopFusionGenerated") : t("desktopFusionNeedsDraft"), promptReady);
  renderDesktopPromptHandoff(promptReady ? "ready" : "needs-draft");
  updateDesktopFusionControls();
  await hideDesktopMascotOverlay();
}

function getDesktopOverlayDraftText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, DESKTOP_OVERLAY_DRAFT_MAX_LENGTH);
}

async function handleMascotOverlayDraftSubmission(submission = {}) {
  const draft = getDesktopOverlayDraftText(submission.text);
  if (!draft) return;
  clearCodexUndo("goal_changed");
  const overlayPayload = submission.payload || {};
  applyMascotOverlayLocale(overlayPayload);
  const nextMode = getMascotOverlayPromptMode(overlayPayload);
  setDesktopPromptMode(nextMode, { updateControls: false });
  if (els.desktopDraftInput) els.desktopDraftInput.value = draft;
  if (els.desktopGeneratedPrompt) {
    els.desktopGeneratedPrompt.value = "";
    delete els.desktopGeneratedPrompt.dataset.generatedBy;
    delete els.desktopGeneratedPrompt.dataset.promptLength;
  }
  if (desktopOverlayState.lastPayload) {
    desktopOverlayState.lastPayload = {
      ...desktopOverlayState.lastPayload,
      overlayMode: "expanded",
      state: "suggesting",
      promptReady: true,
      promptKind: "draft",
      promptMode: nextMode
    };
  }
  setMascotState("suggesting");
  if (els.desktopFusionEvidence) {
    els.desktopFusionEvidence.textContent = t("desktopFusionDraftReady");
    els.desktopFusionEvidence.dataset.fusionState = "draft";
    els.desktopFusionEvidence.dataset.overlayDraftSubmitted = "true";
    els.desktopFusionEvidence.dataset.overlayDraftLength = String(draft.length);
    els.desktopFusionEvidence.dataset.noAutoSubmit = "true";
    delete els.desktopFusionEvidence.dataset.overlayClickGuard;
  }
  if (els.desktopFusionConsole) els.desktopFusionConsole.dataset.fusionState = "draft";
  updateDesktopFusionControls();
  updateDesktopMascotOverlayState("suggesting");
  setStatus(t("desktopFusionDraftReady"), true);
  scheduleDesktopPromptStateSync();
}

function handleMascotOverlayOutcome(overlayAction) {
  const label = overlayAction === "outcome-good" ? "success" : "needs-work";
  const needsFix = overlayAction === "outcome-fix";
  if (needsFix && els.desktopGeneratedPrompt) {
    els.desktopGeneratedPrompt.value = "";
    delete els.desktopGeneratedPrompt.dataset.generatedBy;
    delete els.desktopGeneratedPrompt.dataset.promptLength;
  }
  const draftReady = Boolean(els.desktopDraftInput?.value?.trim());
  setMascotState(needsFix ? "suggesting" : "clapping");
  if (els.desktopFusionEvidence) {
    els.desktopFusionEvidence.textContent = needsFix && draftReady
      ? t("desktopFusionDraftReady")
      : t("outcomeRecorded", { label });
    els.desktopFusionEvidence.dataset.overlayOutcome = label;
    els.desktopFusionEvidence.dataset.overlayOutcomeSource = "mascot-overlay";
    els.desktopFusionEvidence.dataset.fusionState = needsFix ? (draftReady ? "draft" : "needs-draft") : "filled";
    els.desktopFusionEvidence.dataset.revisionRequested = String(needsFix);
    els.desktopFusionEvidence.dataset.noAutoSubmit = "true";
  }
  if (els.desktopFusionConsole && needsFix) {
    els.desktopFusionConsole.dataset.fusionState = draftReady ? "draft" : "needs-draft";
  }
  if (desktopOverlayState.lastPayload) {
    desktopOverlayState.lastPayload = {
      ...desktopOverlayState.lastPayload,
      overlayMode: "expanded",
      state: needsFix ? "suggesting" : "clapping",
      promptReady: needsFix ? draftReady : desktopOverlayState.lastPayload.promptReady,
      promptKind: needsFix ? (draftReady ? "draft" : "none") : desktopOverlayState.lastPayload.promptKind,
      promptMode: desktopPromptMode
    };
    updateDesktopMascotOverlayState(desktopOverlayState.lastPayload.state);
  }
  if (needsFix) {
    updateDesktopFusionControls();
    scheduleDesktopPromptStateSync();
  }
  setStatus(t("outcomeRecorded", { label }), true);
}

async function handleMascotOverlayClick(overlayPayload = null) {
  setMascotState("thinking");
  const overlayAction = getMascotOverlayAction(overlayPayload);
  const codexOverlay = String(overlayPayload?.profile || "").toLowerCase() === "codex"
    || overlayPayload?.codexAdapterReady === true;
  applyMascotOverlayLocale(overlayPayload || {});
  if (overlayAction === "open") {
    if (codexOverlay || String(desktopOverlayState.fastState?.detectedToolProfile || "").toLowerCase() === "codex") {
      await openCodexPromptSession({ source: "overlay" });
    } else {
      await refreshDesktopSnapshot({
        source: "overlay-open",
        silent: true,
        overlayState: "suggesting",
        overlayMode: "expanded"
      });
    }
    return;
  }
  if (overlayAction === "invalidate-undo") {
    clearCodexUndo("goal_changed");
    return;
  }
  if (["outcome-completed", "outcome-not-completed", "outcome-reason"].includes(overlayAction)) {
    await submitCodexOutcomeFeedback(overlayPayload || {});
    return;
  }
  if (overlayAction === "candidate-ignore") {
    await ignoreCodexLearningCandidate(overlayPayload || {});
    return;
  }
  if (overlayAction === "candidate-review") {
    await reviewCodexLearningCandidate(overlayPayload || {});
    return;
  }
  if (overlayAction === "undo") {
    if (codexOverlay) await undoCodexTargetInsert();
    else await blockMascotOverlayClick();
    return;
  }
  if (overlayAction === "outcome-good" || overlayAction === "outcome-fix") {
    handleMascotOverlayOutcome(overlayAction);
    return;
  }
  if (overlayAction === "refresh") {
    if (codexOverlay) {
      await refreshCodexAdapterInspect({
        silent: true,
        state: "suggesting",
        overlayMode: "expanded"
      });
    } else {
      await refreshDesktopSnapshot({
        source: "overlay-refresh",
        silent: true,
        overlayState: "suggesting",
        overlayMode: "expanded"
      });
    }
    setMascotState("suggesting");
    setStatus(t("desktopInputInspected"), true);
    return;
  }
  if (overlayAction === "mode") {
    const nextMode = getMascotOverlayPromptMode(overlayPayload);
    setDesktopPromptMode(nextMode, { updateControls: false });
    if (desktopOverlayState.lastPayload) {
      desktopOverlayState.lastPayload = {
        ...desktopOverlayState.lastPayload,
        overlayMode: "expanded",
        promptMode: nextMode
      };
    }
    updateDesktopFusionControls();
    updateDesktopMascotOverlayState("suggesting");
    setMascotState("suggesting");
    setStatus(t("desktopModeSelected", { mode: nextMode }), true);
    return;
  }
  if (overlayAction === "locale") {
    const nextLocale = getMascotOverlayLocale(overlayPayload);
    if (desktopOverlayState.lastPayload) {
      desktopOverlayState.lastPayload = {
        ...desktopOverlayState.lastPayload,
        overlayMode: "expanded",
        locale: nextLocale
      };
    }
    updateDesktopFusionControls();
    updateDesktopMascotOverlayState("suggesting");
    setMascotState("suggesting");
    setStatus(t("desktopLocaleSelected", { locale: nextLocale === "zh-CN" ? t("localeZh") : t("localeEn") }), true);
    return;
  }
  if (overlayAction === "generate") {
    const nextMode = getMascotOverlayPromptMode(overlayPayload);
    setDesktopPromptMode(nextMode, { updateControls: false });
    prepareMascotOverlayGenerateInput(overlayPayload);
    if (desktopOverlayState.lastPayload) {
      desktopOverlayState.lastPayload = {
        ...desktopOverlayState.lastPayload,
        overlayMode: "expanded",
        promptMode: nextMode
      };
    }
    if (!els.desktopDraftInput?.value?.trim()) {
      await showDesktopPromptEditorFromOverlay();
      return;
    }
    updateDesktopMascotOverlayState("thinking");
    await generateDesktopPrompt();
    if (desktopOverlayState.visible && desktopOverlayState.lastPayload) {
      desktopOverlayState.lastPayload = {
        ...desktopOverlayState.lastPayload,
        overlayMode: "expanded",
        promptMode: desktopPromptMode
      };
      updateDesktopMascotOverlayState("suggesting");
    }
    return;
  }
  if (overlayAction === "draft" || overlayAction === "review") {
    applyMascotOverlayPromptText(overlayPayload);
    await showDesktopPromptEditorFromOverlay();
    return;
  }
  if (codexOverlay && overlayAction === "fill") {
    const overlayPromptText = getMascotOverlayPromptText(overlayPayload);
    if (overlayPromptText !== null) applyMascotOverlayPromptText(overlayPayload);
    const prompt = overlayPromptText !== null
      ? overlayPromptText
      : els.desktopGeneratedPrompt?.value?.trim() || "";
    if (prompt) await fillCodexTargetInput(prompt);
    else await showDesktopPromptDraftFromOverlay();
    return;
  }
  let readiness = getDesktopSnapshotReadiness();
  if (overlayPayload?.visualOnly === true && overlayAction === "fill") {
    await blockMascotOverlayClick();
    return;
  }
  if (!readiness.ready || !isMascotOverlayPayloadAligned(overlayPayload, readiness)) {
    await refreshDesktopSnapshot({ source: "overlay", silent: true, overlayState: "thinking" });
    readiness = getDesktopSnapshotReadiness();
  }
  if (!readiness.ready || !isMascotOverlayPayloadAligned(overlayPayload, readiness)) {
    await blockMascotOverlayClick();
    return;
  }
  const overlayPromptText = getMascotOverlayPromptText(overlayPayload);
  if (overlayPromptText !== null) applyMascotOverlayPromptText(overlayPayload);
  const prompt = overlayPromptText !== null
    ? overlayPromptText
    : els.desktopGeneratedPrompt.value.trim() || els.desktopDraftInput.value.trim();
  if (!overlayAction) {
    if (!prompt) {
      await showDesktopPromptDraftFromOverlay();
      return;
    }
    await blockMascotOverlayClick();
    return;
  }
  if (overlayAction !== "fill") {
    await blockMascotOverlayClick();
    return;
  }
  if (prompt) {
    await fillForegroundInput(prompt);
    return;
  }
  await showDesktopPromptDraftFromOverlay();
}

async function runDesktopSelfTestFill() {
  setMascotState("thinking");
  const text = els.desktopFillText.value || "Smart Prompt desktop companion self-test";
  const result = await serviceRequest("/desktop/fill?selfTest=1", {
    method: "POST",
    body: JSON.stringify({ text })
  });
  renderDesktopFillResult(result);
  setStatus(t("desktopFillComplete"), Boolean(result.fill?.pass));
}

async function refreshLearningReports() {
  const [reflections, candidates] = await Promise.all([
    serviceRequest("/learning/reflections", { method: "GET" }),
    serviceRequest("/learning/evolution-candidates", { method: "GET" })
  ]);
  renderLearningDashboard(reflections, candidates);
  setStatus(t("learningRefreshed"), true);
}

async function recordOutcomeFollowup(generationId, outcomeLabel) {
  if (!generationId || !outcomeLabel) return;
  const result = await serviceRequest("/outcomes/follow-up", {
    method: "POST",
    body: JSON.stringify({ generationId, outcomeLabel })
  });
  renderOutcomeFollowups(result);
  await Promise.all([
    refreshPilotOutcomes().catch((error) => warnAsyncFailure("refresh-pilot-outcomes-after-followup", error)),
    refreshQualityLift().catch((error) => warnAsyncFailure("refresh-quality-lift-after-followup", error)),
    refreshQualityLiftSegments().catch((error) => warnAsyncFailure("refresh-quality-lift-segments-after-followup", error))
  ]);
  setStatus(t("outcomeRecorded", { label: outcomeLabel }), true);
}

function handleOutcomeFollowupAction(event) {
  const button = event.target.closest('button[data-action="record-outcome-followup"]');
  if (!button) return;
  recordOutcomeFollowup(decodeURIComponent(button.dataset.generationId || ""), button.dataset.outcomeLabel || "")
    .catch((error) => setStatus(error.message, false));
}

async function clearLocalData() {
  const confirmed = typeof window.confirm === "function"
    ? window.confirm(currentLocale === "zh-CN" ? "清空所有 Smart Prompt 本地数据？" : "Clear all local Smart Prompt data?")
    : true;
  if (!confirmed) return;
  const result = await serviceRequest("/data/all", { method: "DELETE" });
  serviceAuthToken = "";
  localStorage.removeItem("smartPromptProviderTestPass");
  localStorage.removeItem("smartPromptProviderTestedAt");
  els.diagnosticsOutput.textContent = JSON.stringify(result.deleted, null, 2);
  els.diagnosticsOutput.dataset.clearAllLocalData = "true";
  setStatus(t("localDataCleared"), true);
  await loadServiceState();
}

if (!phase3ControlCenterActive) {
els.saveSettings.addEventListener("click", () => saveSettings().catch((error) => setStatus(error.message, false)));
els.startService.addEventListener("click", () => startLocalService().catch((error) => setStatus(error.message, false)));
els.stopService.addEventListener("click", () => stopLocalService().catch((error) => setStatus(error.message, false)));
els.restartService.addEventListener("click", () => restartLocalService().catch((error) => setStatus(error.message, false)));
els.testProvider.addEventListener("click", () => testProvider().catch((error) => setStatus(error.message, false)));
els.refreshPilotOutcomes.addEventListener("click", () => refreshPilotOutcomes().catch((error) => setStatus(error.message, false)));
els.refreshQualityLift.addEventListener("click", () => refreshQualityLift().catch((error) => setStatus(error.message, false)));
els.refreshQualityLiftSegments.addEventListener("click", () => refreshQualityLiftSegments().catch((error) => setStatus(error.message, false)));
els.refreshOutcomeFollowups.addEventListener("click", () => refreshOutcomeFollowups().catch((error) => setStatus(error.message, false)));
els.refreshDesktopSnapshot.addEventListener("click", () => refreshDesktopSnapshot().catch((error) => setStatus(error.message, false)));
els.desktopMascotButton.addEventListener("click", () => activateDesktopMascot().catch((error) => setStatus(error.message, false)));
els.generateDesktopPrompt.addEventListener("click", () => generateDesktopPrompt().catch((error) => setStatus(error.message, false)));
els.fillForegroundInput.addEventListener("click", () => fillForegroundInput().catch((error) => setStatus(error.message, false)));
els.runDesktopSelfTest.addEventListener("click", () => runDesktopSelfTestFill().catch((error) => setStatus(error.message, false)));
els.refreshLearning.addEventListener("click", () => refreshLearningReports().catch((error) => setStatus(error.message, false)));
els.exportDiagnostics.addEventListener("click", () => exportDiagnostics().catch((error) => setStatus(error.message, false)));
els.clearLocalData.addEventListener("click", () => clearLocalData().catch((error) => setStatus(error.message, false)));
els.importFolder.addEventListener("click", () => importFolder().catch((error) => setStatus(error.message, false)));
els.savePrompt.addEventListener("click", () => savePrompt().catch((error) => setStatus(error.message, false)));
els.skillList.addEventListener("click", handleSkillListAction);
els.promptList.addEventListener("click", handlePromptListAction);
els.outcomeFollowupList.addEventListener("click", handleOutcomeFollowupAction);
els.provider.addEventListener("change", applyProviderDefaults);
els.desktopDraftInput.addEventListener("input", () => {
  clearCodexUndo("goal_changed");
  updateDesktopFusionControls();
  scheduleDesktopPromptStateSync();
});
els.desktopGeneratedPrompt.addEventListener("input", () => {
  clearCodexUndo("goal_changed");
  updateDesktopFusionControls();
  scheduleDesktopPromptStateSync();
});
els.uiLocale.addEventListener("change", () => {
  setLocaleSetting(els.uiLocale.value || "auto");
  loadServiceState();
});
els.saveShortcut.addEventListener("click", () => saveShortcut().catch((error) => setStatus(error.message, false)));
applyLocale(getStoredLocaleSetting());
setStatus(t("checking"), false);
els.providerTestStatus.textContent = t("providerTestNotRun");
els.diagnosticsOutput.textContent = t("diagnosticsEmpty");
els.shortcut.value = localStorage.getItem("smartPromptShortcut") || els.shortcut.value;
window.__smartPromptShortcutHits = 0;
renderDesktopFusionSurface(null);
refreshLocalServiceStatus().catch((error) => warnAsyncFailure("initial-local-service-status", error));
loadServiceState();
}

window.__smartPromptEventsReady = false;
bindControlCenterLearningBridge();
bindTauriEvents().catch((error) => setStatus(error.message, false));
bindDesktopShellVisibilityGuard();
startDesktopOverlayAutoDetectWhenReady();

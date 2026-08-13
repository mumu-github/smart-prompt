(function initSmartPromptControlCenter(root) {
  const SERVICE_URL = root.__SMART_PROMPT_SERVICE_URL__ || "http://127.0.0.1:17371";
  const ACTIVATION_CONTRACT = "phase3-activation@1";
  const CODEX_ACTIVATION_CONTRACT = "codex-activation@2";
  const NATIVE_SERVICE_VERSION = "0.5.0-native";
  const NATIVE_RUNTIME_CONTRACT = "phase3-native-runtime@1";
  const NATIVE_BUILD_ID = "phase3-native-sidecar-20260719-r18";
  const EXTENSION_DETECTION_TIMEOUT_MS = 12000;
  const PROVIDERS = Object.freeze(["agnes", "openai-compatible", "anthropic", "gemini", "custom"]);
  const CUSTOM_PROVIDER_PROTOCOLS = Object.freeze(["openai-compatible", "anthropic", "gemini"]);
  const CUSTOM_MODEL_VALUE = "__custom__";
  const MODEL_ID_MAX_LENGTH = 200;
  const CUSTOM_PROVIDER_NAME_MAX_LENGTH = 80;
  const CONTROL_LOCALES = Object.freeze(["zh-CN", "en"]);
  const CONTROL_PAGES = Object.freeze(["overview", "model", "learning", "privacy", "diagnostics"]);
  const PROVIDER_DEFAULTS = Object.freeze({
    agnes: { baseUrl: "https://apihub.agnes-ai.com/v1", model: "agnes-2.0-flash" },
    "openai-compatible": { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
    anthropic: { baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-20250514" },
    gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-flash" },
    custom: { baseUrl: "", model: "" }
  });
  const PROVIDER_MODEL_PRESETS = Object.freeze({
    agnes: Object.freeze([PROVIDER_DEFAULTS.agnes.model]),
    "openai-compatible": Object.freeze([PROVIDER_DEFAULTS["openai-compatible"].model]),
    anthropic: Object.freeze([PROVIDER_DEFAULTS.anthropic.model]),
    gemini: Object.freeze([PROVIDER_DEFAULTS.gemini.model]),
    custom: Object.freeze([])
  });
  const CONTROL_COPY = Object.freeze({
    "zh-CN": Object.freeze({
      brandSubtitle: "本地 Prompt 助手",
      checking: "正在检查",
      tray: "收起到托盘",
      activationEyebrow: "首次激活",
      activationTitle: "两步开始使用",
      step1: "第 1 步",
      connectModel: "连接你的模型",
      localConnectivity: "只测试本地连通性",
      provider: "Provider",
      customProvider: "自定义 Provider",
      providerName: "Provider 名称",
      providerNamePlaceholder: "例如：公司模型网关",
      protocol: "接口协议",
      apiKey: "Provider API Key",
      apiKeyPlaceholder: "输入当前 Provider Key",
      model: "模型",
      customModelId: "自定义模型 ID",
      customModelPlaceholder: "输入完整模型 ID",
      advanced: "高级设置",
      saveTestReady: "保存并测试模型连通性",
      saveAndTest: "保存并测试",
      step2: "第 2 步",
      firstLoop: "完成一次真实核心循环",
      neverSend: "不会自动发送",
      browserTargetDescription: "聚焦 Codex 输入框，点击旁边的小人生成并填入一次；系统会机器回读，且绝不自动发送。",
      browserReady: "模型已就绪，下一步在 Codex 完成一次安全写回",
      openChatgpt: "收起并去 Codex 验证",
      redetect: "重新检测",
      redetectTitle: "重新检测激活状态",
      localRuntime: "本地运行",
      reconnectTitle: "需要重新连接",
      reconnectDescription: "当前功能暂时不可用。重新连接后会继续保留已有设置。",
      reconnect: "重新连接",
      controlCenter: "控制中心",
      activated: "已激活",
      activationIncomplete: "未完成激活",
      navLabel: "控制中心页面",
      overview: "概览",
      modelPage: "模型",
      learning: "学习",
      privacy: "隐私",
      diagnostics: "诊断",
      currentStatus: "当前状态",
      overviewTitle: "Codex 使用状态",
      codexCompanionTitle: "日常使用在 Codex 输入框旁完成",
      codexCompanionDescription: "控制中心只处理模型、学习内容、隐私和诊断，不提供第二个 Prompt 工作台。",
      modelEyebrow: "Provider",
      modelTitle: "模型连接",
      currentProviderOnly: "只显示当前 Provider",
      privacyEyebrow: "边界",
      privacyTitle: "隐私与本地数据",
      privacyPrompt: "Prompt 正文不进入激活状态",
      privacyPage: "页面正文、标题和 DOM 文本不上传",
      privacyMetadata: "激活只记录脱敏状态和有限事件 ID",
      privacySubmit: "任何写回都不自动提交",
      resetTitle: "重新开始激活",
      resetDescription: "当前数据会先移动到本地可恢复归档，不会永久删除。",
      recoverableReset: "可恢复重置",
      resetIdle: "没有执行重置",
      diagnosticsEyebrow: "应用状态",
      diagnosticsTitle: "诊断",
      refresh: "刷新",
      diagnosticsIdle: "尚未加载诊断",
      diagnosticsDescription: "导出内容只包含运行元数据、计数和隐私边界，不包含 Prompt、输入或 API Key。",
      exportDiagnostics: "导出诊断",
      language: "界面语言",
      languageZh: "中文",
      languageEn: "English",
      credentialSaved: "已保存，留空不会覆盖",
      credentialMissing: "尚未保存",
      keySavedPlaceholder: "已保存 Provider Key；留空继续使用",
      recommendedModel: "推荐",
      testStarting: "正在测试模型连通性",
      testRequired: "先完成模型连通性测试",
      extensionMissing: "尚未收到 Codex 的机器回读，请聚焦输入框后重试",
      extensionConnected: "Codex 已就绪，等待一次经过机器回读的安全写回",
      extensionWaiting: "等待 Codex 安全写回验证；不会自动发送",
      openAfterTest: "先测试模型",
      openedWaiting: "控制中心已收起，请在 Codex 输入框旁完成一次安全写回",
      openFailed: "无法进入 Codex 验证，请重新连接本地功能后重试",
      activationUnavailable: "暂时无法读取激活状态",
      detectingExtension: "正在重新读取 Codex 验证状态",
      runtimeHealthy: "本地功能正常",
      runtimeConnecting: "正在连接本地功能",
      runtimeRepair: "本地功能需要恢复",
      runtimeRestarting: "正在重新连接",
      runtimeStillUnavailable: "仍无法连接，请稍后重试",
      firstLoopComplete: "旧版核心循环已完成",
      awaitingActivation: "等待激活",
      codexReady: "可用",
      codexPending: "尚未验证",
      codexNeedsRepair: "需要处理",
      noRecentLoop: "暂无 Codex 闭环",
      noPendingIssue: "没有待处理问题",
      finishCodexVerification: "完成 Codex 安全写回验证",
      metricsCodex: "Codex",
      metricsRecent: "最近闭环",
      metricsPending: "待处理",
      metricsSafety: "安全写回",
      safetyVerified: "已验证且未发送",
      safetyPending: "等待机器回读验证",
      learningEyebrow: "已学到的内容",
      learningTitle: "学习管理",
      learningDescription: "在这里审核项目经验、确认全局使用，并查看可回滚的生成策略。",
      learningStatusReady: "学习内容已就绪",
      learningStatusEmpty: "暂无学习内容",
      learnedAssets: "项目经验",
      learnedAssetsDescription: "已确认的 Memory、Rule 和 Skill 只在标注的范围内生效。",
      candidates: "待审核候选",
      candidatesDescription: "候选不会阻塞生成，也不会在审核前生效。",
      promotions: "全局使用提案",
      promotionsDescription: "跨项目生效前始终需要你确认。",
      policies: "生成策略版本",
      policiesDescription: "低风险调整可小范围试用，出现问题时可恢复上一版。",
      learningAutomation: "自动策略学习",
      learningAutomationActive: "正在根据真实结果收集低风险策略证据；不会自行发起付费实验。",
      learningAutomationPaused: "已暂停新的策略灰度与自动晋级；现有稳定版本继续工作。",
      pauseLearning: "暂停学习",
      resumeLearning: "恢复学习",
      memory: "Memory",
      rule: "Rule",
      skill: "Skill",
      policy: "Policy",
      projectScope: "当前项目",
      globalScope: "所有项目",
      active: "使用中",
      paused: "已停用",
      pendingReview: "待审核",
      confirmed: "已确认",
      canary: "小范围试用",
      stable: "稳定版本",
      rolledBack: "已回滚",
      draft: "草稿",
      benchmarked: "已验证",
      noAssets: "还没有已确认的项目经验。",
      noCandidates: "当前没有待审核候选。",
      noPromotions: "当前没有全局使用提案。",
      noPolicies: "当前没有可管理的策略版本。",
      review: "审核",
      ignore: "忽略提醒",
      pause: "停用",
      resume: "启用",
      confirmGlobal: "确认全局使用",
      dismiss: "暂不采用",
      startCanary: "开始 10% 试用",
      rollback: "回滚",
      version: "版本",
      canaryShare: "试用范围",
      baseline: "上一稳定版",
      successfulExamples: "成功样本",
      projects: "项目数",
      learningActionSubmitted: "操作已提交。",
      learningActionUnavailable: "当前运行版本暂时无法保存此操作。",
      errorCredential: "凭证无效或权限不足",
      errorModelUnavailable: "模型不可用",
      errorModelInvalid: "请输入有效的模型 ID",
      errorCustomName: "请输入有效的 Provider 名称",
      errorCustomProtocol: "请选择受支持的接口协议",
      errorCustomUrl: "请输入有效的 HTTP 或 HTTPS Base URL",
      errorNetwork: "无法连接 Provider",
      errorProvider: "Provider 暂时不可用"
    }),
    en: Object.freeze({
      brandSubtitle: "Local prompt assistant",
      checking: "Checking",
      tray: "Minimize to tray",
      activationEyebrow: "First setup",
      activationTitle: "Start in two steps",
      step1: "Step 1",
      connectModel: "Connect your model",
      localConnectivity: "Tests local connectivity only",
      provider: "Provider",
      customProvider: "Custom provider",
      providerName: "Provider name",
      providerNamePlaceholder: "Example: Team model gateway",
      protocol: "API protocol",
      apiKey: "Provider API Key",
      apiKeyPlaceholder: "Enter the current Provider key",
      model: "Model",
      customModelId: "Custom model ID",
      customModelPlaceholder: "Enter the full model ID",
      advanced: "Advanced settings",
      saveTestReady: "Save and test model connectivity",
      saveAndTest: "Save and test",
      step2: "Step 2",
      firstLoop: "Complete one real core loop",
      neverSend: "Never sends automatically",
      browserTargetDescription: "Focus the Codex input, open the nearby assistant, then generate and insert once. Smart Prompt verifies the exact text and never submits it.",
      browserReady: "The model is ready. Complete one safe insert in Codex.",
      openChatgpt: "Hide and verify in Codex",
      redetect: "Check again",
      redetectTitle: "Check activation again",
      localRuntime: "Local runtime",
      reconnectTitle: "Reconnect required",
      reconnectDescription: "The current features are temporarily unavailable. Existing settings are preserved while reconnecting.",
      reconnect: "Reconnect",
      controlCenter: "Control Center",
      activated: "Activated",
      activationIncomplete: "Activation incomplete",
      navLabel: "Control Center pages",
      overview: "Overview",
      modelPage: "Model",
      learning: "Learning",
      privacy: "Privacy",
      diagnostics: "Diagnostics",
      currentStatus: "Current status",
      overviewTitle: "Codex status",
      codexCompanionTitle: "Daily use stays beside the Codex input",
      codexCompanionDescription: "Control Center manages models, learned content, privacy, and diagnostics. It is not a second prompt workspace.",
      modelEyebrow: "Provider",
      modelTitle: "Model connection",
      currentProviderOnly: "Current Provider only",
      privacyEyebrow: "Boundaries",
      privacyTitle: "Privacy and local data",
      privacyPrompt: "Prompt text is not stored in activation state",
      privacyPage: "Page body, title, and DOM text are not uploaded",
      privacyMetadata: "Activation stores redacted state and limited event IDs only",
      privacySubmit: "Insert actions never submit automatically",
      resetTitle: "Restart activation",
      resetDescription: "Current data moves to a recoverable local archive and is never permanently deleted.",
      recoverableReset: "Recoverable reset",
      resetIdle: "No reset has run",
      diagnosticsEyebrow: "App status",
      diagnosticsTitle: "Diagnostics",
      refresh: "Refresh",
      diagnosticsIdle: "Diagnostics have not been loaded",
      diagnosticsDescription: "Exports include runtime metadata, counts, and privacy boundaries only. No prompts, input, or API keys.",
      exportDiagnostics: "Export diagnostics",
      language: "Interface language",
      languageZh: "中文",
      languageEn: "English",
      credentialSaved: "Saved; leaving this blank keeps it",
      credentialMissing: "Not saved",
      keySavedPlaceholder: "Provider key saved; leave blank to keep using it",
      recommendedModel: "Recommended",
      testStarting: "Testing model connectivity",
      testRequired: "Test model connectivity first",
      extensionMissing: "No Codex machine readback yet. Focus the input and try again.",
      extensionConnected: "Codex is ready; waiting for one machine-verified safe insert",
      extensionWaiting: "Waiting for Codex safe-insert verification; nothing will be submitted",
      openAfterTest: "Test model first",
      openedWaiting: "Control Center is hidden. Complete one safe insert beside the Codex input.",
      openFailed: "Codex verification could not start. Reconnect local features and try again.",
      activationUnavailable: "Activation status is temporarily unavailable",
      detectingExtension: "Refreshing Codex verification status",
      runtimeHealthy: "Local features available",
      runtimeConnecting: "Connecting local features",
      runtimeRepair: "Local features need recovery",
      runtimeRestarting: "Reconnecting",
      runtimeStillUnavailable: "Still unavailable. Try again shortly.",
      firstLoopComplete: "Legacy core loop complete",
      awaitingActivation: "Waiting for activation",
      codexReady: "Available",
      codexPending: "Not verified",
      codexNeedsRepair: "Needs attention",
      noRecentLoop: "No Codex loop yet",
      noPendingIssue: "No pending issues",
      finishCodexVerification: "Complete Codex safe-insert verification",
      metricsCodex: "Codex",
      metricsRecent: "Latest loop",
      metricsPending: "Needs attention",
      metricsSafety: "Safe insert",
      safetyVerified: "Verified and not sent",
      safetyPending: "Waiting for machine readback",
      learningEyebrow: "Learned content",
      learningTitle: "Learning management",
      learningDescription: "Review project experience, approve global use, and manage rollback-ready generation policies.",
      learningStatusReady: "Learned content is ready",
      learningStatusEmpty: "No learned content yet",
      learnedAssets: "Project experience",
      learnedAssetsDescription: "Approved Memory, Rule, and Skill items apply only within their stated scope.",
      candidates: "Candidates to review",
      candidatesDescription: "Candidates never block generation or take effect before review.",
      promotions: "Global-use proposals",
      promotionsDescription: "Cross-project use always requires your confirmation.",
      policies: "Generation policy versions",
      policiesDescription: "Low-risk changes can run on a small share and return to the previous version when needed.",
      learningAutomation: "Automatic policy learning",
      learningAutomationActive: "Collecting evidence from real outcomes for low-risk policies; no paid experiments start automatically.",
      learningAutomationPaused: "New rollouts and automatic promotions are paused; the current stable version remains active.",
      pauseLearning: "Pause learning",
      resumeLearning: "Resume learning",
      memory: "Memory",
      rule: "Rule",
      skill: "Skill",
      policy: "Policy",
      projectScope: "Current project",
      globalScope: "All projects",
      active: "Active",
      paused: "Paused",
      pendingReview: "Review needed",
      confirmed: "Confirmed",
      canary: "Small rollout",
      stable: "Stable",
      rolledBack: "Rolled back",
      draft: "Draft",
      benchmarked: "Validated",
      noAssets: "No approved project experience yet.",
      noCandidates: "No candidates need review.",
      noPromotions: "No global-use proposals are waiting.",
      noPolicies: "No policy versions are available to manage.",
      review: "Review",
      ignore: "Hide reminder",
      pause: "Pause",
      resume: "Enable",
      confirmGlobal: "Approve global use",
      dismiss: "Not now",
      startCanary: "Start 10% rollout",
      rollback: "Roll back",
      version: "Version",
      canaryShare: "Rollout share",
      baseline: "Previous stable",
      successfulExamples: "Successful examples",
      projects: "Projects",
      learningActionSubmitted: "Action submitted.",
      learningActionUnavailable: "This runtime cannot save that action yet.",
      errorCredential: "Credentials are invalid or lack permission",
      errorModelUnavailable: "Model unavailable",
      errorModelInvalid: "Enter a valid model ID",
      errorCustomName: "Enter a valid Provider name",
      errorCustomProtocol: "Choose a supported API protocol",
      errorCustomUrl: "Enter a valid HTTP or HTTPS Base URL",
      errorNetwork: "Provider cannot be reached",
      errorProvider: "Provider is temporarily unavailable"
    })
  });

  const ERROR_COPY_KEYS = Object.freeze({
    credential_invalid: "errorCredential",
    model_unavailable: "errorModelUnavailable",
    model_invalid: "errorModelInvalid",
    custom_provider_name_invalid: "errorCustomName",
    custom_provider_protocol_invalid: "errorCustomProtocol",
    custom_provider_base_url_invalid: "errorCustomUrl",
    network_unavailable: "errorNetwork",
    provider_error: "errorProvider"
  });

  function normalizeControlLocale(locale) {
    return String(locale || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en";
  }

  function getControlCopy(locale, key) {
    const selected = CONTROL_COPY[normalizeControlLocale(locale)];
    return selected[key] || CONTROL_COPY.en[key] || String(key || "");
  }

  function normalizeProvider(value) {
    return PROVIDERS.includes(value) ? value : "openai-compatible";
  }

  function modelInputError() {
    const error = new Error("Model ID is required and cannot contain whitespace.");
    error.code = "model_invalid";
    return error;
  }

  function normalizeModelId(value) {
    const model = String(value || "").trim();
    if (!model || model.length > MODEL_ID_MAX_LENGTH || /\s/.test(model)) throw modelInputError();
    return model;
  }

  function customProviderInputError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function normalizeCustomProviderName(value) {
    const name = String(value || "").trim();
    if (!name || name.length > CUSTOM_PROVIDER_NAME_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) {
      throw customProviderInputError("custom_provider_name_invalid", "Custom provider name is invalid.");
    }
    return name;
  }

  function normalizeCustomProviderProtocol(value) {
    const protocol = String(value || "openai-compatible").trim().toLowerCase();
    if (!CUSTOM_PROVIDER_PROTOCOLS.includes(protocol)) {
      throw customProviderInputError("custom_provider_protocol_invalid", "Custom provider protocol is invalid.");
    }
    return protocol;
  }

  function normalizeProviderBaseUrl(value) {
    const baseUrl = String(value || "").trim();
    try {
      const parsed = new URL(baseUrl);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("invalid");
    } catch {
      throw customProviderInputError("custom_provider_base_url_invalid", "Custom provider Base URL is invalid.");
    }
    return baseUrl.replace(/\/+$/, "");
  }

  function getCustomProviderSettings(settings = {}) {
    const source = settings.customProvider && typeof settings.customProvider === "object"
      ? settings.customProvider
      : {};
    return {
      name: String(source.name || "").trim(),
      protocol: CUSTOM_PROVIDER_PROTOCOLS.includes(source.protocol) ? source.protocol : "openai-compatible",
      baseUrl: String(source.baseUrl || "").trim(),
      model: String(source.model || "").trim()
    };
  }

  function getModelSelection(provider, configuredModel) {
    const selected = normalizeProvider(provider);
    if (selected === "custom") {
      const model = String(configuredModel || "").trim();
      return {
        choice: CUSTOM_MODEL_VALUE,
        customModel: model,
        isCustom: true,
        model
      };
    }
    const model = String(configuredModel || PROVIDER_DEFAULTS[selected].model).trim()
      || PROVIDER_DEFAULTS[selected].model;
    const isCustom = !PROVIDER_MODEL_PRESETS[selected].includes(model);
    return {
      choice: isCustom ? CUSTOM_MODEL_VALUE : model,
      customModel: isCustom ? model : "",
      isCustom,
      model
    };
  }

  function resolveModelValue({ provider, choice, customModel } = {}) {
    const selected = normalizeProvider(provider);
    if (selected === "custom") return normalizeModelId(customModel);
    if (choice === CUSTOM_MODEL_VALUE) return normalizeModelId(customModel);
    if (PROVIDER_MODEL_PRESETS[selected].includes(choice)) return choice;
    return PROVIDER_DEFAULTS[selected].model;
  }

  function getProviderCredentialState(provider, providerKeys = {}, locale = "zh-CN") {
    const configured = Boolean(providerKeys?.[normalizeProvider(provider)]);
    return {
      configured,
      label: getControlCopy(locale, configured ? "credentialSaved" : "credentialMissing")
    };
  }

  function buildProviderSettingsPayload({
    provider,
    baseUrl,
    model,
    apiKey,
    customProviderName,
    customProviderProtocol
  } = {}) {
    const selected = normalizeProvider(provider);
    if (selected === "custom") {
      const customProvider = {
        name: normalizeCustomProviderName(customProviderName),
        protocol: normalizeCustomProviderProtocol(customProviderProtocol),
        baseUrl: normalizeProviderBaseUrl(baseUrl),
        model: normalizeModelId(model)
      };
      const payload = {
        provider: selected,
        baseUrl: customProvider.baseUrl,
        model: customProvider.model,
        customProvider
      };
      if (String(apiKey || "").trim()) payload.providerKeys = { custom: String(apiKey).trim() };
      return payload;
    }
    const payload = {
      provider: selected,
      baseUrl: String(baseUrl || "").trim(),
      model: normalizeModelId(model || PROVIDER_DEFAULTS[selected].model)
    };
    if (String(apiKey || "").trim()) payload.providerKeys = { [selected]: String(apiKey).trim() };
    return payload;
  }

  function buildProviderTestPayload(settings, mode = "idea") {
    return {
      mode,
      settings,
      persistOnSuccess: true
    };
  }

  function getProviderKeyPlaceholder(provider, providerKeys = {}, locale = "zh-CN") {
    const redacted = providerKeys?.[normalizeProvider(provider)] || "";
    return getControlCopy(locale, redacted ? "keySavedPlaceholder" : "apiKeyPlaceholder");
  }

  function getProviderRecoveryField(errorCode) {
    return {
      credential_invalid: "key",
      model_unavailable: "model",
      model_invalid: "model",
      custom_provider_name_invalid: "custom-name",
      custom_provider_protocol_invalid: "custom-protocol",
      custom_provider_base_url_invalid: "custom-base-url",
      network_unavailable: "base-url",
      provider_error: "provider"
    }[String(errorCode || "provider_error")] || "provider";
  }

  function isProviderAdvancedField(field) {
    return field === "base-url";
  }

  function getExtensionDetectionStatus({
    browserSeenAt = "",
    waitStartedAt = 0,
    now = Date.now(),
    timeoutMs = EXTENSION_DETECTION_TIMEOUT_MS
  } = {}) {
    if (String(browserSeenAt || "")) return "connected";
    const startedAt = Number(waitStartedAt || 0);
    if (!Number.isFinite(startedAt) || startedAt <= 0) return "idle";
    return Number(now) - startedAt >= Number(timeoutMs) ? "not-detected" : "waiting";
  }

  function getActivationView(activation = {}) {
    if (activation.progress === "activated" && activation.codexVerified === true) {
      return { kind: "control-center", step: "overview" };
    }
    if (activation.modelTestedAt || ["model_ready", "awaiting_codex_loop"].includes(activation.progress)) {
      return { kind: "wizard", step: "codex" };
    }
    return { kind: "wizard", step: "provider" };
  }

  function normalizeError(error = {}, locale = "zh-CN") {
    const code = String(error.code || "provider_error");
    return getControlCopy(locale, ERROR_COPY_KEYS[code] || ERROR_COPY_KEYS.provider_error);
  }

  function shouldShowMainWindow({ serviceHealthy = true, codexActivation = null } = {}) {
    if (!serviceHealthy) return true;
    return codexActivation?.progress !== "activated" || codexActivation?.codexVerified !== true;
  }

  const LEARNING_ACTION_IDS = Object.freeze([
    "candidate-review",
    "candidate-ignore",
    "promotion-confirm",
    "promotion-dismiss",
    "policy-learning-pause",
    "policy-learning-resume",
    "policy-start-canary",
    "policy-rollback"
  ]);

  function publicLearningText(value, maxLength = 240) {
    return String(value || "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);
  }

  function normalizeLearningType(value, fallback = "memory") {
    const type = String(value || "").toLowerCase().replace(/generation[_ -]?policy/, "policy");
    return ["memory", "rule", "skill", "policy"].includes(type) ? type : fallback;
  }

  function learningItemTitle(item, type) {
    const payload = item?.payload && typeof item.payload === "object" ? item.payload : {};
    return publicLearningText(
      item?.title
      || item?.name
      || payload.title
      || payload.statement
      || payload.directive
      || payload.name
      || type,
      120
    );
  }

  function normalizeLearningItem(item = {}, kind = "asset") {
    const type = normalizeLearningType(item.type || item.artifactType || (kind === "policy" ? "policy" : "memory"));
    const evidence = item.evidenceSummary && typeof item.evidenceSummary === "object" ? item.evidenceSummary : {};
    const review = item.review && typeof item.review === "object" ? item.review : {};
    const scopeKind = String(item.scope?.kind || item.scope || "project").toLowerCase();
    const status = publicLearningText(
      item.status || (kind === "candidate" ? "pending_review" : kind === "promotion" ? "pending_review" : "active"),
      40
    );
    return Object.freeze({
      id: publicLearningText(item.id || item.artifactId || item.proposalId || item.policyId, 100),
      type,
      title: learningItemTitle(item, type),
      summary: publicLearningText(item.summary || item.description || item.payload?.summary, 280),
      scope: scopeKind === "global" || scopeKind === "global_proposal" ? "global" : "project",
      status,
      ignoredCount: Math.max(0, Number(review.ignoredCount ?? item.ignoredCount ?? 0) || 0),
      successfulOutcomeCount: Math.max(0, Number(evidence.successfulOutcomeCount ?? item.successfulOutcomeCount ?? 0) || 0),
      projectCount: Math.max(0, Number(item.projectCount ?? item.evidenceSummary?.projectCount ?? 0) || 0),
      version: Math.max(0, Number(item.version ?? item.policyVersion ?? 0) || 0),
      baselineVersion: Math.max(0, Number(item.baselineVersion ?? 0) || 0),
      canaryPercent: Math.max(0, Math.min(100, Number(item.canaryPercent ?? (Number(item.canaryShareBps || 0) / 100)) || 0)),
      effective: item.effective !== false && status !== "paused",
      kind
    });
  }

  function normalizeLearningView(source = {}) {
    const normalizeList = (value, kind) => (Array.isArray(value) ? value : [])
      .map((item) => normalizeLearningItem(item, kind))
      .filter((item) => item.id);
    const artifacts = Array.isArray(source.artifacts) ? source.artifacts : [];
    const candidateSource = source.candidates || source.pendingCandidates
      || artifacts.filter((item) => String(item?.status || "").toLowerCase() === "pending_review");
    const policySource = source.policies || source.policyVersions
      || artifacts.filter((item) => normalizeLearningType(item?.artifactType, "memory") === "policy");
    return Object.freeze({
      learningPaused: source.learningPaused === true,
      assets: Object.freeze(normalizeList(source.assets || artifacts, "asset")
        .filter((item) => ["memory", "rule", "skill"].includes(item.type) && item.status !== "pending_review")),
      candidates: Object.freeze(normalizeList(candidateSource, "candidate")
        .filter((item) => ["memory", "rule", "skill", "policy"].includes(item.type))),
      promotions: Object.freeze(normalizeList(source.promotions || source.proposals, "promotion")
        .filter((item) => ["memory", "rule", "skill"].includes(item.type))),
      policies: Object.freeze(normalizeList(policySource, "policy")
        .map((item) => Object.freeze({ ...item, type: "policy" })))
    });
  }

  function createLearningActionPayload(id, value) {
    const actionId = String(id || "");
    if (!LEARNING_ACTION_IDS.includes(actionId)) return null;
    const actionValue = publicLearningText(value, 100);
    if (!actionValue) return null;
    return Object.freeze({ id: actionId, value: actionValue });
  }

  function learningTypeLabel(type, locale) {
    return getControlCopy(locale, normalizeLearningType(type));
  }

  function learningStatusLabel(status, locale) {
    const key = {
      active: "active",
      accepted: "active",
      effective: "active",
      paused: "paused",
      pending: "pendingReview",
      pending_review: "pendingReview",
      proposed: "pendingReview",
      confirmed: "confirmed",
      canary: "canary",
      collecting: "canary",
      stable: "stable",
      rolled_back: "rolledBack",
      draft: "draft",
      benchmarked: "benchmarked"
    }[String(status || "").toLowerCase()] || "pendingReview";
    return getControlCopy(locale, key);
  }

  function renderLearningRows(items, kind, locale) {
    const copy = CONTROL_COPY[normalizeControlLocale(locale)];
    const emptyKey = {
      asset: "noAssets",
      candidate: "noCandidates",
      promotion: "noPromotions",
      policy: "noPolicies"
    }[kind];
    if (!items.length) return `<p class="learning-empty">${escapeHtml(copy[emptyKey])}</p>`;
    return items.map((item) => {
      const metadata = [];
      if (item.successfulOutcomeCount > 0) metadata.push(`${escapeHtml(copy.successfulExamples)} ${item.successfulOutcomeCount}`);
      if (item.projectCount > 0) metadata.push(`${escapeHtml(copy.projects)} ${item.projectCount}`);
      if (item.version > 0) metadata.push(`${escapeHtml(copy.version)} ${item.version}`);
      if (item.baselineVersion > 0) metadata.push(`${escapeHtml(copy.baseline)} ${item.baselineVersion}`);
      if (item.canaryPercent > 0) metadata.push(`${escapeHtml(copy.canaryShare)} ${item.canaryPercent}%`);
      const scopeLabel = item.scope === "global" ? copy.globalScope : copy.projectScope;
      let actions = "";
      if (kind === "candidate") {
        actions = [
          `<button class="learning-row-action is-strong" type="button" data-learning-action="candidate-review" data-learning-value="${escapeHtml(item.id)}">${escapeHtml(copy.review)}</button>`,
          `<button class="learning-row-action" type="button" data-learning-action="candidate-ignore" data-learning-value="${escapeHtml(item.id)}">${escapeHtml(copy.ignore)}</button>`
        ].join("");
      } else if (kind === "promotion") {
        actions = [
          `<button class="learning-row-action is-strong" type="button" data-learning-action="promotion-confirm" data-learning-value="${escapeHtml(item.id)}">${escapeHtml(copy.confirmGlobal)}</button>`,
          `<button class="learning-row-action" type="button" data-learning-action="promotion-dismiss" data-learning-value="${escapeHtml(item.id)}">${escapeHtml(copy.dismiss)}</button>`
        ].join("");
      } else if (kind === "policy") {
        if (item.status === "benchmarked") {
          actions += `<button class="learning-row-action is-strong" type="button" data-learning-action="policy-start-canary" data-learning-value="${escapeHtml(item.id)}">${escapeHtml(copy.startCanary)}</button>`;
        }
        if (["canary", "collecting", "stable"].includes(item.status)) {
          actions += `<button class="learning-row-action" type="button" data-learning-action="policy-rollback" data-learning-value="${escapeHtml(item.id)}">${escapeHtml(copy.rollback)}</button>`;
        }
      }
      return `<article class="learning-row" data-learning-kind="${kind}">
        <div class="learning-row-heading">
          <span class="learning-type">${escapeHtml(learningTypeLabel(item.type, locale))}</span>
          <div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(scopeLabel)}</span></div>
          <span class="learning-state">${escapeHtml(learningStatusLabel(item.status, locale))}</span>
        </div>
        ${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ""}
        ${metadata.length ? `<div class="learning-meta">${metadata.map((value) => `<span>${value}</span>`).join("")}</div>` : ""}
        ${actions ? `<div class="learning-row-actions">${actions}</div>` : ""}
      </article>`;
    }).join("");
  }

  function renderLearningView(source = {}, locale = "zh-CN") {
    const view = normalizeLearningView(source);
    const copy = CONTROL_COPY[normalizeControlLocale(locale)];
    const learningAction = view.learningPaused ? "policy-learning-resume" : "policy-learning-pause";
    const learningActionLabel = view.learningPaused ? copy.resumeLearning : copy.pauseLearning;
    const learningDescription = view.learningPaused ? copy.learningAutomationPaused : copy.learningAutomationActive;
    const governance = `<section class="learning-governance" aria-labelledby="learning-governance-title">
      <div><h3 id="learning-governance-title">${escapeHtml(copy.learningAutomation)}</h3><p>${escapeHtml(learningDescription)}</p></div>
      <button class="learning-row-action${view.learningPaused ? " is-strong" : ""}" type="button" data-learning-action="${learningAction}" data-learning-value="global">${escapeHtml(learningActionLabel)}</button>
    </section>`;
    const sections = [
      ["asset", copy.learnedAssets, copy.learnedAssetsDescription, view.assets],
      ["candidate", copy.candidates, copy.candidatesDescription, view.candidates],
      ["promotion", copy.promotions, copy.promotionsDescription, view.promotions],
      ["policy", copy.policies, copy.policiesDescription, view.policies]
    ];
    return governance + sections.map(([kind, title, description, items]) => `<section class="learning-section" aria-labelledby="learning-${kind}-title">
      <div class="learning-section-heading">
        <div><h3 id="learning-${kind}-title">${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div>
        <span class="learning-count" aria-label="${escapeHtml(title)}">${items.length}</span>
      </div>
      <div class="learning-list">${renderLearningRows(items, kind, locale)}</div>
    </section>`).join("");
  }

  function isExpectedLocalServiceHealth(health = {}) {
    return health.ok === true
      && health.service === "smart-prompt-local-service"
      && health.sidecar === "native"
      && health.version === NATIVE_SERVICE_VERSION
      && health.activationContract === ACTIVATION_CONTRACT
      && health.runtimeContract === NATIVE_RUNTIME_CONTRACT
      && health.buildId === NATIVE_BUILD_ID;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  const api = {
    CONTROL_COPY,
    CONTROL_LOCALES,
    CONTROL_PAGES,
    CUSTOM_MODEL_VALUE,
    CUSTOM_PROVIDER_PROTOCOLS,
    LEARNING_ACTION_IDS,
    PROVIDERS,
    PROVIDER_DEFAULTS,
    PROVIDER_MODEL_PRESETS,
    buildProviderSettingsPayload,
    buildProviderTestPayload,
    createLearningActionPayload,
    getControlCopy,
    getModelSelection,
    getCustomProviderSettings,
    getProviderCredentialState,
    getProviderKeyPlaceholder,
    getProviderRecoveryField,
    getExtensionDetectionStatus,
    getActivationView,
    isExpectedLocalServiceHealth,
    isProviderAdvancedField,
    normalizeControlLocale,
    normalizeError,
    normalizeLearningView,
    normalizeCustomProviderName,
    normalizeCustomProviderProtocol,
    normalizeProvider,
    normalizeProviderBaseUrl,
    resolveModelValue,
    renderLearningView,
    shouldShowMainWindow
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SmartPromptControlCenter = api;

  if (typeof document === "undefined") return;

  document.documentElement.dataset.phase3ControlCenter = "true";

  function initialControlLocale() {
    let stored = "";
    try {
      stored = root.localStorage?.getItem("smart-prompt-control-locale") || "";
    } catch {
      // Locale persistence is optional in restricted WebViews.
    }
    return normalizeControlLocale(stored || document.documentElement.lang || root.navigator?.language);
  }

  let serviceAuthToken = "";
  let state = {
    activation: null,
    codexActivation: null,
    settings: null,
    providerStatus: null,
    service: "checking",
    page: "overview",
    locale: initialControlLocale(),
    learning: normalizeLearningView(root.__SMART_PROMPT_UI_FIXTURES__?.outcomeLearning || {}),
    wizardStepOverride: "",
    browserWaitStartedAt: 0,
    diagnostics: null,
    booted: false
  };
  let activationPoll = null;

  const els = {
    runtimeStatus: document.getElementById("runtime-status"),
    wizard: document.getElementById("activation-wizard"),
    wizardProgress: document.getElementById("wizard-progress"),
    wizardProvider: document.getElementById("wizard-provider-step"),
    wizardBrowser: document.getElementById("wizard-browser-step"),
    wizardProviderStatus: document.getElementById("wizard-provider-status"),
    wizardBrowserStatus: document.getElementById("wizard-browser-status"),
    runtimeRepair: document.getElementById("runtime-repair"),
    retryRuntime: document.getElementById("retry-runtime"),
    saveWizardProvider: document.getElementById("save-wizard-provider"),
    openWizardCodex: document.getElementById("open-wizard-codex"),
    refreshWizardActivation: document.getElementById("refresh-wizard-activation"),
    controlCenter: document.getElementById("control-center"),
    overviewStatus: document.getElementById("overview-status"),
    overviewDetails: document.getElementById("overview-details"),
    activationBadge: document.getElementById("activation-badge"),
    modelProviderStatus: document.getElementById("model-provider-status"),
    saveModelProvider: document.getElementById("save-model-provider"),
    learningStatus: document.getElementById("learning-status"),
    learningContent: document.getElementById("learning-content"),
    privacyStatus: document.getElementById("privacy-status"),
    resetData: document.getElementById("reset-local-data"),
    diagnosticsStatus: document.getElementById("diagnostics-status"),
    diagnosticsExport: document.getElementById("export-diagnostics-v2"),
    diagnosticsRefresh: document.getElementById("refresh-diagnostics"),
    trayButton: document.getElementById("minimize-to-tray"),
    locale: document.getElementById("control-locale"),
    pageButtons: [...document.querySelectorAll("[data-control-page]")],
    pages: [...document.querySelectorAll("[data-control-page-view]")]
  };

  function t(key) {
    return getControlCopy(state.locale, key);
  }

  function applyStaticCopy() {
    document.documentElement.lang = state.locale;
    document.querySelectorAll("[data-cc-copy]").forEach((element) => {
      element.textContent = t(element.dataset.ccCopy);
    });
    document.querySelectorAll("[data-cc-placeholder]").forEach((element) => {
      element.placeholder = t(element.dataset.ccPlaceholder);
    });
    document.querySelectorAll("[data-cc-title]").forEach((element) => {
      element.title = t(element.dataset.ccTitle);
    });
    document.querySelectorAll("[data-cc-aria]").forEach((element) => {
      element.setAttribute("aria-label", t(element.dataset.ccAria));
    });
    ["wizard", "model"].forEach((prefix) => {
      const picker = document.getElementById(`${prefix}-model-choice`);
      picker?.querySelectorAll("option").forEach((option) => {
        option.textContent = option.value === CUSTOM_MODEL_VALUE
          ? t("customModelId")
          : `${t("recommendedModel")} · ${option.value}`;
      });
      const credentialState = document.querySelector(`[data-provider-form="${prefix}"] [data-provider-key-state]`);
      if (credentialState) {
        credentialState.textContent = t(credentialState.dataset.configured === "true" ? "credentialSaved" : "credentialMissing");
      }
    });
    if (els.locale) els.locale.value = state.locale;
  }

  function setControlLocale(locale) {
    state.locale = normalizeControlLocale(locale);
    try {
      root.localStorage?.setItem("smart-prompt-control-locale", state.locale);
    } catch {
      // Continue without persistence when storage is unavailable.
    }
    applyStaticCopy();
    renderActivation();
    renderLearning();
  }

  function invoke(command, args) {
    return root.__TAURI__?.core?.invoke
      ? root.__TAURI__.core.invoke(command, args)
      : Promise.resolve(null);
  }

  async function parseResponse(response, path) {
    const text = await response.text();
    if (!text.trim()) return response.ok ? {} : { ok: false, error: { code: "empty_response" } };
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, error: { code: "non_json_response", path } };
    }
  }

  async function request(path, options = {}, retrying = false) {
    const needsAuth = path !== "/health" && path !== "/auth/bootstrap";
    if (needsAuth && !serviceAuthToken) {
      const authResponse = await fetch(`${SERVICE_URL}/auth/bootstrap`, { method: "GET" });
      const authBody = await parseResponse(authResponse, "/auth/bootstrap");
      if (!authResponse.ok || !authBody.auth?.token) {
        const error = new Error("Service authentication failed.");
        error.code = authBody.error?.code || "auth_failed";
        throw error;
      }
      serviceAuthToken = authBody.auth.token;
    }
    const response = await fetch(`${SERVICE_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(needsAuth && serviceAuthToken ? { Authorization: `Bearer ${serviceAuthToken}` } : {}),
        ...(options.headers || {})
      }
    });
    const body = await parseResponse(response, path);
    if (response.status === 401 && needsAuth && !retrying) {
      serviceAuthToken = "";
      return request(path, options, true);
    }
    if (!response.ok || body.ok === false) {
      const error = new Error(body.error?.message || "Service request failed.");
      error.code = body.error?.code || "service_error";
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function setRuntimeStatus(label, tone = "neutral") {
    if (!els.runtimeStatus) return;
    els.runtimeStatus.textContent = label;
    els.runtimeStatus.dataset.tone = tone;
    els.runtimeStatus.className = `runtime-status runtime-status-${tone}`;
  }

  function setStatus(element, label, tone = "neutral") {
    if (!element) return;
    element.textContent = label;
    element.dataset.tone = tone;
  }

  function renderModelPicker(prefix, provider, configuredModel) {
    const selected = normalizeProvider(provider);
    const choiceElement = document.getElementById(`${prefix}-model-choice`);
    const customModelElement = document.getElementById(`${prefix}-model`);
    const customField = customModelElement?.closest("[data-custom-model-field]");
    if (!choiceElement || !customModelElement || !customField) return;

    const selection = getModelSelection(selected, configuredModel);
    choiceElement.replaceChildren();
    for (const model of PROVIDER_MODEL_PRESETS[selected]) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = `${t("recommendedModel")} · ${model}`;
      choiceElement.append(option);
    }
    const customOption = document.createElement("option");
    customOption.value = CUSTOM_MODEL_VALUE;
    customOption.textContent = t("customModelId");
    choiceElement.append(customOption);
    choiceElement.value = selection.choice;
    customModelElement.value = selection.customModel;
    customField.hidden = !selection.isCustom;
  }

  function updateCustomModelVisibility(prefix, focus = false) {
    const provider = normalizeProvider(document.getElementById(`${prefix}-provider`)?.value);
    const choiceElement = document.getElementById(`${prefix}-model-choice`);
    const customModelElement = document.getElementById(`${prefix}-model`);
    const customField = customModelElement?.closest("[data-custom-model-field]");
    if (!choiceElement || !customModelElement || !customField) return;
    const isCustom = provider === "custom" || choiceElement.value === CUSTOM_MODEL_VALUE;
    customField.hidden = !isCustom;
    if (isCustom && focus) customModelElement.focus();
  }

  function getProviderDisplayName(provider, settings = {}) {
    const selected = normalizeProvider(provider);
    if (selected !== "custom") return selected;
    return getCustomProviderSettings(settings).name || t("customProvider");
  }

  function setProviderFormMode(prefix, provider) {
    const selected = normalizeProvider(provider);
    const custom = selected === "custom";
    document.querySelectorAll(`[data-provider-form="${prefix}"] [data-custom-provider-field]`).forEach((field) => {
      field.hidden = !custom;
    });
    const modelChoiceField = document.querySelector(`[data-provider-form="${prefix}"] [data-model-choice-field]`);
    if (modelChoiceField) modelChoiceField.hidden = custom;
    const advanced = document.querySelector(`[data-provider-form="${prefix}"] [data-fixed-provider-advanced]`);
    if (advanced) {
      advanced.hidden = custom;
      if (custom) advanced.open = false;
    }
    updateCustomModelVisibility(prefix);
  }

  function getProviderRecoveryTarget(prefix, field) {
    if (field === "model") {
      const choice = document.getElementById(`${prefix}-model-choice`);
      if (choice?.value === CUSTOM_MODEL_VALUE) return document.getElementById(`${prefix}-model`);
      return choice;
    }
    return document.getElementById(`${prefix}-${field}`);
  }

  function renderProviderForm(prefix, settings = {}) {
    const provider = normalizeProvider(settings.provider);
    const customProvider = getCustomProviderSettings(settings);
    const providerElement = document.getElementById(`${prefix}-provider`);
    const baseUrlElement = document.getElementById(`${prefix}-base-url`);
    const modelElement = document.getElementById(`${prefix}-model`);
    const modelChoiceElement = document.getElementById(`${prefix}-model-choice`);
    const keyElement = document.getElementById(`${prefix}-key`);
    if (!providerElement || !baseUrlElement || !modelElement || !modelChoiceElement || !keyElement) return;
    providerElement.value = provider;
    baseUrlElement.value = provider === "custom"
      ? ""
      : settings.baseUrl || PROVIDER_DEFAULTS[provider].baseUrl;
    const customNameElement = document.getElementById(`${prefix}-custom-name`);
    const customProtocolElement = document.getElementById(`${prefix}-custom-protocol`);
    const customBaseUrlElement = document.getElementById(`${prefix}-custom-base-url`);
    if (customNameElement) customNameElement.value = customProvider.name;
    if (customProtocolElement) customProtocolElement.value = customProvider.protocol;
    if (customBaseUrlElement) customBaseUrlElement.value = customProvider.baseUrl;
    renderModelPicker(
      prefix,
      provider,
      provider === "custom" ? customProvider.model : settings.model || PROVIDER_DEFAULTS[provider].model
    );
    setProviderFormMode(prefix, provider);
    keyElement.value = "";
    keyElement.placeholder = getProviderKeyPlaceholder(provider, settings.providerKeys, state.locale);
    document.querySelectorAll(`[data-provider-form="${prefix}"] [data-provider-key-label]`).forEach((label) => {
      label.textContent = `${getProviderDisplayName(provider, settings)} API Key`;
    });
    const credentialState = getProviderCredentialState(provider, settings.providerKeys, state.locale);
    const credentialStateElement = document.querySelector(`[data-provider-form="${prefix}"] [data-provider-key-state]`);
    if (credentialStateElement) {
      credentialStateElement.textContent = credentialState.label;
      credentialStateElement.dataset.configured = String(credentialState.configured);
    }
  }

  function readProviderForm(prefix) {
    const provider = document.getElementById(`${prefix}-provider`)?.value;
    const selected = normalizeProvider(provider);
    return buildProviderSettingsPayload({
      provider,
      baseUrl: document.getElementById(`${prefix}-${selected === "custom" ? "custom-base-url" : "base-url"}`)?.value,
      model: resolveModelValue({
        provider,
        choice: document.getElementById(`${prefix}-model-choice`)?.value,
        customModel: document.getElementById(`${prefix}-model`)?.value
      }),
      apiKey: document.getElementById(`${prefix}-key`)?.value,
      customProviderName: document.getElementById(`${prefix}-custom-name`)?.value,
      customProviderProtocol: document.getElementById(`${prefix}-custom-protocol`)?.value
    });
  }

  function applyProviderDefaults(prefix) {
    const provider = normalizeProvider(document.getElementById(`${prefix}-provider`)?.value);
    const defaults = PROVIDER_DEFAULTS[provider];
    const customProvider = getCustomProviderSettings(state.settings || {});
    const baseUrl = document.getElementById(`${prefix}-base-url`);
    const key = document.getElementById(`${prefix}-key`);
    const customName = document.getElementById(`${prefix}-custom-name`);
    const customProtocol = document.getElementById(`${prefix}-custom-protocol`);
    const customBaseUrl = document.getElementById(`${prefix}-custom-base-url`);
    if (baseUrl) baseUrl.value = provider === "custom" ? "" : defaults.baseUrl;
    if (customName) customName.value = customProvider.name;
    if (customProtocol) customProtocol.value = customProvider.protocol;
    if (customBaseUrl) customBaseUrl.value = customProvider.baseUrl;
    renderModelPicker(prefix, provider, provider === "custom" ? customProvider.model : defaults.model);
    setProviderFormMode(prefix, provider);
    if (key) {
      key.value = "";
      key.placeholder = getProviderKeyPlaceholder(provider, state.settings?.providerKeys, state.locale);
    }
    const label = document.querySelector(`[data-provider-form="${prefix}"] [data-provider-key-label]`);
    if (label) label.textContent = `${getProviderDisplayName(provider, { customProvider })} API Key`;
    const credentialState = getProviderCredentialState(provider, state.settings?.providerKeys, state.locale);
    const credentialStateElement = document.querySelector(`[data-provider-form="${prefix}"] [data-provider-key-state]`);
    if (credentialStateElement) {
      credentialStateElement.textContent = credentialState.label;
      credentialStateElement.dataset.configured = String(credentialState.configured);
    }
  }

  function renderActivation() {
    const activation = state.codexActivation || { progress: "not_started" };
    const activationView = getActivationView(activation);
    const view = activationView.kind === "wizard" && state.wizardStepOverride
      ? { kind: "wizard", step: state.wizardStepOverride }
      : activationView;
    const isWizard = view.kind === "wizard";
    const needsRepair = state.service === "needs_repair";
    els.wizard.hidden = !isWizard || needsRepair;
    els.controlCenter.hidden = isWizard || needsRepair;
    els.runtimeRepair.hidden = !needsRepair;
    if (els.activationBadge) {
      els.activationBadge.textContent = t(activation.progress === "activated" ? "activated" : "activationIncomplete");
      els.activationBadge.dataset.progress = activation.progress || "not_started";
    }

    if (isWizard) {
      els.wizardProvider.hidden = view.step !== "provider";
      els.wizardBrowser.hidden = view.step !== "codex";
      els.wizardProgress.textContent = view.step === "provider" ? "1 / 2 · Provider" : "2 / 2 · Codex";
      if (view.step === "provider") {
        state.browserWaitStartedAt = 0;
      } else {
        const needsModelTest = !activation.modelTestedAt;
        const status = needsModelTest
          ? { label: t("testRequired"), tone: "pending" }
          : activation.progress === "awaiting_codex_loop"
            ? { label: t("extensionWaiting"), tone: "pending" }
            : { label: t("browserReady"), tone: "success" };
        setStatus(els.wizardBrowserStatus, status.label, status.tone);
        if (els.openWizardCodex) {
          els.openWizardCodex.textContent = t(needsModelTest ? "openAfterTest" : "openChatgpt");
          els.openWizardCodex.title = t(needsModelTest ? "testRequired" : "openChatgpt");
        }
      }
      return;
    }

    renderOverview();
    renderPage(state.page);
  }

  function renderOverview() {
    const activation = state.codexActivation || {};
    const codexReady = activation.progress === "activated" && activation.codexVerified === true;
    const needsRepair = activation.runtimeHealth === "needs_repair" || state.service === "needs_repair";
    const recentLoop = activation.completedAt
      ? new Intl.DateTimeFormat(state.locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(activation.completedAt))
      : t("noRecentLoop");
    const pending = codexReady ? t("noPendingIssue") : t("finishCodexVerification");
    setStatus(
      els.overviewStatus,
      t(needsRepair ? "codexNeedsRepair" : codexReady ? "codexReady" : "codexPending"),
      needsRepair ? "error" : codexReady ? "success" : "pending"
    );
    els.overviewDetails.innerHTML = [
      [t("metricsCodex"), t(needsRepair ? "codexNeedsRepair" : codexReady ? "codexReady" : "codexPending")],
      [t("metricsRecent"), recentLoop],
      [t("metricsPending"), pending],
      [t("metricsSafety"), t(codexReady ? "safetyVerified" : "safetyPending")]
    ].map(([label, value]) => `<div class="metric-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  }

  function renderLearning() {
    if (!els.learningContent) return;
    const view = normalizeLearningView(state.learning || {});
    const itemCount = view.assets.length + view.candidates.length + view.promotions.length + view.policies.length;
    els.learningContent.innerHTML = renderLearningView(view, state.locale);
    setStatus(els.learningStatus, t(itemCount ? "learningStatusReady" : "learningStatusEmpty"), itemCount ? "success" : "neutral");
    els.learningStatus.dataset.itemCount = String(itemCount);
  }

  function renderPage(page, options = {}) {
    const allowed = new Set(CONTROL_PAGES);
    state.page = allowed.has(page) ? page : "overview";
    els.pageButtons.forEach((button) => {
      const active = button.dataset.controlPage === state.page;
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    els.pages.forEach((view) => {
      view.hidden = view.dataset.controlPageView !== state.page;
    });
    if (state.page === "learning") renderLearning();
    if (options.focus === true) {
      const heading = els.pages.find((view) => view.dataset.controlPageView === state.page)?.querySelector("h2");
      heading?.focus();
    }
  }

  async function saveAndTest(prefix) {
    const statusElement = prefix === "wizard" ? els.wizardProviderStatus : els.modelProviderStatus;
    setStatus(statusElement, t("testStarting"), "pending");
    try {
      const payload = readProviderForm(prefix);
      const tested = await request("/llm/test", {
        method: "POST",
        body: JSON.stringify(buildProviderTestPayload(payload))
      });
      state.wizardStepOverride = "";
      setStatus(
        statusElement,
        `${getProviderDisplayName(tested.provider || payload.provider, payload)} · ${tested.model || payload.model} · ${state.locale === "zh-CN" ? "连通性已确认" : "connection verified"}`,
        "success"
      );
      await refreshState();
    } catch (error) {
      setStatus(statusElement, normalizeError(error, state.locale), "error");
      const recoveryField = getProviderRecoveryField(error.code);
      const recoveryTarget = getProviderRecoveryTarget(prefix, recoveryField);
      if (recoveryTarget && isProviderAdvancedField(recoveryField)) {
        const advancedSettings = recoveryTarget.closest("details");
        if (advancedSettings) advancedSettings.open = true;
      }
      recoveryTarget?.focus();
      await reportRuntimeHealth("healthy");
    }
  }

  async function startCodexVerification() {
    if (!state.codexActivation?.modelTestedAt) {
      state.wizardStepOverride = "provider";
      renderActivation();
      setStatus(els.wizardProviderStatus, t("testRequired"), "pending");
      return;
    }
    try {
      const response = await request("/activation/codex/loop-start", {
        method: "POST",
        body: JSON.stringify({ contractVersion: CODEX_ACTIVATION_CONTRACT })
      });
      state.codexActivation = response.activation || state.codexActivation;
      setStatus(els.wizardBrowserStatus, t("openedWaiting"), "pending");
      if (root.__TAURI__?.core?.invoke) await invoke("hide_main_window");
      startActivationPolling();
    } catch {
      setStatus(els.wizardBrowserStatus, t("openFailed"), "error");
    }
  }

  async function reportRuntimeHealth(runtimeHealth, errorCode = "") {
    if (!serviceAuthToken) return;
    try {
      await request("/activation/runtime-health", {
        method: "POST",
        body: JSON.stringify({ runtimeHealth, errorCode })
      });
    } catch {
      // Health reporting must never block the activation flow.
    }
  }

  async function refreshState() {
    const [settings, activation, codexActivation, providerStatus] = await Promise.all([
      request("/settings", { method: "GET" }),
      request("/activation/status", { method: "GET" }),
      request("/activation/codex/status", { method: "GET" }),
      request("/llm/providers", { method: "GET" })
    ]);
    state.settings = settings.settings || {};
    state.activation = activation.activation || {};
    state.codexActivation = codexActivation.activation || {};
    state.providerStatus = providerStatus;
    state.service = "healthy";
    setRuntimeStatus(t("runtimeHealthy"), "success");
    await reportRuntimeHealth("healthy");
    renderProviderForm("wizard", state.settings);
    renderProviderForm("model", state.settings);
    renderActivation();
  }

  async function waitForHealth(attempts = 12) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const health = await request("/health", { method: "GET" });
        if (isExpectedLocalServiceHealth(health)) return true;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    return false;
  }

  async function ensureService() {
    if (await waitForHealth(2)) return true;
    try {
      await invoke("start_local_service");
    } catch {
      // The next restart attempt below is the bounded repair path.
    }
    if (await waitForHealth(16)) return true;
    try {
      await invoke("restart_local_service");
    } catch {
      // Surface the repair state below.
    }
    return waitForHealth(16);
  }

  async function boot() {
    setRuntimeStatus(t("runtimeConnecting"), "pending");
    const healthy = await ensureService();
    if (!healthy) {
      state.service = "needs_repair";
      setRuntimeStatus(t("runtimeRepair"), "error");
      await reportRuntimeHealth("needs_repair", "service_unavailable");
      renderActivation();
      await invoke("show_main_window");
      return;
    }
    try {
      await refreshState();
      state.booted = true;
      if (shouldShowMainWindow({ serviceHealthy: true, codexActivation: state.codexActivation })) {
        await invoke("show_main_window");
        startActivationPolling();
      }
    } catch (error) {
      state.service = "needs_repair";
      setRuntimeStatus(normalizeError(error, state.locale), "error");
      await reportRuntimeHealth("needs_repair", error.code || "state_load_failed");
      renderActivation();
      await invoke("show_main_window");
    }
  }

  async function retryRuntime() {
    state.service = "checking";
    setRuntimeStatus(t("runtimeRestarting"), "pending");
    els.runtimeRepair.hidden = true;
    try {
      await invoke("restart_local_service");
      if (!await waitForHealth(16)) throw Object.assign(new Error("service unavailable"), { code: "service_unavailable" });
      await refreshState();
      state.booted = true;
      if (shouldShowMainWindow({ serviceHealthy: true, codexActivation: state.codexActivation })) {
        await invoke("show_main_window");
        startActivationPolling();
      }
    } catch {
      state.service = "needs_repair";
      setRuntimeStatus(t("runtimeStillUnavailable"), "error");
      renderActivation();
    }
  }

  async function refreshActivation() {
    try {
      const response = await request("/activation/codex/status", { method: "GET" });
      const wasActivated = state.codexActivation?.progress === "activated"
        && state.codexActivation?.codexVerified === true;
      state.codexActivation = response.activation || {};
      renderActivation();
      if (state.codexActivation.progress === "activated" && state.codexActivation.codexVerified === true) {
        stopActivationPolling();
        if (!wasActivated) {
          setRuntimeStatus(t("activated"), "success");
          root.setTimeout(() => invoke("hide_main_window"), 900);
        }
      }
    } catch {
      setStatus(els.wizardBrowserStatus, t("activationUnavailable"), "error");
    }
  }

  async function retryExtensionDetection() {
    state.browserWaitStartedAt = Date.now();
    setStatus(els.wizardBrowserStatus, t("detectingExtension"), "pending");
    await refreshActivation();
  }

  function startActivationPolling() {
    if (activationPoll || !state.booted) return;
    activationPoll = root.setInterval(() => refreshActivation(), 1200);
  }

  function stopActivationPolling() {
    if (!activationPoll) return;
    root.clearInterval(activationPoll);
    activationPoll = null;
  }

  async function resetLocalData() {
    const confirmed = root.confirm?.(state.locale === "zh-CN"
      ? "将当前本地数据移动到可恢复归档，并重新开始激活。继续吗？"
      : "Move current local data to a recoverable archive and restart activation?");
    if (!confirmed) return;
    try {
      const result = await request("/data/all", { method: "DELETE" });
      serviceAuthToken = "";
      state.settings = null;
      state.activation = { progress: "not_started" };
      state.codexActivation = { progress: "not_started", codexVerified: false };
      const recovery = result.reset?.recoveryDirectory || result.reset?.recoveryId || (state.locale === "zh-CN" ? "本地归档" : "local archive");
      setStatus(els.privacyStatus, state.locale === "zh-CN" ? `已移动到可恢复归档：${recovery}` : `Moved to recoverable archive: ${recovery}`, "success");
      await refreshState();
      await invoke("show_main_window");
    } catch (error) {
      setStatus(els.privacyStatus, state.locale === "zh-CN" ? "重置失败，请保留当前数据并重试" : "Reset failed. Keep the current data and try again.", "error");
    }
  }

  async function loadDiagnostics() {
    try {
      const response = await request("/diagnostics/export", { method: "GET" });
      state.diagnostics = response.diagnostics || {};
      const counts = state.diagnostics.counts || {};
      setStatus(
        els.diagnosticsStatus,
        state.locale === "zh-CN"
          ? `本地运行正常 · 事件 ${counts.metrics || 0} · 凭证未进入导出`
          : `Local runtime available · ${counts.metrics || 0} events · credentials excluded from export`,
        "success"
      );
    } catch {
      setStatus(els.diagnosticsStatus, state.locale === "zh-CN" ? "诊断暂时不可用" : "Diagnostics are temporarily unavailable", "error");
    }
  }

  function exportDiagnostics() {
    if (!state.diagnostics) return;
    const safe = {
      createdAt: state.diagnostics.createdAt || "",
      service: state.diagnostics.service || "",
      schemaVersion: state.diagnostics.schemaVersion || 0,
      counts: state.diagnostics.counts || {},
      privacy: {
        promptTextNotStored: true,
        inputTextNotStored: true,
        apiKeyNotStoredInExport: true,
        noAutoSubmit: true
      }
    };
    const blob = new Blob([JSON.stringify(safe, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "smart-prompt-diagnostics.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function bind() {
    root.addEventListener?.("smart-prompt-learning-data", (event) => {
      state.learning = normalizeLearningView(event.detail || {});
      renderLearning();
    });
    els.saveWizardProvider?.addEventListener("click", () => saveAndTest("wizard"));
    els.saveModelProvider?.addEventListener("click", () => saveAndTest("model"));
    els.openWizardCodex?.addEventListener("click", () => startCodexVerification());
    els.refreshWizardActivation?.addEventListener("click", () => retryExtensionDetection());
    els.retryRuntime?.addEventListener("click", () => retryRuntime());
    els.resetData?.addEventListener("click", () => resetLocalData());
    els.diagnosticsRefresh?.addEventListener("click", () => loadDiagnostics());
    els.diagnosticsExport?.addEventListener("click", () => exportDiagnostics());
    els.trayButton?.addEventListener("click", () => invoke("hide_main_window"));
    els.locale?.addEventListener("change", () => setControlLocale(els.locale.value));
    els.learningContent?.addEventListener("click", (event) => {
      const button = event.target.closest?.("button[data-learning-action]");
      if (!button) return;
      const payload = createLearningActionPayload(button.dataset.learningAction, button.dataset.learningValue);
      if (!payload) return;
      const actionEvent = new CustomEvent("smart-prompt-learning-action", { detail: payload, cancelable: true });
      const handled = root.dispatchEvent ? root.dispatchEvent(actionEvent) === false : false;
      setStatus(els.learningStatus, t(handled ? "learningActionSubmitted" : "learningActionUnavailable"), handled ? "success" : "error");
    });
    els.pageButtons.forEach((button) => {
      button.addEventListener("click", () => {
        renderPage(button.dataset.controlPage || "overview", { focus: true });
        if (button.dataset.controlPage === "diagnostics") loadDiagnostics();
      });
      button.addEventListener("keydown", (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const currentIndex = els.pageButtons.indexOf(button);
        const nextIndex = event.key === "Home"
          ? 0
          : event.key === "End"
            ? els.pageButtons.length - 1
            : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + els.pageButtons.length) % els.pageButtons.length;
        els.pageButtons[nextIndex]?.focus();
        els.pageButtons[nextIndex]?.click();
      });
    });
    ["wizard", "model"].forEach((prefix) => {
      document.getElementById(`${prefix}-provider`)?.addEventListener("change", () => applyProviderDefaults(prefix));
      document.getElementById(`${prefix}-model-choice`)?.addEventListener("change", () => updateCustomModelVisibility(prefix, true));
    });
  }

  applyStaticCopy();
  bind();
  renderActivation();
  renderLearning();
  boot();
})(typeof globalThis !== "undefined" ? globalThis : window);

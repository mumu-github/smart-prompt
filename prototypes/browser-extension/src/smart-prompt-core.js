(function initSmartPromptCore(root) {
  const MODE = Object.freeze({
    IDEA: "idea",
    CONTINUE: "continue",
    POLISH: "polish"
  });

  const MODE_META = Object.freeze({
    idea: {
      label: "求思路",
      intent: "把空白或极短想法扩展成可选择的 prompt 方向"
    },
    continue: {
      label: "续写",
      intent: "把半成品想法补齐为可执行 prompt"
    },
    polish: {
      label: "优化",
      intent: "重排已有完整输入，让模型更容易执行"
    }
  });

  const MODE_META_EN = Object.freeze({
    idea: {
      label: "Ideas",
      intent: "Expand a blank or short thought into prompt directions."
    },
    continue: {
      label: "Continue",
      intent: "Complete a partial thought into an executable prompt."
    },
    polish: {
      label: "Polish",
      intent: "Restructure a finished draft so the model can follow it."
    }
  });

  function normalizeLocale(value, fallback = "zh-CN") {
    const text = String(value || "").toLowerCase();
    if (!text) return fallback;
    return text.startsWith("zh") ? "zh-CN" : "en";
  }

  function getModeMeta(mode, locale) {
    const normalized = normalizeLocale(locale);
    const table = normalized === "en" ? MODE_META_EN : MODE_META;
    return table[mode] || MODE_META[mode] || MODE_META.idea;
  }

  const DEFAULT_SKILLS = Object.freeze([
    {
      id: "skill-ui-ux",
      name: "ui-ux",
      description: "用于界面、交互、视觉细节、状态和验收标准的产品设计提示词。",
      tags: ["ui", "ux", "screen", "page", "layout", "settings", "onboarding", "product", "pitch", "界面", "交互", "设计", "prototype", "frontend"],
      riskLevel: "low",
      sourceType: "builtin"
    },
    {
      id: "skill-code-review",
      name: "code-review",
      description: "用于代码审查、缺陷排查、回归风险和测试缺口检查。",
      tags: ["review", "bug", "代码", "重构", "测试", "安全", "risk"],
      riskLevel: "low",
      sourceType: "builtin"
    },
    {
      id: "skill-test-plan",
      name: "test-plan",
      description: "用于生成验收标准、测试用例、边界条件和验证命令。",
      tags: ["test", "qa", "验收", "测试", "边界", "验证"],
      riskLevel: "low",
      sourceType: "builtin"
    },
    {
      id: "skill-security-review",
      name: "security-review",
      description: "用于权限、隐私、注入、供应链和数据安全风险检查。",
      tags: ["security", "privacy", "权限", "隐私", "api key", "注入"],
      riskLevel: "medium",
      sourceType: "builtin"
    }
  ]);

  const TOOL_HINTS = Object.freeze([
    ["claude code", "Claude Code"],
    ["codex", "Codex"],
    ["hermes", "Hermes"],
    ["work-buddy", "workBuddy"],
    ["workbuddy", "workBuddy"],
    ["trae", "Trae"],
    ["chatgpt", "ChatGPT"],
    ["openai", "ChatGPT"],
    ["claude", "Claude"],
    ["gemini", "Gemini"],
    ["perplexity", "Perplexity"],
    ["lovable", "Lovable"],
    ["bolt", "Bolt"],
    ["v0", "v0"],
    ["replit", "Replit"],
    ["doubao", "Doubao"],
    ["deepseek", "DeepSeek"]
  ]);

  const SITE_ADAPTERS = Object.freeze([
    {
      id: "chatgpt",
      tool: "ChatGPT",
      hostnames: ["chatgpt.com", "chat.openai.com"],
      inputSelectors: ['#prompt-textarea', 'textarea[data-id="prompt-textarea"]', '[contenteditable="true"][data-id="prompt-textarea"]', '[id="prompt-textarea"][contenteditable="true"]'],
      insertStrategy: "contenteditable-or-textarea"
    },
    {
      id: "claude",
      tool: "Claude",
      hostnames: ["claude.ai"],
      inputSelectors: ['[data-testid="chat-input"] div[contenteditable="true"]', 'div[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]', '[role="textbox"]', 'textarea'],
      insertStrategy: "contenteditable-or-textarea"
    },
    {
      id: "gemini",
      tool: "Gemini",
      hostnames: ["gemini.google.com"],
      inputSelectors: ['rich-textarea div[contenteditable="true"]', 'div[aria-label][contenteditable="true"]', 'div[contenteditable="true"]', '[role="textbox"]'],
      insertStrategy: "contenteditable"
    },
    {
      id: "perplexity",
      tool: "Perplexity",
      hostnames: ["perplexity.ai", "www.perplexity.ai"],
      inputSelectors: ['textarea[placeholder*="Ask"]', 'textarea[aria-label*="Ask"]', '[data-testid*="composer"] textarea', '[contenteditable="true"][role="textbox"]', '[contenteditable="true"]', '[role="textbox"]', 'textarea'],
      insertStrategy: "contenteditable-or-textarea"
    },
    {
      id: "lovable",
      tool: "Lovable",
      hostnames: ["lovable.dev"],
      inputSelectors: ['[role="textbox"][aria-label="Chat input"]', '[contenteditable="true"][aria-label="Chat input"]', '[data-testid*="chat"] [role="textbox"]', 'textarea[placeholder*="Build"]', '[contenteditable="true"]', '[role="textbox"]', 'textarea'],
      insertStrategy: "textarea-first"
    },
    {
      id: "bolt",
      tool: "Bolt",
      hostnames: ["bolt.new"],
      inputSelectors: ['[role="textbox"][aria-label*="Type your idea"]', '[contenteditable="true"][aria-label*="Type your idea"]', 'textarea[placeholder*="Type your idea"]', '[data-testid*="chat"] [role="textbox"]', '[contenteditable="true"]', '[role="textbox"]', 'textarea'],
      insertStrategy: "textarea-first"
    },
    {
      id: "v0",
      tool: "v0",
      hostnames: ["v0.dev", "v0.app"],
      inputSelectors: ['textarea[id^="prompt-textarea"]', 'textarea[placeholder*="v0"]', '[data-testid*="prompt"] textarea', 'textarea', '[contenteditable="true"]', '[role="textbox"]'],
      insertStrategy: "textarea-first"
    },
    {
      id: "replit",
      tool: "Replit",
      hostnames: ["replit.com"],
      inputSelectors: [
        'textarea[placeholder*="Replit"]',
        'textarea[placeholder*="Ask"]',
        'textarea[placeholder*="Describe"]',
        'textarea[placeholder*="Build"]',
        'textarea[aria-label*="Ask"]',
        'textarea[aria-label*="prompt"]',
        '[data-cy*="ai"] textarea',
        '[data-testid*="ai"] textarea',
        '[data-testid*="prompt"] textarea',
        '[aria-label*="prompt"][contenteditable="true"]',
        '[aria-label*="Ask"][contenteditable="true"]',
        '[contenteditable="plaintext-only"]',
        '[contenteditable="true"][role="textbox"]',
        '[role="textbox"]',
        'textarea',
        '[contenteditable="true"]'
      ],
      insertStrategy: "textarea-first"
    },
    {
      id: "workbuddy",
      tool: "workBuddy",
      hostnames: ["work-buddy.ai", "www.work-buddy.ai"],
      inputSelectors: [
        'textarea[placeholder*="work-buddy"]',
        'textarea[placeholder*="WorkBuddy"]',
        'textarea[placeholder*="Ask"]',
        'textarea[placeholder*="Describe"]',
        '[data-testid*="chat"] textarea',
        '[data-testid*="prompt"] textarea',
        '[aria-label*="prompt"][contenteditable="true"]',
        '[aria-label*="Ask"][contenteditable="true"]',
        '[contenteditable="true"][role="textbox"]',
        '[role="textbox"]',
        'textarea',
        '[contenteditable="true"]'
      ],
      insertStrategy: "textarea-first"
    },
    {
      id: "trae",
      tool: "Trae",
      hostnames: ["trae.ai", "www.trae.ai"],
      inputSelectors: [
        'textarea[placeholder*="Trae"]',
        'textarea[placeholder*="Ask"]',
        'textarea[placeholder*="Build"]',
        'textarea[aria-label*="prompt"]',
        '[data-testid*="chat"] textarea',
        '[data-testid*="prompt"] textarea',
        '[contenteditable="true"][role="textbox"]',
        '[role="textbox"]',
        'textarea',
        '[contenteditable="true"]'
      ],
      insertStrategy: "textarea-first"
    },
    {
      id: "doubao",
      tool: "Doubao",
      hostnames: ["doubao.com", "www.doubao.com", "dola.com", "www.dola.com"],
      inputSelectors: [
        'textarea.semi-input-textarea',
        'textarea[placeholder*="发消息"]',
        'textarea[placeholder*="按住空格"]',
        'textarea[placeholder*="消息"]',
        'textarea[placeholder*="豆包"]',
        'textarea[placeholder*="输入"]',
        'textarea[placeholder*="Ask"]',
        'textarea[aria-label*="豆包"]',
        'textarea[aria-label*="输入"]',
        '[data-testid*="chat"] textarea',
        '[data-testid*="prompt"] textarea',
        '[aria-label*="输入"][contenteditable="true"]',
        '[contenteditable="plaintext-only"]',
        '[contenteditable="true"][role="textbox"]',
        '[role="textbox"]',
        'textarea',
        '[contenteditable="true"]'
      ],
      insertStrategy: "contenteditable-or-textarea"
    },
    {
      id: "deepseek",
      tool: "DeepSeek",
      hostnames: ["chat.deepseek.com", "deepseek.com", "www.deepseek.com"],
      inputSelectors: [
        'textarea[placeholder*="DeepSeek"]',
        'textarea[placeholder*="请输入"]',
        'textarea[placeholder*="Ask"]',
        'textarea[aria-label*="DeepSeek"]',
        'textarea[aria-label*="chat"]',
        '[data-testid*="chat"] textarea',
        '[data-testid*="prompt"] textarea',
        '[contenteditable="plaintext-only"]',
        '[contenteditable="true"][role="textbox"]',
        '[role="textbox"]',
        'textarea',
        '[contenteditable="true"]'
      ],
      insertStrategy: "textarea-first"
    }
  ]);

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function compactGenerationPolicy(context = {}) {
    const supplied = normalizeText(context?.generationPolicyText || "").slice(0, 1600);
    if (supplied) return supplied;
    const policy = context?.generationPolicy;
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) return "";
    return normalizeText(JSON.stringify({
      contractVersion: policy.contractVersion || "",
      policyId: policy.policyId || "",
      version: policy.version || null,
      selectedStrategy: policy.selectedStrategy || null,
      directives: Array.isArray(policy.directives) ? policy.directives.slice(0, 5) : [],
      contextBudget: policy.contextBudget || null
    })).slice(0, 1600);
  }

  function tokenize(value) {
    return normalizeText(value)
      .toLowerCase()
      .split(/[^a-z0-9_\u4e00-\u9fa5]+/u)
      .filter(Boolean);
  }

  function detectTool(hostname, title) {
    const haystack = `${hostname || ""} ${title || ""}`.toLowerCase();
    const adapter = detectSiteAdapter(hostname);
    if (adapter) return adapter.tool;
    const match = TOOL_HINTS.find(([needle]) => haystack.includes(needle));
    return match ? match[1] : "Web LLM";
  }

  function detectSiteAdapter(hostname) {
    const host = String(hostname || "").toLowerCase();
    return SITE_ADAPTERS.find((adapter) => adapter.hostnames.some((name) => host === name || host.endsWith(`.${name}`))) || null;
  }

  function detectMode(input) {
    const text = normalizeText(input);
    const compact = text.replace(/\s+/g, "");
    if (!compact || compact.length <= 12) return MODE.IDEA;

    const structureMarkers = text.match(/目标|背景|约束|输出|验收|步骤|上下文|角色|格式|不要|必须|acceptance|context|constraint|output|steps|role/gi) || [];
    const hasStructure = structureMarkers.length > 0;
    const stronglyStructured = structureMarkers.length >= 3 && compact.length >= 40;
    const hasParagraphs = text.includes("\n") || /[。.!?]\s*\S/.test(text);
    const longEnough = compact.length >= 120;

    if ((longEnough && (hasStructure || hasParagraphs)) || stronglyStructured) return MODE.POLISH;
    return MODE.CONTINUE;
  }

  function slugify(value) {
    return normalizeText(value)
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "skill";
  }

  function hashText(value) {
    let hash = 2166136261;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function parseSkillText(raw, sourceType, sourcePath) {
    const text = normalizeText(raw);
    if (!text) return null;

    const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
    const fields = {};
    if (frontmatter) {
      frontmatter[1].split(/\n/).forEach((line) => {
        const match = line.match(/^([a-zA-Z0-9_-]+):\s*"?([^"]+)"?\s*$/);
        if (match) fields[match[1]] = match[2];
      });
    }

    const heading = text.match(/^#\s+(.+)$/m);
    const name = fields.name || (heading ? heading[1] : sourcePath ? sourcePath.split(/[\\/]/).pop() : "Imported skill");
    const description =
      fields.description ||
      text
        .replace(/^---[\s\S]*?---/, "")
        .split(/\n/)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith("#")) ||
      "Imported local prompt or skill.";

    return {
      id: `skill-${slugify(name)}-${hashText(`${sourcePath || ""}:${text}`).slice(0, 8)}`,
      name,
      description,
      tags: tokenize(`${name} ${description}`).slice(0, 24),
      body: text,
      body_path: sourcePath || null,
      riskLevel: "text-only",
      sourceType: sourceType || "imported"
    };
  }

  function normalizeSkillRecord(skill) {
    return {
      ...skill,
      riskLevel: skill.riskLevel || skill.risk_level || "",
      sourceType: skill.sourceType || skill.source_type || "imported"
    };
  }

  function rankSkills(input, context, importedSkills, limit) {
    const skills = [...DEFAULT_SKILLS, ...(Array.isArray(importedSkills) ? importedSkills : [])].map(normalizeSkillRecord);
    const inputTokens = new Set(tokenize(`${input || ""} ${context?.tool || ""} ${context?.host || ""}`));
    const ranked = skills
      .map((skill) => {
        const skillTokens = tokenize(`${skill.name || ""} ${skill.description || ""} ${(skill.tags || []).join(" ")}`);
        const matchedTokens = [...new Set(skillTokens.filter((token) => inputTokens.has(token)))];
        const overlap = matchedTokens.length;
        const toolBoost = skill.allowed_tools?.some((tool) => String(context?.tool || "").toLowerCase().includes(String(tool).toLowerCase())) ? 2 : 0;
        const sourceBoost = skill.sourceType === "builtin" ? 0.3 : 0.8;
        return {
          ...skill,
          score: overlap + toolBoost + sourceBoost,
          reason: {
            matchedTokens: matchedTokens.slice(0, 8),
            toolBoost,
            sourceBoost
          }
        };
      })
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return ranked.slice(0, limit || 3);
  }

  function buildPrompt(input, context, skills, variantIndex) {
    const text = normalizeText(input);
    const mode = context?.mode || detectMode(text);
    const locale = normalizeLocale(context?.locale);
    const tool = context?.tool || detectTool(context?.host, context?.title);
    const skillNames = skills?.length ? skills.map((skill) => skill.name).join(", ") : locale === "en" ? "none" : "无";
    const variant = Number.isFinite(variantIndex) ? variantIndex % 3 : 0;
    const taskScenario = normalizeText(context?.taskScenario || context?.task_scenario || context?.scenario || "").slice(0, 80);
    const generationPolicyGuidance = compactGenerationPolicy(context);
    const feedbackGuidance = generationPolicyGuidance ? "" : normalizeText(context?.feedbackProfileText || context?.feedbackGuidance || "").slice(0, 600);
    const strategyGuidance = generationPolicyGuidance ? "" : normalizeText(context?.promptStrategyText || context?.strategyGuidance || "").slice(0, 800);
    const strategyInsightsGuidance = generationPolicyGuidance ? "" : normalizeText(context?.strategyInsightsText || context?.strategyInsightGuidance || "").slice(0, 800);
    const strategyWeightGuidance = generationPolicyGuidance ? "" : normalizeText(context?.strategyWeightText || context?.strategyWeightGuidance || "").slice(0, 800);
    const qualityLiftGuidance = generationPolicyGuidance ? "" : normalizeText(context?.promptQualityLiftText || context?.qualityLiftGuidance || "").slice(0, 800);
    const qualityLiftSegmentGuidance = generationPolicyGuidance ? "" : normalizeText(context?.qualityLiftSegmentText || context?.qualityLiftSegmentGuidance || "").slice(0, 800);
    const failureReasonGuidance = generationPolicyGuidance ? "" : normalizeText(context?.failureReasonText || context?.failureReasonGuidance || "").slice(0, 800);
    const selfImprovementGuidance = generationPolicyGuidance ? "" : normalizeText(context?.selfImprovementText || context?.selfImprovementGuidance || "").slice(0, 800);
    const evolutionCandidateGuidance = generationPolicyGuidance ? "" : normalizeText(context?.evolutionCandidateText || context?.evolutionCandidateGuidance || "").slice(0, 800);
    const experimentOutcomeGuidance = generationPolicyGuidance ? "" : normalizeText(context?.experimentOutcomeText || context?.experimentOutcomeGuidance || "").slice(0, 800);
    const taskOutcomeGuidance = generationPolicyGuidance ? "" : normalizeText(context?.taskOutcomeText || context?.taskOutcomeGuidance || "").slice(0, 800);
    const withFeedback = (parts) => {
      const next = [...parts];
      if (taskScenario) {
        next.push("", `Local task scenario: ${taskScenario}`);
      }
      if (feedbackGuidance) {
        next.push("", `Local feedback guidance: ${feedbackGuidance}`);
      }
      if (strategyGuidance) {
        next.push("", `Local strategy plan: ${strategyGuidance}`);
      }
      if (strategyInsightsGuidance) {
        next.push("", `Local strategy insights: ${strategyInsightsGuidance}`);
      }
      if (strategyWeightGuidance) {
        next.push("", `Local strategy weights: ${strategyWeightGuidance}`);
      }
      if (qualityLiftGuidance) {
        next.push("", `Local quality lift: ${qualityLiftGuidance}`);
      }
      if (qualityLiftSegmentGuidance) {
        next.push("", `Local quality lift segment policy: ${qualityLiftSegmentGuidance}`);
      }
      if (failureReasonGuidance) {
        next.push("", `Local failure reason policy: ${failureReasonGuidance}`);
      }
      if (selfImprovementGuidance) {
        next.push("", `Local self-improvement reflection: ${selfImprovementGuidance}`);
      }
      if (evolutionCandidateGuidance) {
        next.push("", `Local evolution candidates: ${evolutionCandidateGuidance}`);
      }
      if (experimentOutcomeGuidance) {
        next.push("", `Local experiment outcomes: ${experimentOutcomeGuidance}`);
      }
      if (taskOutcomeGuidance) {
        next.push("", `Local task outcomes: ${taskOutcomeGuidance}`);
      }
      return next.join("\n");
    };

    if (locale === "en") {
      if (mode === MODE.IDEA) {
        const idea = text || "I want AI to turn my current thought into an executable plan";
        const angle = [
          "Clarify the goal, user, and success criteria before proposing an actionable plan",
          "Offer 3 prompt directions first, then expand the strongest one",
          "Break the vague request into tasks, constraints, deliverables, and verification"
        ][variant];
        return withFeedback([
          `You are a prompt copilot familiar with ${tool}.`,
          "",
          `My initial idea: ${idea}`,
          "",
          `Use this angle: ${angle}.`,
          "",
          "Please output:",
          "1. Your understanding of the request",
          "2. 3 optional prompt directions",
          "3. The best use case for each direction",
          "4. The complete prompt you recommend most",
          "5. 3 key details I should provide next",
          "",
          `Relevant skills: ${skillNames}.`
        ]);
      }

      if (mode === MODE.CONTINUE) {
        const emphasis = [
          "Fill in goal, scope, inputs, outputs, constraints, and acceptance criteria",
          "Fill in role, steps, edge cases, and failure handling",
          "Fill in context, priorities, verifiable outcomes, and next actions"
        ][variant];
        return withFeedback([
          `Complete the partial request below into a high-quality prompt for ${tool}.`,
          "",
          "Original input:",
          text,
          "",
          `Completion focus: ${emphasis}.`,
          "",
          "Output one prompt that can be sent directly, with:",
          "- Goal",
          "- Background and context",
          "- Known information",
          "- Tasks for the AI",
          "- Constraints and things not to do",
          "- Output format",
          "- Acceptance criteria",
          "",
          `Recommended skills: ${skillNames}.`,
          "Do not execute third-party scripts automatically; use skills only as read-only guidance or checklists."
        ]);
      }

      const polishStyle = [
        "better suited for a coding agent to execute directly",
        "better suited for a general LLM to analyze first and then produce output",
        "better suited for team collaboration and later acceptance checks"
      ][variant];
      return withFeedback([
        `Rewrite and polish the complete input below so it is ${polishStyle}.`,
        "",
        "Original input:",
        text,
        "",
        "Polish requirements:",
        "- Preserve the original intent and do not add unconfirmed requirements",
        "- Make goal, context, constraints, output format, and acceptance criteria explicit",
        "- Convert vague wording into executable instructions",
        "- Mark uncertainties that need user confirmation",
        "- Keep it direct and copy-ready",
        "",
        `Current tool: ${tool}`,
        `Suggested skills: ${skillNames}`,
        "",
        "Output only the polished prompt."
      ]);
    }

    if (mode === MODE.IDEA) {
      const idea = text || "我想让 AI 帮我把当前想法变成可执行方案";
      const angle = [
        "先澄清目标、用户和成功标准，再给出可执行方案",
        "先列出 3 个方向供我选择，再展开最推荐的一版",
        "先把模糊需求拆成任务、约束、交付物和验证方式"
      ][variant];
      return withFeedback([
        `你是熟悉 ${tool} 的提示词协作助手。`,
        "",
        `我的初始想法：${idea}`,
        "",
        `请采用这个角度：${angle}。`,
        "",
        "请输出：",
        "1. 你对需求的理解",
        "2. 3 个可选 prompt 方向",
        "3. 每个方向适合的使用场景",
        "4. 你最推荐的一版完整 prompt",
        "5. 我下一步需要补充的 3 个关键信息",
        "",
        `可参考的 skill：${skillNames}。`
      ]);
    }

    if (mode === MODE.CONTINUE) {
      const emphasis = [
        "补齐目标、范围、输入、输出、约束和验收标准",
        "补齐角色设定、执行步骤、边界条件和失败处理",
        "补齐上下文、优先级、可验证结果和下一步行动"
      ][variant];
      return withFeedback([
        `请把下面这段半成品需求补全成适合 ${tool} 使用的高质量 prompt。`,
        "",
        "原始输入：",
        text,
        "",
        `补全重点：${emphasis}。`,
        "",
        "请输出一版可以直接发送的 prompt，结构包含：",
        "- 目标",
        "- 背景和上下文",
        "- 已知信息",
        "- 需要 AI 完成的任务",
        "- 约束与不要做的事",
        "- 输出格式",
        "- 验收标准",
        "",
        `推荐引用的 skill：${skillNames}。`,
        "不要自动执行第三方脚本；只把 skill 当作文本规则或检查清单使用。"
      ]);
    }

    const polishStyle = [
      "更适合让 coding agent 直接执行",
      "更适合让通用 LLM 先分析再产出",
      "更适合团队协作和后续验收"
    ][variant];
    return withFeedback([
      `请重排和优化下面的完整输入，使它${polishStyle}。`,
      "",
      "原始输入：",
      text,
      "",
      "优化要求：",
      "- 保留原意，不新增未经确认的需求",
      "- 明确目标、上下文、约束、输出格式和验收标准",
      "- 把模糊表达改写为可执行指令",
      "- 标出需要用户确认的不确定点",
      "- 保持语气直接、可复制发送",
      "",
      `当前工具：${tool}`,
      `建议参考 skill：${skillNames}`,
      "",
      "请只输出优化后的 prompt。"
    ]);
  }

  function buildCard(input, context, importedSkills, variantIndex) {
    const mode = context?.mode || detectMode(input);
    const locale = normalizeLocale(context?.locale);
    const meta = getModeMeta(mode, locale);
    const tool = context?.tool || detectTool(context?.host, context?.title);
    const rankedSkills = rankSkills(input, { ...context, tool }, importedSkills, 3);
    const taskScenario = normalizeText(context?.taskScenario || context?.task_scenario || context?.scenario || "").slice(0, 80);
    return {
      mode,
      modeLabel: meta.label,
      intent: meta.intent,
      tool,
      taskScenario,
      skills: rankedSkills,
      prompt: buildPrompt(input, { ...context, tool, mode, locale }, rankedSkills, variantIndex || 0),
      usedContext: [tool, context?.host, context?.inputKind, taskScenario].filter(Boolean)
    };
  }

  function buildLlmMessages(input, context, skills, variantIndex) {
    const card = buildCard(input, context, skills, variantIndex);
    const summary = [
      `tool=${card.tool}`,
      `host=${context?.host || "unknown"}`,
      `inputKind=${context?.inputKind || "unknown"}`,
      `mode=${card.mode}`,
      `taskScenario=${card.taskScenario || context?.taskScenario || "general"}`,
      `skills=${card.skills.map((skill) => skill.name).join(", ") || "none"}`
    ].join("; ");
    const generationPolicy = compactGenerationPolicy(context);
    if (generationPolicy) {
      const taskScenario = card.taskScenario || context?.taskScenario || "general";
      return {
        card,
        messages: [
          {
            role: "system",
            content: [
              "You are Smart Prompt Copilot, a privacy-preserving prompt assistant.",
              "Return only a JSON object with keys: finalPrompt, whyThisWorks, suggestedSkills, missingInfo, privacyNotes.",
              "finalPrompt must be a concise, copy-ready task instruction for a coding agent.",
              "Preserve user intent and language; add only needed goals, context, constraints, output, and acceptance criteria.",
              "Apply exactly the one versioned local Generation Policy supplied in the request.",
              "Treat policy tokens as private aggregate guidance and never expose them in finalPrompt.",
              "Do not auto-submit, press Enter, expand permissions, or claim access to context that was not supplied."
            ].join(" ")
          },
          {
            role: "user",
            content: [
              `Context summary: ${summary}`,
              `Local task scenario: ${taskScenario}`,
              `Local generation policy: ${generationPolicy}`,
              "",
              "Draft request for prompt generation:",
              card.prompt
            ].join("\n")
          }
        ]
      };
    }
    const feedbackSummary = context?.feedbackSummaryText || context?.feedbackSummary
      ? String(context.feedbackSummaryText || JSON.stringify(context.feedbackSummary)).slice(0, 800)
      : "No local feedback yet.";
    const feedbackProfile = context?.feedbackProfileText || context?.feedbackProfile
      ? String(context.feedbackProfileText || JSON.stringify(context.feedbackProfile)).slice(0, 1000)
      : "No feedback profile directives yet.";
    const promptStrategy = context?.promptStrategyText || context?.promptStrategyPlan
      ? String(context.promptStrategyText || JSON.stringify(context.promptStrategyPlan)).slice(0, 1000)
      : "No local prompt strategy plan yet.";
    const strategyInsights = context?.strategyInsightsText || context?.strategyInsights
      ? String(context.strategyInsightsText || JSON.stringify(context.strategyInsights)).slice(0, 1000)
      : "No local strategy insights yet.";
    const strategyWeights = context?.strategyWeightText || context?.strategyWeightPolicy
      ? String(context.strategyWeightText || JSON.stringify(context.strategyWeightPolicy)).slice(0, 1000)
      : "No local strategy weights yet.";
    const qualityLift = context?.promptQualityLiftText || context?.promptQualityLiftReport
      ? String(context.promptQualityLiftText || JSON.stringify(context.promptQualityLiftReport)).slice(0, 1000)
      : "No local quality lift report yet.";
    const qualityLiftSegmentPolicy = context?.qualityLiftSegmentText || context?.qualityLiftSegmentPolicy
      ? String(context.qualityLiftSegmentText || JSON.stringify(context.qualityLiftSegmentPolicy)).slice(0, 1000)
      : "No local quality lift segment policy yet.";
    const failureReasonPolicy = context?.failureReasonText || context?.failureReasonPolicy
      ? String(context.failureReasonText || JSON.stringify(context.failureReasonPolicy)).slice(0, 1000)
      : "No local failure reason policy yet.";
    const selfImprovement = context?.selfImprovementText || context?.selfImprovementReport
      ? String(context.selfImprovementText || JSON.stringify(context.selfImprovementReport)).slice(0, 1000)
      : "No local self-improvement reflection yet.";
    const evolutionCandidates = context?.evolutionCandidateText || context?.evolutionCandidateReport
      ? String(context.evolutionCandidateText || JSON.stringify(context.evolutionCandidateReport)).slice(0, 1000)
      : "No local evolution candidates yet.";
    const experimentOutcomes = context?.experimentOutcomeText || context?.experimentOutcomeReport
      ? String(context.experimentOutcomeText || JSON.stringify(context.experimentOutcomeReport)).slice(0, 1000)
      : "No local experiment outcome report yet.";
    const taskOutcomes = context?.taskOutcomeText || context?.taskOutcomeReport
      ? String(context.taskOutcomeText || JSON.stringify(context.taskOutcomeReport)).slice(0, 1000)
      : "No local task outcome report yet.";
    const taskScenario = card.taskScenario || context?.taskScenario || "general";
    return {
      card,
      messages: [
        {
          role: "system",
          content: [
            "You are Smart Prompt Copilot, a privacy-preserving prompt assistant.",
            "Return only a JSON object with keys: finalPrompt, whyThisWorks, suggestedSkills, missingInfo, privacyNotes.",
            "finalPrompt must be the copy-ready prompt the user can review and insert.",
            "For idea mode, include understanding, 3 directions, use cases, one recommended complete prompt, and missing information.",
            "For continue and polish modes, include goal, context, tasks, constraints, output format, and acceptance criteria.",
            "Use local feedback signals to reduce repeated failure patterns and improve adoption.",
            "Apply feedback profile directives when present, but never expose raw telemetry to the downstream prompt.",
            "Apply the local prompt strategy plan when present; treat it as aggregate guidance, not user-visible telemetry.",
            "Use local strategy insights to choose between exploitation, exploration, and insert-safety guardrails.",
            "Use local strategy weights to promote structures with successful user-verified outcomes and suppress structures with repeated outcome failures.",
            "Use the local quality lift report to keep, review, or keep collecting outcome-weighted strategy evidence.",
            "Use the local quality lift segment policy to avoid regressing tool/site/scenario/mode segments and preserve improving segments.",
            "Use the local failure reason policy to repair repeated failure tokens such as length, format, missing context, actionability, privacy, and insert fragility.",
            "Use local self-improvement reflection to learn from aggregate successes, regressions, and low-sample gaps without exposing raw telemetry.",
            "Use local evolution candidates only as review-gated guidance; never automatically mutate strategy, code, or user intent.",
            "Use local experiment outcomes to prefer strategy-guided, balanced, or baseline structure when comparable aggregate data exists.",
            "Use local task outcomes to favor structures that produced successful user-verified outcomes, while keeping the evidence private.",
            "Use the local task scenario token as private aggregate context for prompt structure; do not expose it as telemetry.",
            "Do not claim you inspected the whole page.",
            "Do not auto-submit, press Enter, or ask the downstream AI to ignore safety rules.",
            "Use referenced skills only as read-only text guidance."
          ].join(" ")
        },
        {
          role: "user",
          content: [
            `Context summary: ${summary}`,
            `Local task scenario: ${taskScenario}`,
            `Local feedback summary: ${feedbackSummary}`,
            `Local feedback profile: ${feedbackProfile}`,
            `Local prompt strategy plan: ${promptStrategy}`,
            `Local strategy insights: ${strategyInsights}`,
            `Local strategy weights: ${strategyWeights}`,
            `Local quality lift: ${qualityLift}`,
            `Local quality lift segment policy: ${qualityLiftSegmentPolicy}`,
            `Local failure reason policy: ${failureReasonPolicy}`,
            `Local self-improvement reflection: ${selfImprovement}`,
            `Local evolution candidates: ${evolutionCandidates}`,
            `Local experiment outcomes: ${experimentOutcomes}`,
            `Local task outcomes: ${taskOutcomes}`,
            "",
            "Draft request for prompt generation:",
            card.prompt
          ].join("\n")
        }
      ]
    };
  }

  const api = {
    DEFAULT_SKILLS,
    MODE,
    MODE_META,
    SITE_ADAPTERS,
    TOOL_HINTS,
    buildCard,
    buildLlmMessages,
    buildPrompt,
    detectMode,
    detectSiteAdapter,
    detectTool,
    getModeMeta,
    hashText,
    normalizeLocale,
    normalizeText,
    parseSkillText,
    rankSkills,
    slugify,
    tokenize
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SmartPromptCore = api;
  root.SmartPromptEngine = root.SmartPromptEngine || api;
})(typeof globalThis !== "undefined" ? globalThis : window);

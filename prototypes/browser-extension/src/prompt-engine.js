(function initSmartPromptEngine(root) {
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

  const DEFAULT_SKILLS = Object.freeze([
    {
      id: "skill-ui-ux",
      name: "ui-ux",
      description: "用于界面、交互、视觉细节、状态和验收标准的产品设计提示词。",
      tags: ["ui", "ux", "界面", "交互", "设计", "prototype", "frontend"],
      risk_level: "low",
      source_type: "builtin"
    },
    {
      id: "skill-code-review",
      name: "code-review",
      description: "用于代码审查、缺陷排查、回归风险和测试缺口检查。",
      tags: ["review", "bug", "代码", "重构", "测试", "安全", "risk"],
      risk_level: "low",
      source_type: "builtin"
    },
    {
      id: "skill-test-plan",
      name: "test-plan",
      description: "用于生成验收标准、测试用例、边界条件和验证命令。",
      tags: ["test", "qa", "验收", "测试", "边界", "验证"],
      risk_level: "low",
      source_type: "builtin"
    },
    {
      id: "skill-security-review",
      name: "security-review",
      description: "用于权限、隐私、注入、供应链和数据安全风险检查。",
      tags: ["security", "privacy", "权限", "隐私", "api key", "注入"],
      risk_level: "medium",
      source_type: "builtin"
    }
  ]);

  const TOOL_HINTS = Object.freeze([
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

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function tokenize(value) {
    return normalizeText(value)
      .toLowerCase()
      .split(/[^a-z0-9_\u4e00-\u9fa5]+/u)
      .filter(Boolean);
  }

  function detectTool(hostname, title) {
    const haystack = `${hostname || ""} ${title || ""}`.toLowerCase();
    const match = TOOL_HINTS.find(([needle]) => haystack.includes(needle));
    return match ? match[1] : "Web LLM";
  }

  function detectMode(input) {
    const text = normalizeText(input);
    const compact = text.replace(/\s+/g, "");
    if (!compact || compact.length <= 12) {
      return MODE.IDEA;
    }

    const structureMarkers = text.match(/目标|背景|约束|输出|验收|步骤|上下文|角色|格式|不要|必须|acceptance|context|constraint|output|steps|role/gi) || [];
    const hasStructure = structureMarkers.length > 0;
    const stronglyStructured = structureMarkers.length >= 3 && compact.length >= 40;
    const hasParagraphs = text.includes("\n") || /[。.!?]\s*\S/.test(text);
    const longEnough = compact.length >= 120;

    if ((longEnough && (hasStructure || hasParagraphs)) || stronglyStructured) {
      return MODE.POLISH;
    }

    return MODE.CONTINUE;
  }

  function parseSkillText(raw, sourceType) {
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
    const name = fields.name || (heading ? heading[1] : "Imported skill");
    const description =
      fields.description ||
      text
        .replace(/^---[\s\S]*?---/, "")
        .split(/\n/)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith("#")) ||
      "Imported local prompt or skill.";

    return {
      id: `skill-${slugify(name)}-${hashText(text).slice(0, 6)}`,
      name,
      description,
      tags: tokenize(`${name} ${description}`).slice(0, 20),
      body: text,
      risk_level: "text-only",
      source_type: sourceType || "imported"
    };
  }

  function slugify(value) {
    return normalizeText(value)
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "skill";
  }

  function hashText(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function rankSkills(input, context, importedSkills, limit) {
    const skills = [...DEFAULT_SKILLS, ...(Array.isArray(importedSkills) ? importedSkills : [])];
    const inputTokens = new Set(tokenize(`${input || ""} ${context?.tool || ""} ${context?.host || ""}`));
    const ranked = skills
      .map((skill) => {
        const skillTokens = tokenize(`${skill.name || ""} ${skill.description || ""} ${(skill.tags || []).join(" ")}`);
        const overlap = skillTokens.filter((token) => inputTokens.has(token)).length;
        const toolBoost = skill.allowed_tools?.some((tool) => String(context?.tool || "").toLowerCase().includes(String(tool).toLowerCase()))
          ? 2
          : 0;
        const builtinBoost = skill.source_type === "builtin" ? 0.3 : 0.6;
        return {
          ...skill,
          score: overlap + toolBoost + builtinBoost
        };
      })
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

    return ranked.slice(0, limit || 3);
  }

  function buildPrompt(input, context, skills, variantIndex) {
    const text = normalizeText(input);
    const mode = detectMode(text);
    const meta = MODE_META[mode];
    const tool = context?.tool || detectTool(context?.host, context?.title);
    const skillNames = skills?.length ? skills.map((skill) => skill.name).join(", ") : "无";
    const variant = Number.isFinite(variantIndex) ? variantIndex % 3 : 0;

    if (mode === MODE.IDEA) {
      const idea = text || "我想让 AI 帮我把当前想法变成可执行方案";
      const angle = [
        "先澄清目标、用户和成功标准，再给出可执行方案",
        "先列出 3 个方向供我选择，再展开最推荐的一版",
        "先把模糊需求拆成任务、约束、交付物和验证方式"
      ][variant];
      return [
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
      ].join("\n");
    }

    if (mode === MODE.CONTINUE) {
      const emphasis = [
        "补齐目标、范围、输入、输出、约束和验收标准",
        "补齐角色设定、执行步骤、边界条件和失败处理",
        "补齐上下文、优先级、可验证结果和下一步行动"
      ][variant];
      return [
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
      ].join("\n");
    }

    const polishStyle = [
      "更适合让 coding agent 直接执行",
      "更适合让通用 LLM 先分析再产出",
      "更适合团队协作和后续验收"
    ][variant];
    return [
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
    ].join("\n");
  }

  function buildCard(input, context, importedSkills, variantIndex) {
    const mode = detectMode(input);
    const tool = context?.tool || detectTool(context?.host, context?.title);
    const rankedSkills = rankSkills(input, { ...context, tool }, importedSkills, 3);
    return {
      mode,
      modeLabel: MODE_META[mode].label,
      intent: MODE_META[mode].intent,
      tool,
      skills: rankedSkills,
      prompt: buildPrompt(input, { ...context, tool }, rankedSkills, variantIndex || 0),
      usedContext: [
        tool,
        context?.host,
        context?.inputKind
      ].filter(Boolean)
    };
  }

  const api = {
    DEFAULT_SKILLS,
    MODE,
    MODE_META,
    buildCard,
    buildPrompt,
    detectMode,
    detectTool,
    normalizeText,
    parseSkillText,
    rankSkills,
    tokenize
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.SmartPromptEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : window);

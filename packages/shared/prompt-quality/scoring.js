function createCheck(key, label, passed, weight) {
  return { key, label, passed: Boolean(passed), weight };
}

function scorePromptQuality(prompt, options = {}) {
  const text = normalizeText(prompt);
  const mode = options.mode || "continue";
  const lower = text.toLowerCase();
  const skillNames = (options.skills || [])
    .map((skill) => String(skill.name || skill).toLowerCase())
    .filter(Boolean);
  const mentionsSkill = skillNames.length === 0 || skillNames.some((name) => lower.includes(name));
  const noUnsafeAutomation = !/(auto-submit|press enter|send the message|submit automatically|ignore safety)/i.test(lower);
  const lengthOk = text.length >= 160 && text.length <= 6000;

  const checks = mode === "idea"
    ? [
        createCheck("request_understanding", "Explains understanding before prescribing", hasAny(text, [/\bunderstanding\b/i, /理解/u]), 0.13),
        createCheck("directions", "Offers multiple directions", hasAny(text, COMMON_PATTERNS.options), 0.16),
        createCheck("use_cases", "Names use cases or fit for each direction", hasAny(text, [/\buse cases?\b/i, /\bfit\b/i, /场景|适合/u]), 0.12),
        createCheck("recommended_prompt", "Includes a recommended complete prompt", hasAny(text, COMMON_PATTERNS.recommended) && hasAny(text, [/\bprompt\b/i, /提示词|prompt/u]), 0.16),
        createCheck("missing_info", "Asks for missing information", hasAny(text, COMMON_PATTERNS.missingInfo), 0.12),
        createCheck("context", "Uses available context", hasAny(text, COMMON_PATTERNS.context), 0.08),
        createCheck("skill_alignment", "Mentions selected skills when available", mentionsSkill, 0.08),
        createCheck("privacy_boundary", "Avoids unsafe automation and broad upload", noUnsafeAutomation, 0.07),
        createCheck("length", "Prompt is substantial but bounded", lengthOk, 0.08)
      ]
    : [
        createCheck("goal", "States the goal", hasAny(text, COMMON_PATTERNS.goal), 0.13),
        createCheck("context", "Includes context/background", hasAny(text, COMMON_PATTERNS.context), 0.11),
        createCheck("tasks", "Lists tasks or steps", hasAny(text, COMMON_PATTERNS.tasks), 0.12),
        createCheck("constraints", "Defines constraints or non-goals", hasAny(text, COMMON_PATTERNS.constraints), 0.11),
        createCheck("output_format", "Defines output format", hasAny(text, COMMON_PATTERNS.outputFormat), 0.11),
        createCheck("acceptance", "Defines acceptance or verification criteria", hasAny(text, COMMON_PATTERNS.acceptance), 0.14),
        createCheck("missing_info", "Marks uncertainties or missing info", mode === "polish" ? hasAny(text, COMMON_PATTERNS.missingInfo) : true, 0.08),
        createCheck("skill_alignment", "Mentions selected skills when available", mentionsSkill, 0.08),
        createCheck("privacy_boundary", "Avoids unsafe automation and broad upload", noUnsafeAutomation, 0.08),
        createCheck("length", "Prompt is substantial but bounded", lengthOk, 0.08)
      ];

  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const earned = checks.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0);
  const score = round(totalWeight ? earned / totalWeight : 0);
  return {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    mode,
    score,
    pass: score >= Number(options.minScore || 0.72),
    promptLength: text.length,
    checks,
    failedChecks: checks.filter((check) => !check.passed).map((check) => check.key)
  };
}

function topEntries(object = {}, limit = 3) {
  return Object.entries(object)
    .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0) || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([key, value]) => ({ key, value }));
}

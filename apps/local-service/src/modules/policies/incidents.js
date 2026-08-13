"use strict";

function classifyCodexInsertPolicyIncident(inserted = {}) {
  const result = inserted?.result || {};
  const reasonToken = String(result.reasonToken || "").trim().toLowerCase();
  if (result.noAutoSubmit === false || reasonToken === "safety_auto_submit_signal") {
    return "auto_submit_incident";
  }
  if (reasonToken === "after_write_mismatch" || reasonToken === "target_changed_written_draft") {
    return "miswrite_incident";
  }
  if (reasonToken === "write_failed_clipboard_restore") return "privacy_incident";
  if (["safety_atomic_guard_bypassed", "safety_direct_write_bypassed"].includes(reasonToken)) {
    return "safety_incident";
  }
  return null;
}

module.exports = Object.freeze({ classifyCodexInsertPolicyIncident });

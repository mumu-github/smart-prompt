document.getElementById("options-button").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

chrome.storage.local.get(["smartPromptSkills"], (values) => {
  const count = Array.isArray(values.smartPromptSkills) ? values.smartPromptSkills.length : 0;
  document.getElementById("status").textContent = `${count} imported skills`;
});

(function initOptions() {
  const engine = globalThis.SmartPromptEngine;
  const key = "smartPromptSkills";

  const els = {
    count: document.getElementById("skill-count"),
    list: document.getElementById("skill-list"),
    text: document.getElementById("skill-text"),
    file: document.getElementById("skill-file"),
    importButton: document.getElementById("import-button")
  };

  function storageGet() {
    return new Promise((resolve) => chrome.storage.local.get([key], resolve));
  }

  function storageSet(skills) {
    return new Promise((resolve) => chrome.storage.local.set({ [key]: skills }, resolve));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function getSkills() {
    const values = await storageGet();
    return Array.isArray(values[key]) ? values[key] : [];
  }

  async function render() {
    const skills = await getSkills();
    els.count.textContent = `${skills.length} skills`;
    if (!skills.length) {
      els.list.innerHTML = '<div class="empty">暂无导入内容</div>';
      return;
    }

    els.list.innerHTML = skills
      .map((skill) => `
        <article class="skill-item">
          <div>
            <div class="skill-name">${escapeHtml(skill.name)}</div>
            <div class="skill-desc">${escapeHtml(skill.description || "")}</div>
          </div>
          <button type="button" class="danger" data-id="${escapeHtml(skill.id)}">Remove</button>
        </article>
      `)
      .join("");
  }

  async function readFiles() {
    const files = Array.from(els.file.files || []);
    const texts = await Promise.all(files.map((file) => file.text()));
    return texts;
  }

  async function importSkills() {
    const chunks = [];
    if (els.text.value.trim()) chunks.push(els.text.value);
    chunks.push(...await readFiles());

    const parsed = chunks
      .map((chunk) => engine.parseSkillText(chunk, "user-import"))
      .filter(Boolean);

    if (!parsed.length) return;

    const existing = await getSkills();
    const merged = [...parsed, ...existing].filter((skill, index, all) => {
      return all.findIndex((item) => item.id === skill.id) === index;
    });
    await storageSet(merged);
    els.text.value = "";
    els.file.value = "";
    await render();
  }

  async function removeSkill(id) {
    const skills = await getSkills();
    await storageSet(skills.filter((skill) => skill.id !== id));
    await render();
  }

  els.importButton.addEventListener("click", importSkills);
  els.list.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-id]");
    if (button) removeSkill(button.dataset.id);
  });

  render();
})();

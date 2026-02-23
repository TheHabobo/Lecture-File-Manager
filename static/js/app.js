/* ============================================================
   Lecture File Manager – frontend JS
   ============================================================ */

// ---- State ----
let groups = [];
let files  = [];
let activeGroupFilter = null;  // null = all files
let openTabs = {};             // fileId -> { file, dirty }
let activeTabId = null;

// ---- Init ----
document.addEventListener("DOMContentLoaded", () => {
  loadGroups();
  loadFiles();
  bindUI();
});

// ============================================================
// API helpers
// ============================================================
async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body && !(body instanceof FormData)) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  } else if (body instanceof FormData) {
    opts.body = body;
  }
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

// ============================================================
// Groups
// ============================================================
async function loadGroups() {
  try {
    groups = await api("GET", "/api/groups");
    renderGroups();
    populateGroupSelects();
  } catch (e) { showToast("Error loading groups: " + e.message, true); }
}

function renderGroups() {
  const ul = document.getElementById("group-list");
  ul.innerHTML = "";
  groups.forEach(g => {
    const li = document.createElement("li");
    li.className = "group-item" + (activeGroupFilter === g.id ? " active" : "");
    li.dataset.id = g.id;
    li.innerHTML = `
      <span class="group-item-name">📁 ${escHtml(g.name)}</span>
      <span class="group-item-count">${g.file_count}</span>
      <span class="group-actions">
        <button class="btn-icon" title="Rename" onclick="openEditGroup(${g.id}, event)">✏️</button>
        <button class="btn-icon" title="Delete" onclick="confirmDeleteGroup(${g.id}, '${escAttr(g.name)}', event)">🗑</button>
      </span>`;
    li.addEventListener("click", () => setGroupFilter(g.id));
    ul.appendChild(li);
  });
}

function populateGroupSelects() {
  // Upload modal select
  const sel = document.getElementById("upload-group-select");
  sel.innerHTML = '<option value="">— None —</option>';
  groups.forEach(g => {
    const o = document.createElement("option");
    o.value = g.id;
    o.textContent = g.name;
    sel.appendChild(o);
  });

  // Update group selects inside open tabs
  Object.keys(openTabs).forEach(fid => refreshTabGroupSelect(parseInt(fid)));
}

function setGroupFilter(groupId) {
  activeGroupFilter = (activeGroupFilter === groupId) ? null : groupId;
  renderGroups();
  const label = document.getElementById("group-filter-label");
  const btn   = document.getElementById("btn-clear-filter");
  if (activeGroupFilter !== null) {
    const g = groups.find(x => x.id === activeGroupFilter);
    label.textContent = g ? `(${g.name})` : "";
    btn.style.display = "inline";
  } else {
    label.textContent = "";
    btn.style.display = "none";
  }
  loadFiles();
}

document.getElementById("btn-clear-filter").addEventListener("click", () => setGroupFilter(null));

// ---- Create / edit group ----
function openNewGroupModal() {
  document.getElementById("modal-group-title").textContent = "New Group";
  document.getElementById("edit-group-id").value = "";
  document.getElementById("group-name-input").value = "";
  showModal("modal-group");
  document.getElementById("group-name-input").focus();
}

function openEditGroup(groupId, e) {
  e.stopPropagation();
  const g = groups.find(x => x.id === groupId);
  if (!g) return;
  document.getElementById("modal-group-title").textContent = "Rename Group";
  document.getElementById("edit-group-id").value = g.id;
  document.getElementById("group-name-input").value = g.name;
  showModal("modal-group");
  document.getElementById("group-name-input").focus();
}

async function saveGroup() {
  const id   = document.getElementById("edit-group-id").value;
  const name = document.getElementById("group-name-input").value.trim();
  if (!name) { showToast("Group name cannot be empty", true); return; }
  try {
    if (id) {
      await api("PUT", `/api/groups/${id}`, { name });
      showToast("Group renamed");
    } else {
      await api("POST", "/api/groups", { name });
      showToast("Group created");
    }
    hideModal("modal-group");
    await loadGroups();
    await loadFiles();
  } catch (e) { showToast(e.message, true); }
}

function confirmDeleteGroup(groupId, name, e) {
  e.stopPropagation();
  confirm_(`Delete group "${name}"? Files will be unassigned but not deleted.`, async () => {
    try {
      await api("DELETE", `/api/groups/${groupId}`);
      if (activeGroupFilter === groupId) setGroupFilter(null);
      await loadGroups();
      await loadFiles();
      // Refresh open tab selects
      Object.keys(openTabs).forEach(fid => {
        if (openTabs[fid].file.group_id === groupId) {
          openTabs[fid].file.group_id = null;
          openTabs[fid].file.group_name = null;
        }
        refreshTabGroupSelect(parseInt(fid));
      });
      showToast("Group deleted");
    } catch (e) { showToast(e.message, true); }
  });
}

// ============================================================
// Files
// ============================================================
async function loadFiles() {
  try {
    const qs = activeGroupFilter !== null ? `?group_id=${activeGroupFilter}` : "";
    files = await api("GET", "/api/files" + qs);
    renderFiles();
  } catch (e) { showToast("Error loading files: " + e.message, true); }
}

function renderFiles() {
  const ul = document.getElementById("file-list");
  ul.innerHTML = "";
  if (files.length === 0) {
    ul.innerHTML = '<li style="padding:10px 14px;color:#adb5bd;font-style:italic">No files yet</li>';
    return;
  }
  files.forEach(f => {
    const li = document.createElement("li");
    li.className = "file-item" + (openTabs[f.id] && activeTabId === f.id ? " active" : "");
    li.dataset.id = f.id;
    li.innerHTML = `
      <span class="file-item-icon">📄</span>
      <span class="file-item-name" title="${escAttr(f.original_name)}">${escHtml(f.original_name)}</span>
      <span class="file-actions">
        <button class="btn-icon" title="Delete" onclick="confirmDeleteFile(${f.id}, '${escAttr(f.original_name)}', event)">🗑</button>
      </span>`;
    li.addEventListener("click", () => openFileTab(f.id));
    ul.appendChild(li);
  });
}

function confirmDeleteFile(fileId, name, e) {
  e.stopPropagation();
  confirm_(`Permanently delete "${name}"?`, async () => {
    try {
      await api("DELETE", `/api/files/${fileId}`);
      closeTab(fileId);
      await loadFiles();
      showToast("File deleted");
    } catch (e) { showToast(e.message, true); }
  });
}

// ============================================================
// Upload
// ============================================================
function openUploadModal() {
  document.getElementById("upload-status").innerHTML = "";
  showModal("modal-upload");
}

async function uploadFiles(fileList) {
  const statusDiv = document.getElementById("upload-status");
  const groupId   = document.getElementById("upload-group-select").value;
  let uploaded = 0;

  for (const file of fileList) {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      statusDiv.innerHTML += `<p style="color:#dc3545">⚠ "${escHtml(file.name)}" is not a PDF – skipped.</p>`;
      continue;
    }
    const fd = new FormData();
    fd.append("file", file);
    if (groupId) fd.append("group_id", groupId);
    try {
      statusDiv.innerHTML += `<p>⬆ Uploading "${escHtml(file.name)}"…</p>`;
      await api("POST", "/api/files/upload", fd);
      statusDiv.innerHTML += `<p style="color:#198754">✓ "${escHtml(file.name)}" uploaded.</p>`;
      uploaded++;
    } catch (err) {
      statusDiv.innerHTML += `<p style="color:#dc3545">✗ "${escHtml(file.name)}": ${escHtml(err.message)}</p>`;
    }
  }

  if (uploaded > 0) {
    await loadGroups();
    await loadFiles();
    showToast(`${uploaded} file(s) uploaded`);
  }
}

// ============================================================
// Tabs
// ============================================================
async function openFileTab(fileId) {
  if (openTabs[fileId]) {
    activateTab(fileId);
    return;
  }
  try {
    const file = await api("GET", `/api/files/${fileId}`);
    openTabs[fileId] = { file, dirty: false };
    createTabElement(file);
    createTabPanel(file);
    activateTab(fileId);
    document.getElementById("tab-placeholder").style.display = "none";
  } catch (e) { showToast("Error opening file: " + e.message, true); }
}

function createTabElement(file) {
  const tabBar = document.getElementById("tab-bar");
  const tab = document.createElement("div");
  tab.className = "tab";
  tab.id = `tab-${file.id}`;
  tab.innerHTML = `
    <span class="tab-name" title="${escAttr(file.original_name)}">${escHtml(shortName(file.original_name, 22))}</span>
    <button class="tab-close" onclick="closeTab(${file.id});event.stopPropagation()">×</button>`;
  tab.addEventListener("click", () => activateTab(file.id));
  tabBar.appendChild(tab);
}

function createTabPanel(file) {
  const content = document.getElementById("tab-content");
  const panel = document.createElement("div");
  panel.className = "tab-panel";
  panel.id = `panel-${file.id}`;

  const groupOptions = groups.map(g =>
    `<option value="${g.id}" ${file.group_id === g.id ? "selected" : ""}>${escHtml(g.name)}</option>`
  ).join("");

  panel.innerHTML = `
    <div class="panel-header">
      <input class="panel-filename-input" id="fname-${file.id}" value="${escAttr(file.original_name)}" />
      <span class="panel-meta">Uploaded ${formatDate(file.uploaded_at)}</span>
      <select class="panel-group-select" id="pgroup-${file.id}" onchange="changeFileGroup(${file.id})">
        <option value="">— No group —</option>
        ${groupOptions}
      </select>
      <button class="btn btn-danger btn-sm" onclick="confirmDeleteFile(${file.id}, '${escAttr(file.original_name)}', event)">🗑 Delete</button>
    </div>

    <div class="pdf-viewer-wrap">
      <iframe src="/api/files/${file.id}/pdf#toolbar=1" title="${escAttr(file.original_name)}"></iframe>
    </div>

    <div class="info-card">
      <div class="info-card-header">
        <span class="info-card-title">Description</span>
      </div>
      <textarea id="desc-${file.id}" placeholder="Add a description for this file…">${escHtml(file.description || "")}</textarea>
    </div>

    <div class="info-card">
      <div class="info-card-header">
        <span class="info-card-title">Summary</span>
        <span class="ai-badge">🤖 AI-ready</span>
      </div>
      <textarea id="summary-${file.id}" placeholder="Summary will appear here. You can also type manually…">${escHtml(file.summary || "")}</textarea>
      <div class="info-card-actions" style="margin-top:10px">
        <button class="btn btn-outline btn-sm" id="btn-ai-${file.id}" onclick="runAISummary(${file.id})">
          🤖 Generate AI Summary
        </button>
        <button class="btn btn-success btn-sm" onclick="saveFileDetails(${file.id})">💾 Save</button>
      </div>
    </div>`;

  // Track changes
  panel.querySelector(`#fname-${file.id}`).addEventListener("input", () => { openTabs[file.id].dirty = true; });
  panel.querySelector(`#desc-${file.id}`).addEventListener("input",  () => { openTabs[file.id].dirty = true; });
  panel.querySelector(`#summary-${file.id}`).addEventListener("input", () => { openTabs[file.id].dirty = true; });

  content.appendChild(panel);
}

function refreshTabGroupSelect(fileId) {
  const sel = document.getElementById(`pgroup-${fileId}`);
  if (!sel) return;
  const file = openTabs[fileId]?.file;
  const groupOptions = groups.map(g =>
    `<option value="${g.id}" ${file && file.group_id === g.id ? "selected" : ""}>${escHtml(g.name)}</option>`
  ).join("");
  sel.innerHTML = `<option value="">— No group —</option>${groupOptions}`;
}

function activateTab(fileId) {
  activeTabId = fileId;
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  const tab   = document.getElementById(`tab-${fileId}`);
  const panel = document.getElementById(`panel-${fileId}`);
  if (tab)   tab.classList.add("active");
  if (panel) panel.classList.add("active");
  renderFiles(); // highlight sidebar item
}

function closeTab(fileId) {
  if (openTabs[fileId]?.dirty) {
    confirm_("You have unsaved changes. Close without saving?", () => _doCloseTab(fileId));
    return;
  }
  _doCloseTab(fileId);
}

function _doCloseTab(fileId) {
  delete openTabs[fileId];
  document.getElementById(`tab-${fileId}`)?.remove();
  document.getElementById(`panel-${fileId}`)?.remove();
  if (activeTabId === fileId) {
    activeTabId = null;
    const remaining = Object.keys(openTabs);
    if (remaining.length > 0) {
      activateTab(parseInt(remaining[remaining.length - 1]));
    } else {
      document.getElementById("tab-placeholder").style.display = "";
    }
  }
  renderFiles();
}

async function saveFileDetails(fileId) {
  const fname   = document.getElementById(`fname-${fileId}`).value.trim();
  const desc    = document.getElementById(`desc-${fileId}`).value;
  const summary = document.getElementById(`summary-${fileId}`).value;
  try {
    const updated = await api("PUT", `/api/files/${fileId}`, {
      original_name: fname, description: desc, summary,
    });
    openTabs[fileId].file = updated;
    openTabs[fileId].dirty = false;
    // Update tab label
    const tabName = document.querySelector(`#tab-${fileId} .tab-name`);
    if (tabName) tabName.textContent = shortName(updated.original_name, 22);
    await loadFiles();
    showToast("Saved");
  } catch (e) { showToast("Save failed: " + e.message, true); }
}

async function changeFileGroup(fileId) {
  const sel = document.getElementById(`pgroup-${fileId}`);
  const groupId = sel.value ? parseInt(sel.value) : null;
  try {
    const updated = await api("PUT", `/api/files/${fileId}`, { group_id: groupId });
    openTabs[fileId].file = updated;
    await loadGroups();
    await loadFiles();
    showToast("Group updated");
  } catch (e) { showToast("Error: " + e.message, true); }
}

async function runAISummary(fileId) {
  const btn = document.getElementById(`btn-ai-${fileId}`);
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generating…';
  try {
    const result = await api("POST", `/api/files/${fileId}/summarize`);
    document.getElementById(`summary-${fileId}`).value = result.summary;
    openTabs[fileId].file.summary = result.summary;
    openTabs[fileId].dirty = true;
    showToast("AI summary generated");
  } catch (e) {
    showToast("AI summary failed: " + e.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🤖 Generate AI Summary';
  }
}

// ============================================================
// UI bindings
// ============================================================
function bindUI() {
  document.getElementById("btn-upload").addEventListener("click", openUploadModal);
  document.getElementById("btn-new-group").addEventListener("click", openNewGroupModal);
  document.getElementById("btn-save-group").addEventListener("click", saveGroup);
  document.getElementById("group-name-input").addEventListener("keydown", e => {
    if (e.key === "Enter") saveGroup();
  });

  // Modal close buttons
  document.querySelectorAll(".modal-close").forEach(btn => {
    btn.addEventListener("click", () => hideModal(btn.dataset.modal));
  });
  // Click outside modal to close
  document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", e => {
      if (e.target === overlay) hideModal(overlay.id);
    });
  });

  // File input
  const fileInput = document.getElementById("file-input");
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) uploadFiles(Array.from(fileInput.files));
  });

  // Drag & drop
  const dropZone = document.getElementById("drop-zone");
  dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("drag-over"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
  dropZone.addEventListener("drop", e => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    if (e.dataTransfer.files.length) uploadFiles(Array.from(e.dataTransfer.files));
  });

  // Confirm modal buttons
  document.getElementById("btn-confirm-no").addEventListener("click", () => hideModal("modal-confirm"));
}

// ============================================================
// Confirm dialog helper
// ============================================================
let _confirmCallback = null;
function confirm_(message, callback) {
  _confirmCallback = callback;
  document.getElementById("confirm-message").textContent = message;
  showModal("modal-confirm");
}
document.getElementById("btn-confirm-yes").addEventListener("click", () => {
  hideModal("modal-confirm");
  if (_confirmCallback) { _confirmCallback(); _confirmCallback = null; }
});

// ============================================================
// Modal helpers
// ============================================================
function showModal(id) { document.getElementById(id).style.display = "flex"; }
function hideModal(id) { document.getElementById(id).style.display = "none"; }

// ============================================================
// Toast
// ============================================================
let _toastTimer = null;
function showToast(msg, isError = false) {
  let toast = document.getElementById("__toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "__toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.background = isError ? "#dc3545" : "#212529";
  toast.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
}

// ============================================================
// Utility
// ============================================================
function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function escAttr(s) {
  return String(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function shortName(name, max) {
  if (name.length <= max) return escHtml(name);
  return escHtml(name.substring(0, max - 1)) + "…";
}
function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" });
}

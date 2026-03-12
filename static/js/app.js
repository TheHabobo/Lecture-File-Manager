/* ============================================================
   Lecture File Manager – GoodNotes-style frontend
   ============================================================ */

// ---- Palette for group cards (cycles) ----
const GROUP_COLORS = [
  '#E8754A', '#5B8FD6', '#4CAF82', '#9B72CF',
  '#E8A23A', '#D65B8F', '#4ABACC', '#8DB85A',
];

// ---- State ----
let groups     = [];
let allFiles   = [];
let currentSubgroups = [];
let currentView  = 'library';
let currentGroup = null;
let currentSubgroup = null;
let currentFile  = null;
let filesDirty   = false;
let fileSplitLayout = true;  // true = split view, false = centered view
let fileSplitRatio = 0.6;    // left (PDF) panel width ratio

// ---- Init ----
document.addEventListener("DOMContentLoaded", () => {
  loadLibrary();
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
// Library (main menu)
// ============================================================
async function loadLibrary() {
  try {
    [groups, allFiles] = await Promise.all([
      api("GET", "/api/groups"),
      api("GET", "/api/files"),
    ]);
    renderLibrary();
    populateGroupSelects();
    updateTopbar();
  } catch (e) { showToast("Error loading library: " + e.message, true); }
}

async function reorderGroupsInLibrary(draggedGroupId, targetGroupId) {
  const orderedIds = groups.map(g => g.id);
  const fromIdx = orderedIds.indexOf(draggedGroupId);
  const toIdx = orderedIds.indexOf(targetGroupId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;

  orderedIds.splice(fromIdx, 1);
  orderedIds.splice(toIdx, 0, draggedGroupId);

  await api("PUT", "/api/groups/reorder", { group_ids: orderedIds });
  await loadLibrary();
}

async function reorderSubgroupsInCurrentGroup(draggedSubgroupId, targetSubgroupId) {
  if (!currentGroup || currentGroup.id === 'uncategorized') return;
  const orderedIds = currentSubgroups.map(s => s.id);
  const fromIdx = orderedIds.indexOf(draggedSubgroupId);
  const toIdx = orderedIds.indexOf(targetSubgroupId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;

  orderedIds.splice(fromIdx, 1);
  orderedIds.splice(toIdx, 0, draggedSubgroupId);

  await api("PUT", `/api/groups/${currentGroup.id}/subgroups/reorder`, { subgroup_ids: orderedIds });
  await loadLibrary();
  await navigateToGroup(currentGroup.id, currentGroup.name);
}

function renderLibrary() {
  const grid = document.getElementById("group-grid");
  grid.innerHTML = "";

  groups.forEach((g, idx) => {
    const color = GROUP_COLORS[idx % GROUP_COLORS.length];
    const card = document.createElement("div");
    card.className = "group-card";
    card.draggable = true;
    card.dataset.groupId = g.id;
    card.innerHTML =
      `<div class="group-card-cover" style="background:${color}">` +
        `<div class="group-card-icon">📁</div>` +
      `</div>` +
      `<div class="group-card-body">` +
        `<div class="group-card-name">${escHtml(g.name)}</div>` +
        `<div class="group-card-meta">${g.file_count} ${g.file_count === 1 ? 'file' : 'files'} · ${g.subgroup_count || 0} ${((g.subgroup_count || 0) === 1) ? 'group' : 'groups'}</div>` +
        `<div class="group-card-actions">` +
          `<button class="card-action-btn" title="Rename" onclick="openEditGroup(${g.id}, event)">✏️</button>` +
          `<button class="card-action-btn danger" title="Delete" onclick="confirmDeleteGroup(${g.id}, '${escAttr(g.name)}', event)">🗑</button>` +
        `</div>` +
      `</div>`;
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("application/x-fms-group-id", String(g.id));
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      document.querySelectorAll(".drag-over-card").forEach(el => el.classList.remove("drag-over-card"));
    });

    // Drop target: move file into this group
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      card.classList.add("drag-over-card");
    });
    card.addEventListener("dragleave", () => card.classList.remove("drag-over-card"));
    card.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove("drag-over-card");

      const draggedGroupId = parseInt(e.dataTransfer.getData("application/x-fms-group-id"));
      if (draggedGroupId && draggedGroupId !== g.id) {
        try {
          await reorderGroupsInLibrary(draggedGroupId, g.id);
        } catch (err) {
          showToast("Group reorder failed: " + err.message, true);
        }
        return;
      }

      const fileId = parseInt(e.dataTransfer.getData("text/plain"));
      if (!fileId) return;
      try {
        await moveFileWithUndo(fileId, g.id, null, `Moved to ${g.name}`);
      } catch (err) { showToast("Move failed: " + err.message, true); }
    });
    card.addEventListener("click", () => navigateToGroup(g.id, g.name));
    grid.appendChild(card);
  });

  const ungrouped = allFiles.filter(f => !f.group_id);
  if (ungrouped.length > 0) {
    const card = document.createElement("div");
    card.className = "group-card";
    card.innerHTML =
      `<div class="group-card-cover" style="background:#9E9E9E">` +
        `<div class="group-card-icon">📄</div>` +
      `</div>` +
      `<div class="group-card-body">` +
        `<div class="group-card-name">Uncategorized</div>` +
        `<div class="group-card-meta">${ungrouped.length} ${ungrouped.length === 1 ? 'file' : 'files'}</div>` +
      `</div>`;
    card.addEventListener("click", () => navigateToGroup('uncategorized', 'Uncategorized'));
    grid.appendChild(card);
  }

  if (groups.length === 0 && allFiles.length === 0) {
    grid.innerHTML =
      `<div class="empty-state">` +
        `<div class="empty-icon">📚</div>` +
        `<div class="empty-title">Your library is empty</div>` +
        `<div class="empty-sub">Create a group or upload a PDF to get started</div>` +
      `</div>`;
  }
}

// ============================================================
// Group View
// ============================================================
async function navigateToGroup(groupId, groupName, subgroupId = null, subgroupName = null) {
  try {
    let files;
    let subgroups = [];
    if (groupId === 'uncategorized') {
      files = allFiles.filter(f => !f.group_id);
      subgroupId = null;
      subgroupName = null;
    } else {
      const filePath = subgroupId
        ? `/api/files?group_id=${groupId}&subgroup_id=${subgroupId}`
        : `/api/files?group_id=${groupId}&root_only=1`;
      [files, subgroups] = await Promise.all([
        api("GET", filePath),
        api("GET", `/api/groups/${groupId}/subgroups`),
      ]);
      if (subgroupId && !subgroupName) {
        const matched = subgroups.find(s => s.id === subgroupId);
        subgroupName = matched ? matched.name : "Under-Group";
      }
    }
    files.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    currentGroup = { id: groupId, name: groupName };
    currentSubgroup = subgroupId ? { id: subgroupId, name: subgroupName } : null;
    currentSubgroups = subgroups;
    currentView  = 'group';
    showView('view-group');
    document.getElementById("group-view-title").textContent = currentSubgroup
      ? `${groupName} / ${subgroupName}`
      : groupName;
    const addBtn = document.getElementById("btn-add-unassigned");
    if (addBtn) {
      addBtn.style.display = (groupId === 'uncategorized') ? "none" : "inline-flex";
    }
    const shareBtn = document.getElementById("btn-share-group");
    if (shareBtn) {
      shareBtn.style.display = (groupId === 'uncategorized') ? "none" : "inline-flex";
    }
    updateTopbar();
    renderFileGrid(files, subgroups);
  } catch (e) { showToast("Error loading group: " + e.message, true); }
}

async function refreshAfterMove() {
  await loadLibrary();
  if (currentView === 'group' && currentGroup) {
    await navigateToGroup(currentGroup.id, currentGroup.name, currentSubgroup?.id, currentSubgroup?.name);
  }
}

async function moveFileWithUndo(fileId, targetGroupId, targetSubgroupId, successMessage) {
  const file = allFiles.find(f => f.id === fileId) || await api("GET", `/api/files/${fileId}`);
  const fromGroupId = file.group_id ?? null;
  const fromSubgroupId = file.subgroup_id ?? null;
  const toGroupId = targetGroupId ?? null;
  const toSubgroupId = targetSubgroupId ?? null;

  if (fromGroupId === toGroupId && fromSubgroupId === toSubgroupId) {
    showToast("File is already in this location");
    return;
  }

  await api("PUT", `/api/files/${fileId}/move`, {
    group_id: toGroupId,
    subgroup_id: toSubgroupId,
  });
  await refreshAfterMove();

  showToast(successMessage, false, "Undo", async () => {
    try {
      await api("PUT", `/api/files/${fileId}/move`, {
        group_id: fromGroupId,
        subgroup_id: fromSubgroupId,
      });
      await refreshAfterMove();
      showToast("Move undone");
    } catch (err) {
      showToast("Undo failed: " + err.message, true);
    }
  });
}

async function openShareGroupModal() {
  if (!currentGroup || currentGroup.id === 'uncategorized') return;
  try {
    const result = await api("POST", `/api/groups/${currentGroup.id}/share`);
    const shareUrl = `${location.origin}/shared/${result.share_token}`;
    document.getElementById("share-link-input").value = shareUrl;
    showModal("modal-share");
  } catch (e) {
    showToast("Could not generate share link: " + e.message, true);
  }
}

async function revokeShareLink() {
  if (!currentGroup || currentGroup.id === 'uncategorized') return;
  try {
    await api("DELETE", `/api/groups/${currentGroup.id}/share`);
    hideModal("modal-share");
    showToast("Share link revoked");
  } catch (e) {
    showToast("Could not revoke link: " + e.message, true);
  }
}

function copyShareLink() {
  const input = document.getElementById("share-link-input");
  navigator.clipboard.writeText(input.value).then(() => {
    showToast("Link copied to clipboard");
  }).catch(() => {
    input.select();
    document.execCommand("copy");
    showToast("Link copied to clipboard");
  });
}

async function openUnassignedPickerModal() {
  if (!currentGroup || currentGroup.id === 'uncategorized') {
    showToast("Open a regular group first", true);
    return;
  }
  try {
    const files = await api("GET", "/api/files");
    const unassigned = files.filter(f => !f.group_id);
    const list = document.getElementById("unassigned-file-list");
    const selectAll = document.getElementById("unassigned-select-all");
    if (selectAll) {
      selectAll.checked = false;
    }

    if (unassigned.length === 0) {
      list.innerHTML = '<div class="unassigned-empty">No unassigned files available.</div>';
      showModal("modal-unassigned");
      return;
    }

    list.innerHTML = unassigned.map(f =>
      `<label class="unassigned-item">` +
        `<input type="checkbox" class="unassigned-checkbox" value="${f.id}" />` +
        `<span class="unassigned-name" title="${escAttr(f.original_name)}">${escHtml(f.original_name)}</span>` +
      `</label>`
    ).join("");

    showModal("modal-unassigned");
  } catch (e) {
    showToast("Could not load unassigned files: " + e.message, true);
  }
}

async function assignSelectedUnassignedFiles() {
  if (!currentGroup || currentGroup.id === 'uncategorized') return;
  const checked = Array.from(document.querySelectorAll(".unassigned-checkbox:checked"));
  if (checked.length === 0) {
    showToast("Select at least one file", true);
    return;
  }

  const btn = document.getElementById("btn-assign-unassigned");
  const previousLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Adding...";

  try {
    await Promise.all(checked.map((box) => {
      const fileId = parseInt(box.value);
      return api("PUT", `/api/files/${fileId}`, {
        group_id: currentGroup.id,
        subgroup_id: currentSubgroup ? currentSubgroup.id : null,
      });
    }));

    hideModal("modal-unassigned");
    await loadLibrary();
    await navigateToGroup(currentGroup.id, currentGroup.name, currentSubgroup?.id, currentSubgroup?.name);
    showToast(`${checked.length} file(s) added`);
  } catch (e) {
    showToast("Could not add selected files: " + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = previousLabel;
  }
}

function renderFileGrid(files, subgroups = []) {
  const grid = document.getElementById("file-grid");
  grid.innerHTML = "";

  if (!currentSubgroup && currentGroup && currentGroup.id !== 'uncategorized') {
    const addCard = document.createElement("div");
    addCard.className = "group-card";
    addCard.innerHTML =
      `<div class="group-card-cover" style="background:#d6e7ff">` +
        `<div class="group-card-icon">＋</div>` +
      `</div>` +
      `<div class="group-card-body">` +
        `<div class="group-card-name">New Under-Group</div>` +
        `<div class="group-card-meta">Create a folder inside this group</div>` +
      `</div>`;
    addCard.addEventListener("click", openNewSubgroupModal);
    grid.appendChild(addCard);

    subgroups.forEach((s, idx) => {
      const color = GROUP_COLORS[idx % GROUP_COLORS.length];
      const card = document.createElement("div");
      card.className = "group-card";
      card.draggable = true;
      card.dataset.subgroupId = s.id;
      card.innerHTML =
        `<div class="group-card-cover" style="background:${color}">` +
          `<div class="group-card-icon">📂</div>` +
        `</div>` +
        `<div class="group-card-body">` +
          `<div class="group-card-name">${escHtml(s.name)}</div>` +
          `<div class="group-card-meta">${s.file_count} ${s.file_count === 1 ? 'file' : 'files'}</div>` +
          `<div class="group-card-actions">` +
            `<button class="card-action-btn" title="Rename" onclick="openEditSubgroup(${s.id}, event)">✏️</button>` +
            `<button class="card-action-btn danger" title="Delete" onclick="confirmDeleteSubgroup(${s.id}, '${escAttr(s.name)}', event)">🗑</button>` +
          `</div>` +
        `</div>`;

        card.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("application/x-fms-subgroup-id", String(s.id));
          e.dataTransfer.effectAllowed = "move";
          card.classList.add("dragging");
        });
        card.addEventListener("dragend", () => {
          card.classList.remove("dragging");
          document.querySelectorAll(".drag-over-card").forEach(el => el.classList.remove("drag-over-card"));
        });

      // Drop target: move file into this subgroup
      card.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        card.classList.add("drag-over-card");
      });
      card.addEventListener("dragleave", () => card.classList.remove("drag-over-card"));
      card.addEventListener("drop", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        card.classList.remove("drag-over-card");

        const draggedSubgroupId = parseInt(e.dataTransfer.getData("application/x-fms-subgroup-id"));
        if (draggedSubgroupId && draggedSubgroupId !== s.id) {
          try {
            await reorderSubgroupsInCurrentGroup(draggedSubgroupId, s.id);
          } catch (err) {
            showToast("Under-group reorder failed: " + err.message, true);
          }
          return;
        }

        const fileId = parseInt(e.dataTransfer.getData("text/plain"));
        if (!fileId) return;
        try {
          await moveFileWithUndo(fileId, currentGroup.id, s.id, `Moved to ${s.name}`);
        } catch (err) { showToast("Move failed: " + err.message, true); }
      });
      card.addEventListener("click", () => navigateToGroup(currentGroup.id, currentGroup.name, s.id, s.name));
      grid.appendChild(card);
    });
  }

  if (files.length === 0 && grid.children.length === 0) {
    grid.innerHTML =
      `<div class="empty-state">` +
        `<div class="empty-icon">\uD83D\uDCC4</div>` +
        `<div class="empty-title">No files yet</div>` +
        `<div class="empty-sub">Upload a PDF to this group to get started</div>` +
      `</div>`;
    return;
  }

  files.forEach((f, idx) => {
    const num  = idx + 1;
    const date = formatDate(f.uploaded_at);
    const card = document.createElement("div");
    card.className = "file-card";
    card.draggable = true;
    card.dataset.fileId = f.id;
    const assignBtn = 
      `<button class="file-card-assign" title="Assign to group"` +
        ` onclick="openAssignFileModal(${f.id}, '${escAttr(f.original_name)}', event)">\u2795</button>`;
    card.innerHTML =
      `<div class="file-card-preview">` +
        `<div class="file-card-preview-img" style="background-image:url(/api/files/${f.id}/pdf?size=thumb)"></div>` +
        `<div class="file-card-number">#${num}</div>` +
        `<div class="file-card-pdf-badge">PDF</div>` +
        `<div class="file-card-date">${date}</div>` +
        `<button class="file-card-delete card-action-btn danger" title="Delete"` +
          ` onclick="confirmDeleteFileThenRefresh(${f.id}, '${escAttr(f.original_name)}', event)">\uD83D\uDDD1</button>` +
        assignBtn +
      `</div>` +
      `<div class="file-card-footer">` +
        `<span class="file-card-name" title="${escAttr(f.original_name)}">${escHtml(shortName(f.original_name, 26))}</span>` +
      `</div>`;

    // Drag events for reordering
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", f.id);
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      document.querySelectorAll(".drag-over-card").forEach(el => el.classList.remove("drag-over-card"));
    });
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const dragging = grid.querySelector(".dragging");
      if (dragging && dragging !== card && card.classList.contains("file-card")) {
        card.classList.add("drag-over-card");
      }
    });
    card.addEventListener("dragleave", () => {
      card.classList.remove("drag-over-card");
    });
    card.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove("drag-over-card");
      const draggedId = parseInt(e.dataTransfer.getData("text/plain"));
      if (draggedId === f.id) return;
      // Reorder: collect all file cards in current DOM order, move dragged before/after drop target
      const fileCards = Array.from(grid.querySelectorAll(".file-card"));
      const ids = fileCards.map(c => parseInt(c.dataset.fileId));
      const fromIdx = ids.indexOf(draggedId);
      const toIdx = ids.indexOf(f.id);
      if (fromIdx === -1 || toIdx === -1) return;
      ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, draggedId);
      // Update numbers immediately in DOM
      const allFileCards = grid.querySelectorAll(".file-card");
      const reorderedCards = [];
      ids.forEach(id => {
        const c = Array.from(allFileCards).find(el => parseInt(el.dataset.fileId) === id);
        if (c) reorderedCards.push(c);
      });
      reorderedCards.forEach((c, i) => {
        grid.appendChild(c);
        const numEl = c.querySelector(".file-card-number");
        if (numEl) numEl.textContent = `#${i + 1}`;
      });
      // Persist new order
      try {
        await api("PUT", "/api/files/reorder", { file_ids: ids });
      } catch (err) { showToast("Reorder failed: " + err.message, true); }
    });

    card.addEventListener("click", () => navigateToFile(f.id));
    grid.appendChild(card);
  });
}

// ============================================================
// File View
// ============================================================
async function navigateToFile(fileId) {
  try {
    const file = await api("GET", `/api/files/${fileId}`);
    if (file.group_id) {
      currentSubgroups = await api("GET", `/api/groups/${file.group_id}/subgroups`);
    } else {
      currentSubgroups = [];
    }
    currentFile = file;
    currentView = 'file';
    filesDirty  = false;
    showView('view-file');
    updateTopbar();
    renderFileDetail(file);
  } catch (e) { showToast("Error opening file: " + e.message, true); }
}

function renderFileDetail(file) {
  applyFileLayoutVisibility();
  if (fileSplitLayout) {
    renderFileSplitLayout(file);
  } else {
    renderFileCenteredLayout(file);
  }
}

function applyFileLayoutVisibility() {
  const wrapper = document.getElementById("file-view-wrapper");
  const centered = document.getElementById("file-view-centered");
  if (!wrapper || !centered) return;

  if (fileSplitLayout) {
    wrapper.style.display = "flex";
    centered.style.display = "none";
  } else {
    wrapper.style.display = "none";
    centered.style.display = "block";
  }
}

function renderFileSplitLayout(file) {
  // Left panel: PDF viewer
  const pdfContainer = document.getElementById("file-detail-pdf");
  pdfContainer.innerHTML =
    `<div class="pdf-viewer-wrap">` +
      `<iframe src="/api/files/${file.id}/pdf#toolbar=1" title="${escAttr(file.original_name)}"></iframe>` +
    `</div>`;

  // Right panel: Info sidebar
  const infoContainer = document.getElementById("file-detail-info");
  const groupOptions = groups.map(g =>
    `<option value="${g.id}" ${file.group_id === g.id ? 'selected' : ''}>${escHtml(g.name)}</option>`
  ).join("");
  const subgroupOptions = file.group_id
    ? getSubgroupOptions(file.group_id, file.subgroup_id)
    : '<option value="">&#8212; No sub-group &#8212;</option>';

  infoContainer.innerHTML =
    `<div class="sidebar-header">` +
      `<input class="detail-filename-input" id="fname-${file.id}" value="${escAttr(file.original_name)}" />` +
      `<div class="sidebar-meta">` +
        `<span class="detail-meta">Uploaded ${formatDate(file.uploaded_at)}</span>` +
        `<button class="btn btn-sm btn-outline" onclick="toggleFileLayout()" title="Toggle layout">⇄</button>` +
      `</div>` +
    `</div>` +
    `<div class="sidebar-content">` +
      `<div class="info-card">` +
        `<div class="info-card-header"><span class="info-card-title">Group</span></div>` +
        `<select class="detail-group-select" id="pgroup-${file.id}" onchange="changeFileGroup(${file.id})">` +
          `<option value="">&#8212; No group &#8212;</option>` +
          groupOptions +
        `</select>` +
        `<select class="detail-group-select" id="psubgroup-${file.id}" style="margin-top:8px" onchange="changeFileSubgroup(${file.id})">` +
          subgroupOptions +
        `</select>` +
      `</div>` +
      `<div class="info-card">` +
        `<div class="info-card-header"><span class="info-card-title">Description</span></div>` +
        `<textarea id="desc-${file.id}" placeholder="Add a description&#8230;">${escHtml(file.description || "")}</textarea>` +
      `</div>` +
      `<div class="info-card">` +
        `<div class="info-card-header">` +
          `<span class="info-card-title">Summary</span>` +
          `<span class="ai-badge">&#129302; AI-ready</span>` +
        `</div>` +
        `<textarea id="summary-${file.id}" placeholder="Summary will appear here&#8230;">${escHtml(file.summary || "")}</textarea>` +
        `<div class="info-card-actions" style="margin-top:10px">` +
          `<button class="btn btn-outline btn-sm" id="btn-ai-${file.id}" onclick="runAISummary(${file.id})">` +
            `&#129302; Generate AI Summary` +
          `</button>` +
          `<button class="btn btn-success btn-sm" onclick="saveFileDetails(${file.id})">&#128190; Save</button>` +
        `</div>` +
      `</div>` +
      `<div class="info-card">` +
        `<div class="info-card-header">` +
          `<span class="info-card-title">Task Generator</span>` +
          `<span class="ai-badge task-badge">Fresh Set</span>` +
        `</div>` +
        `<p class="task-card-copy">Add a few sample tasks if you have them. The generator will keep the same level and topic, but avoid repeating the originals.</p>` +
        `<textarea id="examples-${file.id}" class="task-textarea" placeholder="Example tasks, one per line&#8230;">${escHtml(file.example_tasks || "")}</textarea>` +
        `<textarea id="tasks-${file.id}" class="task-textarea task-output" placeholder="Generated tasks will appear here&#8230;">${escHtml(file.generated_tasks || "")}</textarea>` +
        `<div class="info-card-actions" style="margin-top:10px">` +
          `<button class="btn btn-outline btn-sm" id="btn-taskgen-${file.id}" onclick="generateTasks(${file.id})">` +
            `&#9998; Generate Tasks` +
          `</button>` +
          `<button class="btn btn-success btn-sm" onclick="saveFileDetails(${file.id})">&#128190; Save</button>` +
        `</div>` +
      `</div>` +
      `<div style="margin-top:16px">` +
        `<button class="btn btn-danger" onclick="confirmDeleteFileThenBack(${file.id}, '${escAttr(file.original_name)}', event)" style="width:100%">&#128465; Delete File</button>` +
      `</div>` +
    `</div>`;

  // Event listeners
  infoContainer.querySelector(`#fname-${file.id}`).addEventListener("input", () => { filesDirty = true; });
  infoContainer.querySelector(`#desc-${file.id}`).addEventListener("input", () => { filesDirty = true; });
  infoContainer.querySelector(`#summary-${file.id}`).addEventListener("input", () => { filesDirty = true; });
  infoContainer.querySelector(`#examples-${file.id}`).addEventListener("input", () => { filesDirty = true; });
  infoContainer.querySelector(`#tasks-${file.id}`).addEventListener("input", () => { filesDirty = true; });

  // Divider resizing
  setupDividerResize();
}

function renderFileCenteredLayout(file) {
  const container = document.getElementById("file-detail");
  const groupOptions = groups.map(g =>
    `<option value="${g.id}" ${file.group_id === g.id ? 'selected' : ''}>${escHtml(g.name)}</option>`
  ).join("");
  const subgroupOptions = file.group_id
    ? getSubgroupOptions(file.group_id, file.subgroup_id)
    : '<option value="">&#8212; No sub-group &#8212;</option>';

  container.innerHTML =
    `<div class="file-detail-header">` +
      `<input class="detail-filename-input" id="fname-${file.id}" value="${escAttr(file.original_name)}" />` +
      `<div class="detail-meta-row">` +
        `<span class="detail-meta">Uploaded ${formatDate(file.uploaded_at)}</span>` +
        `<button class="btn btn-sm btn-outline" onclick="toggleFileLayout()" title="Toggle layout">⇄</button>` +
        `<select class="detail-group-select" id="pgroup-${file.id}" onchange="changeFileGroup(${file.id})">` +
          `<option value="">&#8212; No group &#8212;</option>` +
          groupOptions +
        `</select>` +
        `<select class="detail-group-select" id="psubgroup-${file.id}" onchange="changeFileSubgroup(${file.id})">` +
          subgroupOptions +
        `</select>` +
        `<button class="btn btn-danger btn-sm"` +
          ` onclick="confirmDeleteFileThenBack(${file.id}, '${escAttr(file.original_name)}', event)">&#128465; Delete</button>` +
      `</div>` +
    `</div>` +

    `<div class="pdf-viewer-wrap">` +
      `<iframe src="/api/files/${file.id}/pdf#toolbar=1" title="${escAttr(file.original_name)}"></iframe>` +
    `</div>` +

    `<div class="info-card">` +
      `<div class="info-card-header"><span class="info-card-title">Description</span></div>` +
      `<textarea id="desc-${file.id}" placeholder="Add a description&#8230;">${escHtml(file.description || "")}</textarea>` +
    `</div>` +

    `<div class="info-card">` +
      `<div class="info-card-header">` +
        `<span class="info-card-title">Summary</span>` +
        `<span class="ai-badge">&#129302; AI-ready</span>` +
      `</div>` +
      `<textarea id="summary-${file.id}" placeholder="Summary will appear here&#8230;">${escHtml(file.summary || "")}</textarea>` +
      `<div class="info-card-actions" style="margin-top:10px">` +
        `<button class="btn btn-outline btn-sm" id="btn-ai-${file.id}" onclick="runAISummary(${file.id})">` +
          `&#129302; Generate AI Summary` +
        `</button>` +
        `<button class="btn btn-success btn-sm" onclick="saveFileDetails(${file.id})">&#128190; Save</button>` +
      `</div>` +
    `</div>` +

    `<div class="info-card" style="margin-bottom:32px">` +
      `<div class="info-card-header">` +
        `<span class="info-card-title">Task Generator</span>` +
        `<span class="ai-badge task-badge">Fresh Set</span>` +
      `</div>` +
      `<p class="task-card-copy">Add a few sample tasks if you have them. The generator will keep the same level and topic, but avoid repeating the originals.</p>` +
      `<textarea id="examples-${file.id}" class="task-textarea" placeholder="Example tasks, one per line&#8230;">${escHtml(file.example_tasks || "")}</textarea>` +
      `<textarea id="tasks-${file.id}" class="task-textarea task-output" placeholder="Generated tasks will appear here&#8230;">${escHtml(file.generated_tasks || "")}</textarea>` +
      `<div class="info-card-actions" style="margin-top:10px">` +
        `<button class="btn btn-outline btn-sm" id="btn-taskgen-${file.id}" onclick="generateTasks(${file.id})">` +
          `&#9998; Generate Tasks` +
        `</button>` +
        `<button class="btn btn-success btn-sm" onclick="saveFileDetails(${file.id})">&#128190; Save</button>` +
      `</div>` +
    `</div>`;

  container.querySelector(`#fname-${file.id}`).addEventListener("input", () => { filesDirty = true; });
  container.querySelector(`#desc-${file.id}`).addEventListener("input",  () => { filesDirty = true; });
  container.querySelector(`#summary-${file.id}`).addEventListener("input", () => { filesDirty = true; });
  container.querySelector(`#examples-${file.id}`).addEventListener("input", () => { filesDirty = true; });
  container.querySelector(`#tasks-${file.id}`).addEventListener("input", () => { filesDirty = true; });
}

function toggleFileLayout() {
  fileSplitLayout = !fileSplitLayout;
  localStorage.setItem('fileSplitLayout', fileSplitLayout);
  if (currentFile) renderFileDetail(currentFile);
}

function setupDividerResize() {
  const divider = document.getElementById("file-divider");
  const wrapper = document.getElementById("file-view-wrapper");
  const leftPanel = document.getElementById("file-panel-left");

  if (!divider) return;

  let isResizing = false;

  divider.addEventListener("mousedown", () => {
    isResizing = true;
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    const rect = wrapper.getBoundingClientRect();
    const newRatio = (e.clientX - rect.left) / rect.width;
    if (newRatio > 0.3 && newRatio < 0.8) {
      fileSplitRatio = newRatio;
      leftPanel.style.flex = `0 0 ${fileSplitRatio * 100}%`;
    }
  });

  document.addEventListener("mouseup", () => {
    isResizing = false;
    document.body.style.userSelect = "auto";
  });
}

// Initialize layout preference from localStorage
if (typeof(Storage) !== "undefined" && localStorage.getItem('fileSplitLayout') === 'false') {
  fileSplitLayout = false;
}

// Navigation
// ============================================================
function showView(viewId) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(viewId).classList.add("active");
}

function updateTopbar() {
  const btnBack     = document.getElementById("btn-back");
  const btnBackLbl  = document.getElementById("btn-back-label");
  const btnNewGroup = document.getElementById("btn-new-group");
  const btnNewSubgroup = document.getElementById("btn-new-subgroup");
  const btnUpload   = document.getElementById("btn-upload");

  if (currentView === 'library') {
    btnBack.style.display     = "none";
    btnNewGroup.style.display = "inline-flex";
    btnNewSubgroup.style.display = "none";
    btnUpload.style.display   = "inline-flex";
  } else if (currentView === 'group') {
    btnBack.style.display     = "inline-flex";
    btnBackLbl.textContent    = currentSubgroup ? currentGroup.name : "Library";
    btnNewGroup.style.display = "none";
    btnNewSubgroup.style.display = (currentGroup && currentGroup.id !== 'uncategorized') ? "inline-flex" : "none";
    btnUpload.style.display   = "inline-flex";
  } else {
    btnBack.style.display     = "inline-flex";
    btnBackLbl.textContent    = currentGroup ? currentGroup.name : "Library";
    btnNewGroup.style.display = "none";
    btnNewSubgroup.style.display = "none";
    btnUpload.style.display   = "none";
  }
}

function navigateToLibrary() {
  if (filesDirty) {
    confirm_("You have unsaved changes. Go back without saving?", () => {
      filesDirty = false;
      _goLibrary();
    });
    return;
  }
  _goLibrary();
}

function _goLibrary() {
  currentGroup = null;
  currentSubgroup = null;
  currentSubgroups = [];
  currentFile  = null;
  currentView  = 'library';
  showView('view-library');
  loadLibrary();
}

function navigateBack() {
  if (currentView === 'file') {
    if (filesDirty) {
      confirm_("You have unsaved changes. Go back without saving?", () => {
        filesDirty = false;
        _returnFromFile();
      });
      return;
    }
    _returnFromFile();
  } else if (currentView === 'group') {
    if (currentSubgroup) {
      navigateToGroup(currentGroup.id, currentGroup.name);
    } else {
      _goLibrary();
    }
  }
}

async function _returnFromFile() {
  if (currentGroup) {
    await navigateToGroup(currentGroup.id, currentGroup.name, currentSubgroup?.id, currentSubgroup?.name);
  } else {
    _goLibrary();
  }
}

// ============================================================
// Group CRUD
// ============================================================
function populateGroupSelects() {
  const sel = document.getElementById("upload-group-select");
  sel.innerHTML = '<option value="">&#8212; None &#8212;</option>';
  groups.forEach(g => {
    const o = document.createElement("option");
    o.value       = g.id;
    o.textContent = g.name;
    sel.appendChild(o);
  });
  if (currentGroup && currentGroup.id !== 'uncategorized') {
    sel.value = currentGroup.id;
  }
}

function openNewGroupModal() {
  document.getElementById("modal-group-title").textContent = "New Group";
  document.getElementById("group-form-mode").value = "group";
  document.getElementById("edit-group-id").value = "";
  document.getElementById("edit-subgroup-id").value = "";
  document.getElementById("group-name-input").value = "";
  showModal("modal-group");
  document.getElementById("group-name-input").focus();
}

function openNewSubgroupModal() {
  if (!currentGroup || currentGroup.id === 'uncategorized') return;
  document.getElementById("modal-group-title").textContent = `New Under-Group in ${currentGroup.name}`;
  document.getElementById("group-form-mode").value = "subgroup";
  document.getElementById("edit-group-id").value = "";
  document.getElementById("edit-subgroup-id").value = "";
  document.getElementById("group-name-input").value = "";
  showModal("modal-group");
  document.getElementById("group-name-input").focus();
}

function openEditGroup(groupId, e) {
  e.stopPropagation();
  const g = groups.find(x => x.id === groupId);
  if (!g) return;
  document.getElementById("modal-group-title").textContent = "Rename Group";
  document.getElementById("group-form-mode").value = "group";
  document.getElementById("edit-group-id").value = g.id;
  document.getElementById("edit-subgroup-id").value = "";
  document.getElementById("group-name-input").value = g.name;
  showModal("modal-group");
  document.getElementById("group-name-input").focus();
}

function openEditSubgroup(subgroupId, e) {
  e.stopPropagation();
  const s = currentSubgroups.find(x => x.id === subgroupId);
  if (!s) return;
  document.getElementById("modal-group-title").textContent = "Rename Under-Group";
  document.getElementById("group-form-mode").value = "subgroup";
  document.getElementById("edit-group-id").value = "";
  document.getElementById("edit-subgroup-id").value = s.id;
  document.getElementById("group-name-input").value = s.name;
  showModal("modal-group");
  document.getElementById("group-name-input").focus();
}

async function saveGroup() {
  const mode = document.getElementById("group-form-mode").value;
  const id   = document.getElementById("edit-group-id").value;
  const subgroupId = document.getElementById("edit-subgroup-id").value;
  const name = document.getElementById("group-name-input").value.trim();
  if (!name) { showToast("Group name cannot be empty", true); return; }
  try {
    if (mode === "subgroup") {
      if (!currentGroup || currentGroup.id === 'uncategorized') {
        showToast("Open a group first to manage under-groups", true);
        return;
      }
      if (subgroupId) {
        await api("PUT", `/api/subgroups/${subgroupId}`, { name });
        showToast("Under-group renamed");
      } else {
        await api("POST", `/api/groups/${currentGroup.id}/subgroups`, { name });
        showToast("Under-group created");
      }
      currentSubgroups = await api("GET", `/api/groups/${currentGroup.id}/subgroups`);
      await navigateToGroup(currentGroup.id, currentGroup.name, currentSubgroup?.id, currentSubgroup?.name);
    } else {
      if (id) {
        await api("PUT", `/api/groups/${id}`, { name });
        showToast("Group renamed");
      } else {
        await api("POST", "/api/groups", { name });
        showToast("Group created");
      }
      await loadLibrary();
    }
    hideModal("modal-group");
  } catch (e) { showToast(e.message, true); }
}

function confirmDeleteSubgroup(subgroupId, name, e) {
  e.stopPropagation();
  confirm_(`Delete under-group "${name}"? Files inside it will stay in the parent group.`, async () => {
    try {
      await api("DELETE", `/api/subgroups/${subgroupId}`);
      if (currentSubgroup && currentSubgroup.id === subgroupId) {
        currentSubgroup = null;
      }
      await navigateToGroup(currentGroup.id, currentGroup.name);
      await loadLibrary();
      showToast("Under-group deleted");
    } catch (e) { showToast(e.message, true); }
  });
}

function confirmDeleteGroup(groupId, name, e) {
  e.stopPropagation();
  confirm_(`Delete group "${name}"? Files will be unassigned but not deleted.`, async () => {
    try {
      await api("DELETE", `/api/groups/${groupId}`);
      await loadLibrary();
      showToast("Group deleted");
    } catch (e) { showToast(e.message, true); }
  });
}

// ============================================================
// File CRUD
// ============================================================
function confirmDeleteFileThenRefresh(fileId, name, e) {
  e.stopPropagation();
  confirm_(`Permanently delete "${name}"?`, async () => {
    try {
      await api("DELETE", `/api/files/${fileId}`);
      await loadLibrary();
      await navigateToGroup(currentGroup.id, currentGroup.name, currentSubgroup?.id, currentSubgroup?.name);
      showToast("File deleted");
    } catch (e) { showToast(e.message, true); }
  });
}

function confirmDeleteFileThenBack(fileId, name, e) {
  e.stopPropagation();
  confirm_(`Permanently delete "${name}"?`, async () => {
    try {
      await api("DELETE", `/api/files/${fileId}`);
      filesDirty = false;
      await loadLibrary();
      await _returnFromFile();
      showToast("File deleted");
    } catch (e) { showToast(e.message, true); }
  });
}

async function saveFileDetails(fileId) {
  const fname   = document.getElementById(`fname-${fileId}`).value.trim();
  const desc    = document.getElementById(`desc-${fileId}`).value;
  const summary = document.getElementById(`summary-${fileId}`).value;
  const exampleTasks = document.getElementById(`examples-${fileId}`).value;
  const generatedTasks = document.getElementById(`tasks-${fileId}`).value;
  try {
    const updated = await api("PUT", `/api/files/${fileId}`, {
      original_name: fname, description: desc, summary,
      example_tasks: exampleTasks, generated_tasks: generatedTasks,
    });
    currentFile = updated;
    filesDirty  = false;
    showToast("Saved");
  } catch (e) { showToast("Save failed: " + e.message, true); }
}

function getSubgroupOptions(groupId, selectedSubgroupId = null) {
  const matching = currentSubgroups.filter(s => s.group_id === groupId);
  return `<option value="">&#8212; No sub-group &#8212;</option>` +
    matching.map(s =>
      `<option value="${s.id}" ${selectedSubgroupId === s.id ? 'selected' : ''}>${escHtml(s.name)}</option>`
    ).join("");
}

async function changeFileGroup(fileId) {
  const sel     = document.getElementById(`pgroup-${fileId}`);
  const groupId = sel.value ? parseInt(sel.value) : null;
  try {
    const updated = await api("PUT", `/api/files/${fileId}`, { group_id: groupId, subgroup_id: null });
    currentFile = updated;
    if (groupId) {
      currentSubgroups = await api("GET", `/api/groups/${groupId}/subgroups`);
    }
    await loadLibrary();
    renderFileDetail(currentFile);
    showToast("Group updated");
  } catch (e) { showToast("Error: " + e.message, true); }
}

async function changeFileSubgroup(fileId) {
  const sel = document.getElementById(`psubgroup-${fileId}`);
  const subgroupId = sel && sel.value ? parseInt(sel.value) : null;
  try {
    const updated = await api("PUT", `/api/files/${fileId}`, { subgroup_id: subgroupId });
    currentFile = updated;
    await loadLibrary();
    showToast("Under-group updated");
  } catch (e) { showToast("Error: " + e.message, true); }
}

function openAssignFileModal(fileId, fileName, e) {
  e.stopPropagation();
  document.getElementById("assign-file-id").value = fileId;
  document.getElementById("assign-file-name").textContent = escHtml(fileName);
  const groupSelect = document.getElementById("assign-group-select");
  groupSelect.innerHTML = 
    `<option value="">Uncategorized</option>` +
    groups.map(g => `<option value="${g.id}">${escHtml(g.name)}</option>`).join("");

  const file = allFiles.find(f => f.id === fileId);
  if (file && file.group_id) {
    groupSelect.value = String(file.group_id);
  }

  renderAssignSubgroupOptions(file ? file.group_id : null, file ? file.subgroup_id : null);
  showModal("modal-assign");
}

async function renderAssignSubgroupOptions(groupId, selectedSubgroupId = null) {
  const subgroupSelect = document.getElementById("assign-subgroup-select");
  if (!groupId) {
    subgroupSelect.style.display = "none";
    subgroupSelect.innerHTML = "";
    return;
  }
  const subgroups = await api("GET", `/api/groups/${groupId}/subgroups`);
  subgroupSelect.style.display = "block";
  subgroupSelect.innerHTML =
    `<option value="">No under-group</option>` +
    subgroups.map(s => `<option value="${s.id}" ${selectedSubgroupId === s.id ? 'selected' : ''}>${escHtml(s.name)}</option>`).join("");
}

async function assignFileToGroup() {
  const fileId  = parseInt(document.getElementById("assign-file-id").value);
  const groupId = document.getElementById("assign-group-select").value ? parseInt(document.getElementById("assign-group-select").value) : null;
  const subgroupSel = document.getElementById("assign-subgroup-select");
  const subgroupId = (subgroupSel.style.display !== "none" && subgroupSel.value)
    ? parseInt(subgroupSel.value)
    : null;
  try {
    const targetName = groupId
      ? (groups.find(g => g.id === groupId)?.name || "group")
      : "Uncategorized";
    hideModal("modal-assign");
    await moveFileWithUndo(fileId, groupId, subgroupId, `Moved to ${targetName}`);
  } catch (e) { showToast("Error: " + e.message, true); }
}

async function runAISummary(fileId) {
  const btn = document.getElementById(`btn-ai-${fileId}`);
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generating&#8230;';
  try {
    const result = await api("POST", `/api/files/${fileId}/summarize`);
    document.getElementById(`summary-${fileId}`).value = result.summary;
    filesDirty = true;
    showToast("AI summary generated");
  } catch (e) {
    showToast("AI summary failed: " + e.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '&#129302; Generate AI Summary';
  }
}

async function generateTasks(fileId) {
  const btn = document.getElementById(`btn-taskgen-${fileId}`);
  const payload = {
    original_name: document.getElementById(`fname-${fileId}`).value.trim(),
    description: document.getElementById(`desc-${fileId}`).value,
    summary: document.getElementById(`summary-${fileId}`).value,
    example_tasks: document.getElementById(`examples-${fileId}`).value,
  };
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Building tasks&#8230;';
  try {
    const result = await api("POST", `/api/files/${fileId}/generate-tasks`, payload);
    document.getElementById(`tasks-${fileId}`).value = result.tasks;
    currentFile = result.file;
    filesDirty = false;
    showToast("Tasks generated");
  } catch (e) {
    showToast("Task generation failed: " + e.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '&#9998; Generate Tasks';
  }
}

// ============================================================
// Upload
// ============================================================
function openUploadModal() {
  document.getElementById("upload-status").innerHTML = "";
  populateGroupSelects();
  showModal("modal-upload");
}

async function uploadFiles(fileList) {
  const statusDiv = document.getElementById("upload-status");
  const groupId   = document.getElementById("upload-group-select").value;
  let uploaded = 0;

  for (const file of fileList) {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      statusDiv.innerHTML += `<p style="color:#ff3b30">&#9888; "${escHtml(file.name)}" is not a PDF &#8211; skipped.</p>`;
      continue;
    }
    const fd = new FormData();
    fd.append("file", file);
    if (groupId) fd.append("group_id", groupId);
    try {
      statusDiv.innerHTML += `<p>&#11014; Uploading "${escHtml(file.name)}"&#8230;</p>`;
      await api("POST", "/api/files/upload", fd);
      statusDiv.innerHTML += `<p style="color:#34c759">&#10003; "${escHtml(file.name)}" uploaded.</p>`;
      uploaded++;
    } catch (err) {
      statusDiv.innerHTML += `<p style="color:#ff3b30">&#10007; "${escHtml(file.name)}": ${escHtml(err.message)}</p>`;
    }
  }

  if (uploaded > 0) {
    await loadLibrary();
    if (currentView === 'group' && currentGroup) {
      navigateToGroup(currentGroup.id, currentGroup.name, currentSubgroup?.id, currentSubgroup?.name);
    }
    showToast(uploaded + " file(s) uploaded");
  }
}

// ============================================================
// UI bindings
// ============================================================
function bindUI() {
  document.getElementById("btn-upload").addEventListener("click", openUploadModal);
  document.getElementById("btn-new-group").addEventListener("click", openNewGroupModal);
  document.getElementById("btn-new-subgroup").addEventListener("click", openNewSubgroupModal);
  document.getElementById("btn-back").addEventListener("click", navigateBack);
  document.getElementById("topbar-brand").addEventListener("click", navigateToLibrary);
  document.getElementById("btn-save-group").addEventListener("click", saveGroup);
  document.getElementById("btn-add-unassigned").addEventListener("click", openUnassignedPickerModal);
  document.getElementById("btn-share-group").addEventListener("click", openShareGroupModal);
  document.getElementById("btn-copy-share").addEventListener("click", copyShareLink);
  document.getElementById("btn-revoke-share").addEventListener("click", revokeShareLink);
  document.getElementById("btn-assign-unassigned").addEventListener("click", assignSelectedUnassignedFiles);
  document.getElementById("unassigned-select-all").addEventListener("change", (e) => {
    document.querySelectorAll(".unassigned-checkbox").forEach(cb => {
      cb.checked = e.target.checked;
    });
  });
  document.getElementById("group-name-input").addEventListener("keydown", e => {
    if (e.key === "Enter") saveGroup();
  });
  document.getElementById("btn-assign-file").addEventListener("click", assignFileToGroup);
  document.getElementById("assign-group-select").addEventListener("change", async e => {
    const groupId = e.target.value ? parseInt(e.target.value) : null;
    await renderAssignSubgroupOptions(groupId, null);
  });
  document.getElementById("assign-group-select").addEventListener("keydown", e => {
    if (e.key === "Enter") assignFileToGroup();
  });

  document.querySelectorAll(".modal-close").forEach(btn => {
    btn.addEventListener("click", () => hideModal(btn.dataset.modal));
  });
  document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", e => {
      if (e.target === overlay) hideModal(overlay.id);
    });
  });

  const fileInput = document.getElementById("file-input");
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) uploadFiles(Array.from(fileInput.files));
  });

  const dropZone = document.getElementById("drop-zone");
  dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("drag-over"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
  dropZone.addEventListener("drop", e => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    if (e.dataTransfer.files.length) uploadFiles(Array.from(e.dataTransfer.files));
  });

  document.getElementById("btn-confirm-no").addEventListener("click", () => hideModal("modal-confirm"));
  document.getElementById("btn-confirm-yes").addEventListener("click", () => {
    hideModal("modal-confirm");
    if (_confirmCallback) { _confirmCallback(); _confirmCallback = null; }
  });
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

// ============================================================
// Modal helpers
// ============================================================
function showModal(id) { document.getElementById(id).style.display = "flex"; }
function hideModal(id) { document.getElementById(id).style.display = "none"; }

// ============================================================
// Toast
// ============================================================
let _toastTimer = null;
function showToast(msg, isError = false, actionLabel = null, actionCallback = null) {
  let toast = document.getElementById("__toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "__toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }

  toast.innerHTML = "";
  const content = document.createElement("div");
  content.className = "toast-content";
  const message = document.createElement("span");
  message.className = "toast-message";
  message.textContent = msg;
  content.appendChild(message);

  if (actionLabel && typeof actionCallback === "function") {
    const actionBtn = document.createElement("button");
    actionBtn.className = "toast-action";
    actionBtn.type = "button";
    actionBtn.textContent = actionLabel;
    actionBtn.addEventListener("click", async () => {
      try {
        await actionCallback();
      } finally {
        toast.classList.remove("show");
      }
    });
    content.appendChild(actionBtn);
  }

  toast.appendChild(content);
  toast.style.background = isError ? "#ff3b30" : "#1c1c1e";
  toast.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove("show"), actionLabel ? 6000 : 3000);
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
  return escHtml(name.substring(0, max - 1)) + "&#8230;";
}
function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" });
}

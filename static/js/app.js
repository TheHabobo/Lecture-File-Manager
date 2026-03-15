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
let currentShareTarget = null;
let filesDirty   = false;
let topicsSortMode = localStorage.getItem('topics-sort-mode') || 'hierarchy';
let topicsInterfaceMode = localStorage.getItem('topics-interface-mode') || 'topics';
let libraryMode = localStorage.getItem('library-mode') || 'groups';
let timelineTasks = [];
let timelineTodoCandidates = [];
let currentTimelineMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let topicsDraftSections = [];
let todosDraftSections = [];
let sectionDragFrom = null;
let topicDragFrom = null;
let checklistDragFrom = null;
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
    [groups, allFiles, timelineTasks] = await Promise.all([
      api("GET", "/api/groups"),
      api("GET", "/api/files"),
      api("GET", "/api/timeline-tasks"),
    ]);
    renderLibrary();
    populateGroupSelects();
    updateTopbar();
  } catch (e) { showToast("Error loading library: " + e.message, true); }
}

function setLibraryMode(mode) {
  libraryMode = mode;
  localStorage.setItem('library-mode', mode);
  renderLibrary();
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
  const boardRoot = document.getElementById("library-board-root");
  const timelineRoot = document.getElementById("library-timeline-root");
  const btnGroups = document.getElementById("btn-library-groups");
  const btnBoard = document.getElementById("btn-library-board");
  const btnTimeline = document.getElementById("btn-library-timeline");
  grid.innerHTML = "";

  if (btnGroups && btnBoard && btnTimeline) {
    btnGroups.classList.toggle('active', libraryMode === 'groups');
    btnBoard.classList.toggle('active', libraryMode === 'board');
    btnTimeline.classList.toggle('active', libraryMode === 'timeline');
  }

  if (libraryMode === 'board') {
    grid.style.display = 'none';
    if (boardRoot) {
      boardRoot.style.display = 'block';
      renderLibraryBoard(boardRoot);
    }
    if (timelineRoot) {
      timelineRoot.style.display = 'none';
      timelineRoot.innerHTML = '';
    }
    return;
  }

  if (libraryMode === 'timeline') {
    grid.style.display = 'none';
    if (boardRoot) {
      boardRoot.style.display = 'none';
      boardRoot.innerHTML = '';
    }
    if (timelineRoot) {
      timelineRoot.style.display = 'block';
      renderLibraryTimeline(timelineRoot);
    }
    return;
  }

  grid.style.display = 'grid';
  if (boardRoot) {
    boardRoot.style.display = 'none';
    boardRoot.innerHTML = '';
  }
  if (timelineRoot) {
    timelineRoot.style.display = 'none';
    timelineRoot.innerHTML = '';
  }

  groups.forEach((g, idx) => {
    const color = GROUP_COLORS[idx % GROUP_COLORS.length];
    const card = document.createElement("div");
    card.className = "group-card";
    card.draggable = true;
    card.dataset.groupId = g.id;

    const topicCount = (g.topics_checklist || "").split("\n").filter(l => l.trim().startsWith("- [")).length;
    const topicsBadge = topicCount > 0 ? `<span class="group-card-topics-badge">${topicCount}</span>` : "";

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
        `<button class="group-card-topics-btn" title="View topics checklist"` +
          ` onclick="navigateToTopics(${g.id}, '${escAttr(g.name)}', event)">🧩 Topics${topicsBadge}</button>` +
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

function renderLibraryBoard(container) {
  const aggregate = groups.map(group => {
    const topicChecks = JSON.parse(localStorage.getItem(`group-topics-checked-${group.id}`) || '{}');
    const todoChecks = JSON.parse(localStorage.getItem(`group-todos-checked-${group.id}`) || '{}');
    const topicSections = parseTopicsChecklist(group.topics_checklist || '');
    const todoSections = parseTopicsChecklist(group.todos_checklist || '');
    const uncheckedTopics = topicSections.flatMap(section =>
      (section.items || [])
        .filter(item => topicChecks[item] !== true)
        .map(item => ({ header: section.header || 'General', item }))
    );
    const uncheckedTodos = todoSections.flatMap(section =>
      (section.items || [])
        .filter(item => todoChecks[item] !== true)
        .map(item => ({ header: section.header || 'General', item }))
    );
    return {
      id: group.id,
      name: group.name,
      uncheckedTopics,
      uncheckedTodos,
    };
  }).filter(group => group.uncheckedTopics.length || group.uncheckedTodos.length);

  const topicsColumn = aggregate.length
    ? aggregate.map(group => {
        const items = group.uncheckedTopics.length
          ? group.uncheckedTopics.map(entry =>
              `<div class="topics-board-check-item">` +
                `<input type="checkbox" class="topics-checkbox" data-group="${group.id}" data-topic="${escAttr(entry.item)}" onchange="onTopicCheck(this); renderLibraryBoard(document.getElementById('library-board-root'));">` +
                `<button type="button" class="topics-board-link" onclick="navigateToTopics(${group.id}, '${escAttr(group.name)}')">` +
                  `<span><strong>${escHtml(group.name)}</strong> · ${escHtml(entry.header)}</span>` +
                  `<span class="topics-board-check-text">${escHtml(entry.item)}</span>` +
                `</button>` +
              `</div>`
            ).join('')
          : `<div class="topics-board-empty-line">No open topics</div>`;
        return `<div class="topics-board-group">` +
          `<div class="topics-board-group-title">${escHtml(group.name)}</div>` +
          items +
        `</div>`;
      }).join('')
    : `<div class="topics-empty-state topics-empty-state--compact"><div class="topics-empty-title">No unchecked topics</div></div>`;

  const todosColumn = aggregate.length
    ? aggregate.map(group => {
        const items = group.uncheckedTodos.length
          ? group.uncheckedTodos.map(entry =>
              `<div class="topics-board-check-item">` +
                `<input type="checkbox" class="topics-checkbox" data-group="${group.id}" data-topic="${escAttr(entry.item)}" onchange="onTodoCheck(this); renderLibraryBoard(document.getElementById('library-board-root'));">` +
                `<button type="button" class="topics-board-link" onclick="navigateToTopics(${group.id}, '${escAttr(group.name)}')">` +
                  `<span><strong>${escHtml(group.name)}</strong> · ${escHtml(entry.header)}</span>` +
                  `<span class="topics-board-check-text">${escHtml(entry.item)}</span>` +
                `</button>` +
              `</div>`
            ).join('')
          : `<div class="topics-board-empty-line">No open to-dos</div>`;
        return `<div class="topics-board-group">` +
          `<div class="topics-board-group-title">${escHtml(group.name)}</div>` +
          items +
        `</div>`;
      }).join('')
    : `<div class="topics-empty-state topics-empty-state--compact"><div class="topics-empty-title">No unchecked to-dos</div></div>`;

  container.innerHTML =
    `<div class="topics-board-grid topics-board-grid--library">` +
      `<section class="topics-board-column">` +
        `<div class="topics-board-column-header">Unchecked Topics Across All Groups</div>` +
        `${topicsColumn}` +
      `</section>` +
      `<section class="topics-board-column">` +
        `<div class="topics-board-column-header">Unchecked To-Dos Across All Groups</div>` +
        `${todosColumn}` +
      `</section>` +
    `</div>`;
}

function formatYmdLocal(dateValue) {
  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, '0');
  const day = String(dateValue.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function timelineDate(dateText) {
  return new Date(`${dateText}T00:00:00`);
}

function collectTodoCandidates() {
  const candidates = [];
  groups.forEach(group => {
    const sections = parseTopicsChecklist(group.todos_checklist || '');
    const checks = JSON.parse(localStorage.getItem(`group-todos-checked-${group.id}`) || '{}');
    sections.forEach(section => {
      (section.items || []).forEach(item => {
        candidates.push({
          groupId: group.id,
          groupName: group.name,
          sectionName: section.header || 'General',
          item,
          done: checks[item] === true,
        });
      });
    });
  });
  return candidates;
}

function changeTimelineMonth(offset) {
  currentTimelineMonth = new Date(
    currentTimelineMonth.getFullYear(),
    currentTimelineMonth.getMonth() + offset,
    1,
  );
  if (libraryMode === 'timeline') {
    renderLibrary();
  }
}

function prefillTimelineFromTodo() {
  const select = document.getElementById('timeline-todo-select');
  if (!select || !select.value) return;
  const idx = parseInt(select.value, 10);
  const candidate = timelineTodoCandidates[idx];
  if (!candidate) return;
  const titleInput = document.getElementById('timeline-title-input');
  const groupSelect = document.getElementById('timeline-group-select');
  if (titleInput) titleInput.value = candidate.item;
  if (groupSelect) groupSelect.value = String(candidate.groupId);
}

async function createTimelineTask() {
  const titleInput = document.getElementById('timeline-title-input');
  const startInput = document.getElementById('timeline-start-input');
  const endInput = document.getElementById('timeline-end-input');
  const groupSelect = document.getElementById('timeline-group-select');

  const title = (titleInput?.value || '').trim();
  const startDate = startInput?.value;
  const endDate = endInput?.value;
  const groupId = groupSelect?.value ? parseInt(groupSelect.value, 10) : null;

  if (!title || !startDate || !endDate) {
    showToast('Title, start date, and end date are required', true);
    return;
  }

  try {
    await api('POST', '/api/timeline-tasks', {
      title,
      start_date: startDate,
      end_date: endDate,
      group_id: groupId,
    });
    timelineTasks = await api('GET', '/api/timeline-tasks');
    if (titleInput) titleInput.value = '';
    showToast('Task added to timeline');
    renderLibrary();
  } catch (err) {
    showToast('Could not add timeline task: ' + err.message, true);
  }
}

async function editTimelineTask(taskId) {
  const task = timelineTasks.find(t => t.id === taskId);
  if (!task) return;

  const nextTitle = prompt('Edit task title', task.title);
  if (nextTitle == null) return;
  const cleanedTitle = nextTitle.trim();
  if (!cleanedTitle) {
    showToast('Task title cannot be empty', true);
    return;
  }

  const nextStart = prompt('Start date (YYYY-MM-DD)', task.start_date);
  if (nextStart == null) return;
  const nextEnd = prompt('End date (YYYY-MM-DD)', task.end_date);
  if (nextEnd == null) return;

  try {
    await api('PUT', `/api/timeline-tasks/${taskId}`, {
      title: cleanedTitle,
      start_date: nextStart,
      end_date: nextEnd,
    });
    timelineTasks = await api('GET', '/api/timeline-tasks');
    showToast('Timeline task updated');
    renderLibrary();
  } catch (err) {
    showToast('Could not update timeline task: ' + err.message, true);
  }
}

function deleteTimelineTask(taskId, e) {
  if (e) e.stopPropagation();
  confirm_('Delete this timeline task?', async () => {
    try {
      await api('DELETE', `/api/timeline-tasks/${taskId}`);
      timelineTasks = await api('GET', '/api/timeline-tasks');
      showToast('Timeline task deleted');
      renderLibrary();
    } catch (err) {
      showToast('Could not delete timeline task: ' + err.message, true);
    }
  });
}

function renderLibraryTimeline(container) {
  const monthStart = new Date(currentTimelineMonth.getFullYear(), currentTimelineMonth.getMonth(), 1);
  const monthEnd = new Date(currentTimelineMonth.getFullYear(), currentTimelineMonth.getMonth() + 1, 0);
  const gridStart = new Date(monthStart);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());

  timelineTodoCandidates = collectTodoCandidates();
  const defaultStart = formatYmdLocal(new Date());
  const defaultEndDate = new Date();
  defaultEndDate.setDate(defaultEndDate.getDate() + 1);
  const defaultEnd = formatYmdLocal(defaultEndDate);

  const groupOptions = groups.map(group =>
    `<option value="${group.id}">${escHtml(group.name)}</option>`
  ).join('');
  const todoOptions = timelineTodoCandidates.map((todo, idx) =>
    `<option value="${idx}">${escHtml(todo.groupName)} · ${escHtml(todo.sectionName)} · ${escHtml(todo.item)}${todo.done ? ' (done)' : ''}</option>`
  ).join('');

  const weekdayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    .map(day => `<div class="timeline-weekday">${day}</div>`)
    .join('');

  const dayCells = [];
  for (let i = 0; i < 42; i += 1) {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + i);
    const dayYmd = formatYmdLocal(day);
    const inMonth = day.getMonth() === monthStart.getMonth();
    const tasksForDay = timelineTasks.filter(task => {
      const start = timelineDate(task.start_date);
      const end = timelineDate(task.end_date);
      return day >= start && day <= end;
    });

    const chips = tasksForDay.slice(0, 3).map(task => {
      const groupIdx = groups.findIndex(g => g.id === task.group_id);
      const color = task.group_id && groupIdx >= 0
        ? GROUP_COLORS[groupIdx % GROUP_COLORS.length]
        : '#6b7280';
      return `<button class="timeline-chip" style="--timeline-chip:${color}" onclick="editTimelineTask(${task.id})" title="${escAttr(task.title)} (${task.start_date} - ${task.end_date})">${escHtml(task.title)}</button>`;
    }).join('');

    const overflow = tasksForDay.length > 3
      ? `<div class="timeline-more">+${tasksForDay.length - 3} more</div>`
      : '';

    dayCells.push(
      `<div class="timeline-day${inMonth ? '' : ' timeline-day--muted'}">` +
        `<div class="timeline-day-num">${day.getDate()}</div>` +
        `<div class="timeline-day-chips">${chips}${overflow}</div>` +
      `</div>`
    );
  }

  const visibleTasks = timelineTasks
    .filter(task => {
      const start = timelineDate(task.start_date);
      const end = timelineDate(task.end_date);
      return end >= monthStart && start <= monthEnd;
    })
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  const taskList = visibleTasks.length
    ? visibleTasks.map(task =>
        `<div class="timeline-task-row">` +
          `<div class="timeline-task-main">` +
            `<div class="timeline-task-title">${escHtml(task.title)}</div>` +
            `<div class="timeline-task-meta">${escHtml(task.group_name || 'No group')} · ${task.start_date} → ${task.end_date}</div>` +
          `</div>` +
          `<div class="timeline-task-actions">` +
            `<button class="btn btn-secondary btn-sm" onclick="editTimelineTask(${task.id})">Edit</button>` +
            `<button class="btn btn-danger btn-sm" onclick="deleteTimelineTask(${task.id}, event)">Delete</button>` +
          `</div>` +
        `</div>`
      ).join('')
    : `<div class="topics-empty-state topics-empty-state--compact"><div class="topics-empty-title">No tasks in this month</div></div>`;

  container.innerHTML =
    `<section class="timeline-shell">` +
      `<div class="timeline-controls">` +
        `<div class="timeline-month-nav">` +
          `<button class="btn btn-secondary btn-sm" onclick="changeTimelineMonth(-1)">← Prev</button>` +
          `<h3>${monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3>` +
          `<button class="btn btn-secondary btn-sm" onclick="changeTimelineMonth(1)">Next →</button>` +
        `</div>` +
        `<div class="timeline-form">` +
          `<input class="form-control" id="timeline-title-input" placeholder="Task title" />` +
          `<select class="form-control" id="timeline-group-select">` +
            `<option value="">No group</option>${groupOptions}` +
          `</select>` +
          `<input class="form-control" id="timeline-start-input" type="date" value="${defaultStart}" />` +
          `<input class="form-control" id="timeline-end-input" type="date" value="${defaultEnd}" />` +
          `<select class="form-control" id="timeline-todo-select" onchange="prefillTimelineFromTodo()">` +
            `<option value="">Use existing to-do (optional)</option>${todoOptions}` +
          `</select>` +
          `<button class="btn btn-primary" onclick="createTimelineTask()">Add to Timeline</button>` +
        `</div>` +
      `</div>` +
      `<div class="timeline-calendar">` +
        `<div class="timeline-weekdays">${weekdayHeaders}</div>` +
        `<div class="timeline-grid">${dayCells.join('')}</div>` +
      `</div>` +
      `<div class="timeline-task-list">${taskList}</div>` +
    `</section>`;
}

// ============================================================
// Group Topics Page
// ============================================================
function navigateToTopics(groupId, groupName, e) {
  if (e) e.stopPropagation();
  const g = groups.find(x => x.id === groupId);
  if (!g) return;
  currentGroup = { id: groupId, name: groupName };
  currentView = 'topics';
  showView('view-topics');
  updateTopbar();
  topicsDraftSections = parseTopicsChecklist(g.topics_checklist);
  todosDraftSections = parseTopicsChecklist(g.todos_checklist || '');
  renderTopicsView(g);
}

function parseTopicsChecklist(text) {
  const sections = [];
  let currentSection = null;
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('# ')) {
      currentSection = { header: line.slice(2).trim(), items: [] };
      sections.push(currentSection);
    } else if (line.startsWith('- [')) {
      const topic = line.replace(/^- \[[ x]\] /, '').trim();
      if (!currentSection) {
        currentSection = { header: '', items: [] };
        sections.push(currentSection);
      }
      currentSection.items.push(topic);
    }
  }
  return sections.map(section => ({
    header: section.header || 'General',
    items: section.items || [],
  }));
}

function serializeTopicsChecklist(sections) {
  const lines = [];
  sections.forEach(section => {
    const header = (section.header || 'General').trim() || 'General';
    const items = (section.items || []).map(x => (x || '').trim()).filter(Boolean);
    if (!header && items.length === 0) return;
    lines.push(`# ${header}`);
    items.forEach(item => lines.push(`- [ ] ${item}`));
  });
  return lines.join('\n');
}

function dedupeTopicsInSections(sections) {
  const seen = new Set();
  return sections.map(section => {
    const kept = [];
    for (const item of section.items || []) {
      const key = item.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      kept.push(item.trim());
    }
    return {
      header: (section.header || 'General').trim() || 'General',
      items: kept,
    };
  }).filter(section => section.header || section.items.length > 0);
}

async function saveTopicsDraft(quiet = true) {
  if (!currentGroup || currentGroup.id === 'uncategorized') return;
  const cleaned = dedupeTopicsInSections(topicsDraftSections);
  const payload = { topics_checklist: serializeTopicsChecklist(cleaned) };
  try {
    const updated = await api('PUT', `/api/groups/${currentGroup.id}`, payload);
    const idx = groups.findIndex(g => g.id === currentGroup.id);
    if (idx >= 0) groups[idx] = updated;
    topicsDraftSections = parseTopicsChecklist(updated.topics_checklist || '');
    if (!quiet) showToast('Topics saved');
  } catch (err) {
    showToast('Could not save topics: ' + err.message, true);
  }
}

async function saveTodosDraft(quiet = true) {
  if (!currentGroup || currentGroup.id === 'uncategorized') return;
  const cleaned = dedupeTopicsInSections(todosDraftSections);
  const payload = { todos_checklist: serializeTopicsChecklist(cleaned) };
  try {
    const updated = await api('PUT', `/api/groups/${currentGroup.id}`, payload);
    const idx = groups.findIndex(g => g.id === currentGroup.id);
    if (idx >= 0) groups[idx] = { ...groups[idx], ...updated };
    todosDraftSections = parseTopicsChecklist(updated.todos_checklist || '');
    if (!quiet) showToast('To-dos saved');
  } catch (err) {
    showToast('Could not save to-dos: ' + err.message, true);
  }
}

function setTopicsSortMode(mode) {
  topicsSortMode = mode;
  localStorage.setItem('topics-sort-mode', mode);
  const g = groups.find(x => x.id === currentGroup?.id);
  if (g) renderTopicsView(g);
}

function setTopicsInterfaceMode(mode) {
  topicsInterfaceMode = mode;
  localStorage.setItem('topics-interface-mode', mode);
  const g = groups.find(x => x.id === currentGroup?.id);
  if (g) renderTopicsView(g);
}

function renderChecklistEditor(listType, sections, groupId, savedChecks) {
  const isTopicList = listType === 'topics';
  const dragPrefix = isTopicList ? 'topic' : 'todo';
  const renameFn = isTopicList ? 'renameUnderTopicByText' : 'renameTodoByText';
  const deleteFn = isTopicList ? 'deleteUnderTopicByText' : 'deleteTodoByText';
  const renameSectionFn = isTopicList ? 'renameOverTopic' : 'renameTodoSection';
  const addSectionItemFn = isTopicList ? 'addUnderTopic' : 'addTodoItem';
  const deleteSectionFn = isTopicList ? 'deleteOverTopic' : 'deleteTodoSection';
  const dropBeforeFn = isTopicList ? 'dropTopicBefore' : 'dropChecklistItemBefore';
  const dropEndFn = isTopicList ? 'dropTopicToSectionEnd' : 'dropChecklistItemToSectionEnd';
  const startDragFn = isTopicList ? 'startTopicDrag' : 'startChecklistItemDrag';
  const endDragFn = isTopicList ? 'endTopicDrag' : 'endChecklistItemDrag';
  const addSectionFn = isTopicList ? 'addOverTopic' : 'addTodoSection';
  const checkChange = isTopicList ? 'onTopicCheck(this)' : 'onTodoCheck(this)';

  const mkItem = (topic, checked) =>
    `<label class="topics-item${checked ? ' topics-item--done' : ''}">` +
      `<span class="topic-drag-box" title="Drag to reorder">` +
        `<span class="topic-drag-handle">⋮⋮</span>` +
      `</span>` +
      `<input type="checkbox" class="topics-checkbox" ${checked ? 'checked' : ''}` +
        ` data-group="${groupId}" data-topic="${escAttr(topic)}" onchange="${checkChange}">` +
      `<span class="topics-item-text">${escHtml(topic)}</span>` +
      `<div class="topics-item-actions">` +
        `<button class="topic-mini-btn" type="button" title="Rename" onclick="${renameFn}('${escAttr(topic)}', event)">✏️</button>` +
        `<button class="topic-mini-btn danger" type="button" title="Delete" onclick="${deleteFn}('${escAttr(topic)}', event)">🗑</button>` +
      `</div>` +
    `</label>`;

  let html = `<div class="topics-list">`;
  sections.forEach((section, sIdx) => {
    if (section.header) {
      html +=
        `<div class="topics-section-header" draggable="true" ondragstart="startSectionDrag(${sIdx}, event, '${dragPrefix}')" ondragend="endSectionDrag(event)" ondragover="allowSectionDrop(event)" ondragenter="markSectionDropTarget(event)" ondragleave="unmarkSectionDropTarget(event)" ondrop="dropSection(${sIdx}, event, '${dragPrefix}')">` +
          `<span class="topics-section-icon">${isTopicList ? '📚' : '✅'}</span>` +
          `<span class="topics-section-title">${escHtml(section.header)}</span>` +
          `<div class="topics-section-actions">` +
            `<button class="topic-mini-btn" type="button" title="Rename section" onclick="${renameSectionFn}(${sIdx}, event)">✏️</button>` +
            `<button class="topic-mini-btn" type="button" title="Add item" onclick="${addSectionItemFn}(${sIdx}, event)">＋</button>` +
            `<button class="topic-mini-btn danger" type="button" title="Delete section" onclick="${deleteSectionFn}(${sIdx}, event)">🗑</button>` +
            `<span class="topic-drag-handle section-drag-handle" title="Drag to reorder">↕</span>` +
          `</div>` +
        `</div>`;
    }
    section.items.forEach((topic, tIdx) => {
      html +=
        `<div class="topics-item-under" draggable="true" ondragstart="${startDragFn}(${sIdx}, ${tIdx}, event)" ondragend="${endDragFn}(event)" ondragover="allowTopicDrop(event)" ondragenter="markTopicDropTarget(event)" ondragleave="unmarkTopicDropTarget(event)" ondrop="${dropBeforeFn}(${sIdx}, ${tIdx}, event)">` +
          mkItem(topic, savedChecks[topic] === true) +
        `</div>`;
    });
    html += `<div class="topics-drop-zone" ondragover="allowTopicDrop(event)" ondragenter="markTopicDropTarget(event)" ondragleave="unmarkTopicDropTarget(event)" ondrop="${dropEndFn}(${sIdx}, event)"></div>`;
  });
  html += `<div class="topics-editor-actions"><button class="btn btn-secondary btn-sm" type="button" onclick="${addSectionFn}()">＋ New ${isTopicList ? 'Over Topic' : 'To-Do Section'}</button></div>`;
  html += `</div>`;
  return html;
}

function renderTopicsView(g) {
  document.getElementById('topics-view-title').textContent = g.name;
  const container = document.getElementById('topics-checklist-body');
  const sections = topicsDraftSections.length ? topicsDraftSections : parseTopicsChecklist(g.topics_checklist);
  if (!topicsDraftSections.length) {
    topicsDraftSections = sections;
  }
  const allItems = sections.flatMap(s => s.items);

  if (sections.length === 0 || allItems.length === 0) {
    container.innerHTML =
      `<div class="topics-empty-state">` +
        `<div class="topics-empty-icon">🧩</div>` +
        `<div class="topics-empty-title">No topics yet</div>` +
        `<div class="topics-empty-sub">Click <strong>Generate Topics</strong> to analyse all file summaries in this group and build a checklist of covered topics.</div>` +
      `</div>`;
    return;
  }

  const savedChecks = JSON.parse(localStorage.getItem(`group-topics-checked-${g.id}`) || '{}');
  const checkedCount = allItems.filter(t => savedChecks[t] === true).length;
  const pct = Math.round((checkedCount / allItems.length) * 100);

  const sortBarHtml =
    `<div class="topics-sort-bar">` +
      `<span class="topics-sort-label">Sort:</span>` +
      `<div class="topics-sort-toggle">` +
        `<button class="topics-sort-btn${topicsSortMode === 'hierarchy' ? ' active' : ''}" onclick="setTopicsSortMode('hierarchy')">📋 Hierarchy</button>` +
        `<button class="topics-sort-btn${topicsSortMode === 'date' ? ' active' : ''}" onclick="setTopicsSortMode('date')">📅 Date Created</button>` +
      `</div>` +
    `</div>`;

  const progressHtml =
    `<div class="topics-progress-row">` +
      `<span class="topics-progress-label">${checkedCount} / ${allItems.length} covered</span>` +
      `<div class="topics-progress-bar"><div class="topics-progress-fill" style="width:${pct}%"></div></div>` +
      `<span class="topics-progress-pct">${pct}%</span>` +
    `</div>`;

  let listHtml = '';
  if (topicsSortMode === 'hierarchy') {
    listHtml = renderChecklistEditor('topics', sections, g.id, savedChecks);
  } else {
    const flatHtml = sections.map(section => {
      const sectionHtml = section.items.map(topic =>
        `<label class="topics-item${savedChecks[topic] === true ? ' topics-item--done' : ''}">` +
          `<span class="topic-drag-box" title="Drag available in hierarchy mode"><span class="topic-drag-handle">⋮⋮</span></span>` +
          `<input type="checkbox" class="topics-checkbox" ${savedChecks[topic] === true ? 'checked' : ''}` +
            ` data-group="${g.id}" data-topic="${escAttr(topic)}" onchange="onTopicCheck(this)">` +
          `<span class="topics-item-text">${escHtml(topic)}</span>` +
          `<div class="topics-item-actions">` +
            `<button class="topic-mini-btn" type="button" title="Rename" onclick="renameUnderTopicByText('${escAttr(topic)}', event)">✏️</button>` +
            `<button class="topic-mini-btn danger" type="button" title="Delete" onclick="deleteUnderTopicByText('${escAttr(topic)}', event)">🗑</button>` +
          `</div>` +
        `</label>`
      ).join('');
      return (section.header ? `<div class="topics-date-separator"><span>${escHtml(section.header)}</span></div>` : '') + sectionHtml;
    }).join('');
    listHtml = `<div class="topics-list">${flatHtml}<div class="topics-sort-hint">Switch to <strong>Hierarchy</strong> mode to drag, create, or edit over/under topics.</div></div>`;
  }

  container.innerHTML = sortBarHtml + progressHtml + listHtml;
}

function onTopicCheck(input) {
  const groupId = parseInt(input.dataset.group);
  const topicText = input.dataset.topic;
  const checked = input.checked;
  const key = `group-topics-checked-${groupId}`;
  const state = JSON.parse(localStorage.getItem(key) || '{}');
  state[topicText] = checked;
  localStorage.setItem(key, JSON.stringify(state));
  // Toggle label style in place (no full re-render)
  const label = input.closest('label');
  if (label) label.classList.toggle('topics-item--done', checked);
  // Update progress bar in place
  const g = groups.find(x => x.id === groupId);
  if (!g) return;
  const sections = parseTopicsChecklist(g.topics_checklist);
  const allItems = sections.flatMap(s => s.items);
  const fresh = JSON.parse(localStorage.getItem(key) || '{}');
  const checkedCount = allItems.filter(t => fresh[t] === true).length;
  const pct = Math.round((checkedCount / allItems.length) * 100);
  const lbl = document.querySelector('.topics-progress-label');
  const fill = document.querySelector('.topics-progress-fill');
  const pctEl = document.querySelector('.topics-progress-pct');
  if (lbl) lbl.textContent = `${checkedCount} / ${allItems.length} covered`;
  if (fill) fill.style.width = `${pct}%`;
  if (pctEl) pctEl.textContent = `${pct}%`;
}

function onTodoCheck(input) {
  const groupId = parseInt(input.dataset.group);
  const topicText = input.dataset.topic;
  const checked = input.checked;
  const key = `group-todos-checked-${groupId}`;
  const state = JSON.parse(localStorage.getItem(key) || '{}');
  state[topicText] = checked;
  localStorage.setItem(key, JSON.stringify(state));
  const label = input.closest('label');
  if (label) label.classList.toggle('topics-item--done', checked);
}

function startSectionDrag(sectionIdx, event, listType = 'topic') {
  sectionDragFrom = { sectionIdx, listType };
  if (event?.currentTarget) {
    event.currentTarget.classList.add('topics-section-header--dragging');
  }
  if (event?.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `section:${listType}:${sectionIdx}`);
  }
}

function endSectionDrag(event) {
  sectionDragFrom = null;
  document.querySelectorAll('.topics-section-header--dragging, .topics-section-header--over, .topics-item-under--dragging, .topics-item-under--over, .topics-drop-zone--over')
    .forEach(el => el.classList.remove('topics-section-header--dragging', 'topics-section-header--over', 'topics-item-under--dragging', 'topics-item-under--over', 'topics-drop-zone--over'));
}

function allowSectionDrop(event) {
  event.preventDefault();
}

function markSectionDropTarget(event) {
  event.preventDefault();
  event.currentTarget?.classList.add('topics-section-header--over');
}

function unmarkSectionDropTarget(event) {
  event.currentTarget?.classList.remove('topics-section-header--over');
}

async function dropSection(targetSectionIdx, event) {
  event.preventDefault();
  event.currentTarget?.classList.remove('topics-section-header--over');
  if (sectionDragFrom == null || sectionDragFrom.sectionIdx === targetSectionIdx) return;
  const list = sectionDragFrom.listType === 'todo' ? todosDraftSections : topicsDraftSections;
  const moved = list.splice(sectionDragFrom.sectionIdx, 1)[0];
  if (!moved) return;
  list.splice(targetSectionIdx, 0, moved);
  sectionDragFrom = null;
  const g = groups.find(x => x.id === currentGroup?.id);
  if (g) renderTopicsView(g);
  await (list === todosDraftSections ? saveTodosDraft() : saveTopicsDraft());
}

function startTopicDrag(sectionIdx, topicIdx, event) {
  topicDragFrom = { sectionIdx, topicIdx };
  if (event?.currentTarget) {
    event.currentTarget.classList.add('topics-item-under--dragging');
  }
  if (event?.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `topic:${sectionIdx}:${topicIdx}`);
  }
}

function startChecklistItemDrag(sectionIdx, topicIdx, event) {
  checklistDragFrom = { sectionIdx, topicIdx, listType: 'todo' };
  if (event?.currentTarget) {
    event.currentTarget.classList.add('topics-item-under--dragging');
  }
  if (event?.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `todo:${sectionIdx}:${topicIdx}`);
  }
}

function endTopicDrag(event) {
  topicDragFrom = null;
  document.querySelectorAll('.topics-item-under--dragging, .topics-item-under--over, .topics-drop-zone--over')
    .forEach(el => el.classList.remove('topics-item-under--dragging', 'topics-item-under--over', 'topics-drop-zone--over'));
}

function endChecklistItemDrag(event) {
  checklistDragFrom = null;
  document.querySelectorAll('.topics-item-under--dragging, .topics-item-under--over, .topics-drop-zone--over')
    .forEach(el => el.classList.remove('topics-item-under--dragging', 'topics-item-under--over', 'topics-drop-zone--over'));
}

function allowTopicDrop(event) {
  event.preventDefault();
}

function markTopicDropTarget(event) {
  event.preventDefault();
  const target = event.currentTarget;
  if (!target) return;
  if (target.classList.contains('topics-drop-zone')) {
    target.classList.add('topics-drop-zone--over');
  } else {
    target.classList.add('topics-item-under--over');
  }
}

function unmarkTopicDropTarget(event) {
  const target = event.currentTarget;
  if (!target) return;
  target.classList.remove('topics-item-under--over', 'topics-drop-zone--over');
}

async function dropTopicBefore(targetSectionIdx, targetTopicIdx, event) {
  event.preventDefault();
  event.currentTarget?.classList.remove('topics-item-under--over');
  if (!topicDragFrom) return;
  const { sectionIdx, topicIdx } = topicDragFrom;
  const fromSection = topicsDraftSections[sectionIdx];
  if (!fromSection || !fromSection.items || !fromSection.items[topicIdx]) return;
  const [movedTopic] = fromSection.items.splice(topicIdx, 1);
  const toSection = topicsDraftSections[targetSectionIdx];
  if (!toSection) return;
  let insertIdx = targetTopicIdx;
  if (sectionIdx === targetSectionIdx && topicIdx < targetTopicIdx) {
    insertIdx = Math.max(0, targetTopicIdx - 1);
  }
  toSection.items.splice(insertIdx, 0, movedTopic);
  topicDragFrom = null;
  const g = groups.find(x => x.id === currentGroup?.id);
  if (g) renderTopicsView(g);
  await saveTopicsDraft();
}

async function dropChecklistItemBefore(targetSectionIdx, targetTopicIdx, event) {
  event.preventDefault();
  event.currentTarget?.classList.remove('topics-item-under--over');
  if (!checklistDragFrom) return;
  const { sectionIdx, topicIdx } = checklistDragFrom;
  const fromSection = todosDraftSections[sectionIdx];
  if (!fromSection || !fromSection.items || !fromSection.items[topicIdx]) return;
  const [movedItem] = fromSection.items.splice(topicIdx, 1);
  const toSection = todosDraftSections[targetSectionIdx];
  if (!toSection) return;
  let insertIdx = targetTopicIdx;
  if (sectionIdx === targetSectionIdx && topicIdx < targetTopicIdx) {
    insertIdx = Math.max(0, targetTopicIdx - 1);
  }
  toSection.items.splice(insertIdx, 0, movedItem);
  checklistDragFrom = null;
  const g = groups.find(x => x.id === currentGroup?.id);
  if (g) renderTopicsView(g);
  await saveTodosDraft();
}

async function dropTopicToSectionEnd(targetSectionIdx, event) {
  event.preventDefault();
  event.currentTarget?.classList.remove('topics-drop-zone--over');
  if (!topicDragFrom) return;
  const { sectionIdx, topicIdx } = topicDragFrom;
  const fromSection = topicsDraftSections[sectionIdx];
  if (!fromSection || !fromSection.items || !fromSection.items[topicIdx]) return;
  const [movedTopic] = fromSection.items.splice(topicIdx, 1);
  const toSection = topicsDraftSections[targetSectionIdx];
  if (!toSection) return;
  toSection.items.push(movedTopic);
  topicDragFrom = null;
  const g = groups.find(x => x.id === currentGroup?.id);
  if (g) renderTopicsView(g);
  await saveTopicsDraft();
}

async function dropChecklistItemToSectionEnd(targetSectionIdx, event) {
  event.preventDefault();
  event.currentTarget?.classList.remove('topics-drop-zone--over');
  if (!checklistDragFrom) return;
  const { sectionIdx, topicIdx } = checklistDragFrom;
  const fromSection = todosDraftSections[sectionIdx];
  if (!fromSection || !fromSection.items || !fromSection.items[topicIdx]) return;
  const [movedItem] = fromSection.items.splice(topicIdx, 1);
  const toSection = todosDraftSections[targetSectionIdx];
  if (!toSection) return;
  toSection.items.push(movedItem);
  checklistDragFrom = null;
  const g = groups.find(x => x.id === currentGroup?.id);
  if (g) renderTopicsView(g);
  await saveTodosDraft();
}

async function renameOverTopic(sectionIdx, e) {
  if (e) e.stopPropagation();
  const section = topicsDraftSections[sectionIdx];
  if (!section) return;
  const next = prompt('Rename over-topic', section.header || 'General');
  if (next == null) return;
  const cleaned = next.trim();
  if (!cleaned) return;
  section.header = cleaned;
  const g = groups.find(x => x.id === currentGroup?.id);
  if (g) renderTopicsView(g);
  await saveTopicsDraft();
}

async function deleteOverTopic(sectionIdx, e) {
  if (e) e.stopPropagation();
  const section = topicsDraftSections[sectionIdx];
  if (!section) return;
  const ok = confirm(`Delete over-topic "${section.header}"? Under-topics will be moved to General.`);
  if (!ok) return;
  const removed = topicsDraftSections.splice(sectionIdx, 1)[0];
  if (removed && removed.items?.length) {
    let general = topicsDraftSections.find(s => (s.header || '').toLowerCase() === 'general');
    if (!general) {
      general = { header: 'General', items: [] };
      topicsDraftSections.push(general);
    }
    general.items.push(...removed.items);
  }
  const g = groups.find(x => x.id === currentGroup?.id);
  if (g) renderTopicsView(g);
  await saveTopicsDraft();
}

async function addOverTopic() {
  const name = prompt('New over-topic name');
  if (name == null) return;
  const cleaned = name.trim();
  if (!cleaned) return;
  topicsDraftSections.push({ header: cleaned, items: [] });
  const g = groups.find(x => x.id === currentGroup?.id);
  if (g) renderTopicsView(g);
  await saveTopicsDraft();
}

async function addUnderTopic(sectionIdx, e) {
  if (e) e.stopPropagation();
  const section = topicsDraftSections[sectionIdx];
  if (!section) return;
  const name = prompt(`New under-topic for "${section.header}"`);
  if (name == null) return;
  const cleaned = name.trim();
  if (!cleaned) return;
  section.items.push(cleaned);
  const g = groups.find(x => x.id === currentGroup?.id);
  if (g) renderTopicsView(g);
  await saveTopicsDraft();
}

async function renameTodoSection(sectionIdx, e) {
  if (e) e.stopPropagation();
  const section = todosDraftSections[sectionIdx];
  if (!section) return;
  const next = prompt('Rename to-do section', section.header || 'General');
  if (next == null) return;
  const cleaned = next.trim();
  if (!cleaned) return;
  section.header = cleaned;
  const g = groups.find(x => x.id === currentGroup?.id);
  if (g) renderTopicsView(g);
  await saveTodosDraft();
}

async function deleteTodoSection(sectionIdx, e) {
  if (e) e.stopPropagation();
  const section = todosDraftSections[sectionIdx];
  if (!section) return;
  const ok = confirm(`Delete to-do section "${section.header}"? Items will be moved to General.`);
  if (!ok) return;
  const removed = todosDraftSections.splice(sectionIdx, 1)[0];
  if (removed && removed.items?.length) {
    let general = todosDraftSections.find(s => (s.header || '').toLowerCase() === 'general');
    if (!general) {
      general = { header: 'General', items: [] };
      todosDraftSections.push(general);
    }
    general.items.push(...removed.items);
  }
  const g = groups.find(x => x.id === currentGroup?.id);
  if (g) renderTopicsView(g);
  await saveTodosDraft();
}

async function addTodoSection() {
  const name = prompt('New to-do section name');
  if (name == null) return;
  const cleaned = name.trim();
  if (!cleaned) return;
  todosDraftSections.push({ header: cleaned, items: [] });
  const g = groups.find(x => x.id === currentGroup?.id);
  if (g) renderTopicsView(g);
  await saveTodosDraft();
}

async function addTodoItem(sectionIdx, e) {
  if (e) e.stopPropagation();
  const section = todosDraftSections[sectionIdx];
  if (!section) return;
  const name = prompt(`New to-do for "${section.header}"`);
  if (name == null) return;
  const cleaned = name.trim();
  if (!cleaned) return;
  section.items.push(cleaned);
  const g = groups.find(x => x.id === currentGroup?.id);
  if (g) renderTopicsView(g);
  await saveTodosDraft();
}

async function renameUnderTopicByText(topicText, e) {
  if (e) e.stopPropagation();
  for (const section of topicsDraftSections) {
    const idx = (section.items || []).findIndex(t => t === topicText);
    if (idx >= 0) {
      const next = prompt('Rename under-topic', topicText);
      if (next == null) return;
      const cleaned = next.trim();
      if (!cleaned) return;
      section.items[idx] = cleaned;
      const key = `group-topics-checked-${currentGroup?.id}`;
      const state = JSON.parse(localStorage.getItem(key) || '{}');
      if (state[topicText] != null) {
        state[cleaned] = state[topicText];
        delete state[topicText];
        localStorage.setItem(key, JSON.stringify(state));
      }
      const g = groups.find(x => x.id === currentGroup?.id);
      if (g) renderTopicsView(g);
      await saveTopicsDraft();
      return;
    }
  }
}

async function deleteUnderTopicByText(topicText, e) {
  if (e) e.stopPropagation();
  for (const section of topicsDraftSections) {
    const idx = (section.items || []).findIndex(t => t === topicText);
    if (idx >= 0) {
      section.items.splice(idx, 1);
      const key = `group-topics-checked-${currentGroup?.id}`;
      const state = JSON.parse(localStorage.getItem(key) || '{}');
      delete state[topicText];
      localStorage.setItem(key, JSON.stringify(state));
      const g = groups.find(x => x.id === currentGroup?.id);
      if (g) renderTopicsView(g);
      await saveTopicsDraft();
      return;
    }
  }
}

async function renameTodoByText(topicText, e) {
  if (e) e.stopPropagation();
  for (const section of todosDraftSections) {
    const idx = (section.items || []).findIndex(t => t === topicText);
    if (idx >= 0) {
      const next = prompt('Rename to-do', topicText);
      if (next == null) return;
      const cleaned = next.trim();
      if (!cleaned) return;
      section.items[idx] = cleaned;
      const key = `group-todos-checked-${currentGroup?.id}`;
      const state = JSON.parse(localStorage.getItem(key) || '{}');
      if (state[topicText] != null) {
        state[cleaned] = state[topicText];
        delete state[topicText];
        localStorage.setItem(key, JSON.stringify(state));
      }
      const g = groups.find(x => x.id === currentGroup?.id);
      if (g) renderTopicsView(g);
      await saveTodosDraft();
      return;
    }
  }
}

async function deleteTodoByText(topicText, e) {
  if (e) e.stopPropagation();
  for (const section of todosDraftSections) {
    const idx = (section.items || []).findIndex(t => t === topicText);
    if (idx >= 0) {
      section.items.splice(idx, 1);
      const key = `group-todos-checked-${currentGroup?.id}`;
      const state = JSON.parse(localStorage.getItem(key) || '{}');
      delete state[topicText];
      localStorage.setItem(key, JSON.stringify(state));
      const g = groups.find(x => x.id === currentGroup?.id);
      if (g) renderTopicsView(g);
      await saveTodosDraft();
      return;
    }
  }
}

async function generateGroupTopics() {
  if (!currentGroup || currentGroup.id === 'uncategorized') return;
  const btn = document.getElementById('btn-generate-topics');
  if (btn) { btn.disabled = true; btn.textContent = '… Generating'; }
  try {
    const result = await api('POST', `/api/groups/${currentGroup.id}/generate-topics`);
    const g = groups.find(x => x.id === currentGroup.id);
    if (g) {
      g.topics_checklist = result.topics_checklist;
      topicsDraftSections = parseTopicsChecklist(g.topics_checklist);
      renderTopicsView(g);
    }
    showToast('Topics checklist generated!');
  } catch (err) {
    showToast('Could not generate topics: ' + err.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✦ Generate Topics'; }
  }
}

function resetTopicChecks() {
  if (!currentGroup) return;
  localStorage.removeItem(`group-topics-checked-${currentGroup.id}`);
  const g = groups.find(x => x.id === currentGroup.id);
  if (g) renderTopicsView(g);
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
        subgroupName = matched ? matched.name : "Group";
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
    currentShareTarget = { type: "group", id: currentGroup.id };
    const titleEl = document.getElementById("share-modal-title");
    const descEl = document.getElementById("share-modal-description");
    if (titleEl) titleEl.textContent = "Share Group";
    if (descEl) descEl.textContent = "Anyone with this link can view the files, descriptions, summaries, and flashcards in this group.";
    document.getElementById("share-link-input").value = shareUrl;
    showModal("modal-share");
  } catch (e) {
    showToast("Could not generate share link: " + e.message, true);
  }
}

async function openShareFileModal(fileId) {
  if (!fileId) return;
  try {
    const result = await api("POST", `/api/files/${fileId}/share`);
    const shareUrl = `${location.origin}/shared/file/${result.share_token}`;
    currentShareTarget = { type: "file", id: fileId };
    const titleEl = document.getElementById("share-modal-title");
    const descEl = document.getElementById("share-modal-description");
    if (titleEl) titleEl.textContent = "Share File";
    if (descEl) descEl.textContent = "Anyone with this link can view this file and its details (description, summary, flashcards, and generated tasks).";
    document.getElementById("share-link-input").value = shareUrl;
    showModal("modal-share");
  } catch (e) {
    showToast("Could not generate share link: " + e.message, true);
  }
}

async function revokeShareLink() {
  if (!currentShareTarget) return;
  try {
    if (currentShareTarget.type === "group") {
      await api("DELETE", `/api/groups/${currentShareTarget.id}/share`);
    } else if (currentShareTarget.type === "file") {
      await api("DELETE", `/api/files/${currentShareTarget.id}/share`);
    }
    currentShareTarget = null;
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
        `<div class="group-card-name">New Group</div>` +
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
            showToast("Group reorder failed: " + err.message, true);
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
      `<div class="file-title-row">` +
        `<input class="detail-filename-input" id="fname-${file.id}" value="${escAttr(file.original_name)}" />` +
        `<button class="btn btn-success btn-sm" onclick="saveFileDetails(${file.id})" title="Save file">&#128190; Save</button>` +
      `</div>` +
      `<div class="sidebar-meta">` +
        `<span class="detail-meta">Uploaded ${formatDate(file.uploaded_at)}</span>` +
        `<button class="btn btn-sm btn-outline" onclick="openShareFileModal(${file.id})" title="Share this file">🔗 Share</button>` +
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
          `<button class="btn btn-outline btn-sm" onclick="copyFieldText(${file.id}, 'summary')">&#128203; Copy Summary</button>` +
        `</div>` +
      `</div>` +
      `<div class="info-card">` +
        `<div class="info-card-header">` +
          `<span class="info-card-title">Flashcards</span>` +
          `<span class="ai-badge">&#129302; AI-ready</span>` +
        `</div>` +
        `<p class="task-card-copy">Generates RemNote-ready flashcards in plain text using the format: Front :: Back (one card per line).</p>` +
        `<textarea id="flashcards-${file.id}" class="task-textarea task-output" placeholder="Flashcards for RemNote will appear here&#8230;">${escHtml(file.flashcards || "")}</textarea>` +
        `<div class="info-card-actions" style="margin-top:10px">` +
          `<button class="btn btn-outline btn-sm" id="btn-flashcards-${file.id}" onclick="runAIFlashcards(${file.id})">` +
            `&#129302; Generate Flashcards` +
          `</button>` +
          `<button class="btn btn-outline btn-sm" onclick="copyFieldText(${file.id}, 'flashcards')">&#128203; Copy Flashcards</button>` +
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
          `<button class="btn btn-outline btn-sm" onclick="copyFieldText(${file.id}, 'tasks')">&#128203; Copy Tasks</button>` +
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
  infoContainer.querySelector(`#flashcards-${file.id}`).addEventListener("input", () => { filesDirty = true; });
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
      `<div class="file-title-row">` +
        `<input class="detail-filename-input" id="fname-${file.id}" value="${escAttr(file.original_name)}" />` +
        `<button class="btn btn-success btn-sm" onclick="saveFileDetails(${file.id})" title="Save file">&#128190; Save</button>` +
      `</div>` +
      `<div class="detail-meta-row">` +
        `<span class="detail-meta">Uploaded ${formatDate(file.uploaded_at)}</span>` +
        `<button class="btn btn-sm btn-outline" onclick="openShareFileModal(${file.id})" title="Share this file">🔗 Share</button>` +
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
        `<button class="btn btn-outline btn-sm" onclick="copyFieldText(${file.id}, 'summary')">&#128203; Copy Summary</button>` +
      `</div>` +
    `</div>` +

    `<div class="info-card">` +
      `<div class="info-card-header">` +
        `<span class="info-card-title">Flashcards</span>` +
        `<span class="ai-badge">&#129302; AI-ready</span>` +
      `</div>` +
      `<p class="task-card-copy">Generates RemNote-ready flashcards in plain text using the format: Front :: Back (one card per line).</p>` +
      `<textarea id="flashcards-${file.id}" class="task-textarea task-output" placeholder="Flashcards for RemNote will appear here&#8230;">${escHtml(file.flashcards || "")}</textarea>` +
      `<div class="info-card-actions" style="margin-top:10px">` +
        `<button class="btn btn-outline btn-sm" id="btn-flashcards-${file.id}" onclick="runAIFlashcards(${file.id})">` +
          `&#129302; Generate Flashcards` +
        `</button>` +
        `<button class="btn btn-outline btn-sm" onclick="copyFieldText(${file.id}, 'flashcards')">&#128203; Copy Flashcards</button>` +
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
        `<button class="btn btn-outline btn-sm" onclick="copyFieldText(${file.id}, 'tasks')">&#128203; Copy Tasks</button>` +
      `</div>` +
    `</div>`;

  container.querySelector(`#fname-${file.id}`).addEventListener("input", () => { filesDirty = true; });
  container.querySelector(`#desc-${file.id}`).addEventListener("input",  () => { filesDirty = true; });
  container.querySelector(`#summary-${file.id}`).addEventListener("input", () => { filesDirty = true; });
  container.querySelector(`#flashcards-${file.id}`).addEventListener("input", () => { filesDirty = true; });
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
  } else if (currentView === 'topics') {
    btnBack.style.display     = "inline-flex";
    btnBackLbl.textContent    = "Library";
    btnNewGroup.style.display = "none";
    btnNewSubgroup.style.display = "none";
    btnUpload.style.display   = "none";
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
  } else if (currentView === 'topics') {
    _goLibrary();
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
  document.getElementById("modal-group-title").textContent = `New Group in ${currentGroup.name}`;
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
  document.getElementById("modal-group-title").textContent = "Rename Group";
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
        showToast("Open a group first to manage groups", true);
        return;
      }
      if (subgroupId) {
        await api("PUT", `/api/subgroups/${subgroupId}`, { name });
        showToast("Group renamed");
      } else {
        await api("POST", `/api/groups/${currentGroup.id}/subgroups`, { name });
        showToast("Group created");
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
  confirm_(`Delete group "${name}"? Files inside it will stay in the parent group.`, async () => {
    try {
      await api("DELETE", `/api/subgroups/${subgroupId}`);
      if (currentSubgroup && currentSubgroup.id === subgroupId) {
        currentSubgroup = null;
      }
      await navigateToGroup(currentGroup.id, currentGroup.name);
      await loadLibrary();
      showToast("Group deleted");
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
  const flashcards = document.getElementById(`flashcards-${fileId}`).value;
  const exampleTasks = document.getElementById(`examples-${fileId}`).value;
  const generatedTasks = document.getElementById(`tasks-${fileId}`).value;
  try {
    const updated = await api("PUT", `/api/files/${fileId}`, {
      original_name: fname, description: desc, summary, flashcards,
      example_tasks: exampleTasks, generated_tasks: generatedTasks,
    });
    currentFile = updated;
    filesDirty  = false;
    showToast("Saved");
  } catch (e) { showToast("Save failed: " + e.message, true); }
}

function copyFieldText(fileId, field) {
  const textareasByField = {
    summary: `summary-${fileId}`,
    flashcards: `flashcards-${fileId}`,
    tasks: `tasks-${fileId}`,
  };
  const labelsByField = {
    summary: "Summary",
    flashcards: "Flashcards",
    tasks: "Tasks",
  };
  const elementId = textareasByField[field];
  if (!elementId) return;

  const source = document.getElementById(elementId);
  if (!source) return;

  const value = source.value || "";
  const copyLabel = labelsByField[field] || "Text";

  const fallbackCopy = () => {
    source.focus();
    source.select();
    document.execCommand("copy");
  };

  navigator.clipboard.writeText(value).then(() => {
    showToast(`${copyLabel} copied to clipboard`);
  }).catch(() => {
    try {
      fallbackCopy();
      showToast(`${copyLabel} copied to clipboard`);
    } catch (err) {
      showToast(`Could not copy ${copyLabel.toLowerCase()}`, true);
    }
  });
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
    showToast("Group updated");
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
    `<option value="">No group</option>` +
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

async function runAIFlashcards(fileId) {
  const btn = document.getElementById(`btn-flashcards-${fileId}`);
  const payload = {
    original_name: document.getElementById(`fname-${fileId}`).value.trim(),
    description: document.getElementById(`desc-${fileId}`).value,
    summary: document.getElementById(`summary-${fileId}`).value,
  };
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generating&#8230;';
  try {
    const result = await api("POST", `/api/files/${fileId}/generate-flashcards`, payload);
    document.getElementById(`flashcards-${fileId}`).value = result.flashcards;
    currentFile = result.file;
    filesDirty = true;
    showToast("Flashcards generated");
  } catch (e) {
    showToast("Flashcard generation failed: " + e.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '&#129302; Generate Flashcards';
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

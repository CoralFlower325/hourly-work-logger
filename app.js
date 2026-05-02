const state = {
  status: null,
  toastTimer: null,
  historyPage: 1,
};

const HISTORY_PAGE_SIZE = 5;

const els = {
  enabled: document.querySelector("#enabled"),
  scheduleMode: document.querySelector("#scheduleMode"),
  minuteOfHour: document.querySelector("#minuteOfHour"),
  intervalMinutes: document.querySelector("#intervalMinutes"),
  activeStart: document.querySelector("#activeStart"),
  activeEnd: document.querySelector("#activeEnd"),
  title: document.querySelector("#title"),
  promptText: document.querySelector("#promptText"),
  minuteField: document.querySelector("#minuteField"),
  intervalField: document.querySelector("#intervalField"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  triggerNowButton: document.querySelector("#triggerNowButton"),
  refreshButton: document.querySelector("#refreshButton"),
  openFolderButton: document.querySelector("#openFolderButton"),
  monitorStatus: document.querySelector("#monitorStatus"),
  nextReminder: document.querySelector("#nextReminder"),
  todayCount: document.querySelector("#todayCount"),
  totalCount: document.querySelector("#totalCount"),
  lastEntryTime: document.querySelector("#lastEntryTime"),
  lastEntryPreview: document.querySelector("#lastEntryPreview"),
  searchInput: document.querySelector("#searchInput"),
  historyList: document.querySelector("#historyList"),
  historyPageInfo: document.querySelector("#historyPageInfo"),
  prevPageButton: document.querySelector("#prevPageButton"),
  nextPageButton: document.querySelector("#nextPageButton"),
  exportButton: document.querySelector("#exportButton"),
  exportStartDate: document.querySelector("#exportStartDate"),
  exportEndDate: document.querySelector("#exportEndDate"),
  toast: document.querySelector("#toast"),
};

attachEvents();
seedExportDates();
loadStatus();
startStatusPolling();

function attachEvents() {
  els.scheduleMode.addEventListener("change", toggleScheduleFields);
  els.saveSettingsButton.addEventListener("click", saveSettings);
  els.enabled.addEventListener("change", handleEnabledToggle);
  els.triggerNowButton.addEventListener("click", triggerNow);
  els.refreshButton.addEventListener("click", loadStatus);
  els.searchInput.addEventListener("input", () => {
    state.historyPage = 1;
    renderHistory();
  });
  els.openFolderButton.addEventListener("click", openDataFolderHint);
  els.exportButton.addEventListener("click", exportCsv);
  els.historyList.addEventListener("click", handleHistoryAction);
  els.prevPageButton.addEventListener("click", () => changeHistoryPage(-1));
  els.nextPageButton.addEventListener("click", () => changeHistoryPage(1));
}

function seedExportDates() {
  const today = new Date().toISOString().slice(0, 10);
  els.exportStartDate.value = today;
  els.exportEndDate.value = today;
}

async function loadStatus() {
  const response = await fetch("/api/status");
  state.status = await response.json();
  hydrateForm(state.status.config);
  render();
}

function startStatusPolling() {
  window.setInterval(async () => {
    try {
      await loadStatus();
    } catch {
      // Keep the current UI state if a background refresh fails.
    }
  }, 15000);
}

async function saveSettings() {
  return saveSettingsInternal({ showToast: true });
}

async function saveSettingsInternal({ showToast }) {
  const payload = readSettingsFromForm();
  setSavingState(true);
  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    state.status = {
      ...(state.status || {}),
      config: result.config,
      nextDueAt: state.status?.nextDueAt || "",
      logs: state.status?.logs || [],
      state: state.status?.state || {},
      appDir: state.status?.appDir || "",
    };
    await loadStatus();

    if (showToast) {
      showToastMessage(result.config.enabled ? "设置已保存，后台弹窗已启用" : "设置已保存，后台弹窗已暂停");
    }
  } catch {
    showToastMessage("保存失败，请再试一次");
  } finally {
    setSavingState(false);
  }
}

async function handleEnabledToggle() {
  await saveSettingsInternal({ showToast: true });
}

async function triggerNow() {
  els.triggerNowButton.disabled = true;
  els.triggerNowButton.textContent = "已触发，请在系统弹窗里填写";

  try {
    await fetch("/api/trigger", { method: "POST" });
  } finally {
    setTimeout(async () => {
      els.triggerNowButton.disabled = false;
      els.triggerNowButton.textContent = "立刻弹一次";
      await loadStatus();
    }, 1500);
  }
}

function hydrateForm(config) {
  els.enabled.value = String(config.enabled);
  els.scheduleMode.value = config.scheduleMode;
  els.minuteOfHour.value = config.minuteOfHour;
  els.intervalMinutes.value = config.intervalMinutes;
  els.activeStart.value = config.activeStart;
  els.activeEnd.value = config.activeEnd;
  els.title.value = config.title;
  els.promptText.value = config.promptText;
  toggleScheduleFields();
}

function readSettingsFromForm() {
  return {
    enabled: els.enabled.value === "true",
    scheduleMode: els.scheduleMode.value,
    minuteOfHour: Number(els.minuteOfHour.value || 0),
    intervalMinutes: Number(els.intervalMinutes.value || 60),
    activeStart: els.activeStart.value || "09:00",
    activeEnd: els.activeEnd.value || "18:00",
    title: els.title.value.trim() || "Hourly Work Logger",
    promptText: els.promptText.value.trim() || "请记录刚才这一小时你做了什么：",
  };
}

function toggleScheduleFields() {
  const hourly = els.scheduleMode.value === "hourly";
  els.minuteField.classList.toggle("hidden", !hourly);
  els.intervalField.classList.toggle("hidden", hourly);
}

function render() {
  if (!state.status) {
    return;
  }

  const config = state.status.config;
  const logs = state.status.logs || [];
  const runtimeState = state.status.state || {};
  const summary = state.status.summary || { todayCount: 0, totalCount: logs.length };
  const promptAgentRunning = Boolean(state.status.promptAgentRunning);

  els.monitorStatus.textContent = config.enabled && promptAgentRunning ? "后台监督中" : "已暂停";
  els.nextReminder.textContent = state.status.nextDueAt ? formatDateTime(state.status.nextDueAt) : "未安排";
  els.todayCount.textContent = String(summary.todayCount);
  els.totalCount.textContent = String(summary.totalCount);
  els.lastEntryTime.textContent = runtimeState.lastPromptAt ? formatDateTime(runtimeState.lastPromptAt) : "暂无";
  els.lastEntryPreview.textContent = runtimeState.lastEntryPreview || "暂无记录";

  renderHistory();
}

function setSavingState(saving) {
  els.saveSettingsButton.disabled = saving;
  els.enabled.disabled = saving;
  els.saveSettingsButton.textContent = saving ? "保存中..." : "保存设置";
}

function renderHistory() {
  const logs = state.status?.logs || [];
  const keyword = els.searchInput.value.trim().toLowerCase();
  const filtered = logs.filter((item) => item.entry.toLowerCase().includes(keyword));
  const totalPages = Math.max(1, Math.ceil(filtered.length / HISTORY_PAGE_SIZE));
  state.historyPage = Math.min(totalPages, Math.max(1, state.historyPage));
  const startIndex = (state.historyPage - 1) * HISTORY_PAGE_SIZE;
  const pageItems = filtered.slice(startIndex, startIndex + HISTORY_PAGE_SIZE);

  els.historyPageInfo.textContent = `第 ${state.historyPage} / ${totalPages} 页`;
  els.prevPageButton.disabled = state.historyPage <= 1;
  els.nextPageButton.disabled = state.historyPage >= totalPages;

  if (filtered.length === 0) {
    els.historyList.innerHTML = '<div class="empty-state">还没有匹配的记录。系统弹窗提交后的内容会显示在这里。</div>';
    return;
  }

  const grouped = groupLogsByDay(pageItems);

  els.historyList.innerHTML = Object.entries(grouped)
    .map(
      ([day, items]) => `
        <section class="history-group">
          <div class="history-group-header">${day}</div>
          ${items
            .map(
              (item) => `
                <article class="history-item">
                  <div class="history-meta">
                    <span>${formatDateTime(item.timestamp)}</span>
                    <span class="history-actions">
                      <button class="mini-action" data-action="edit" data-id="${item.id}">编辑</button>
                      <button class="mini-action danger" data-action="delete" data-id="${item.id}">删除</button>
                    </span>
                  </div>
                  <div class="history-content">${escapeHtml(item.entry)}</div>
                </article>
              `,
            )
            .join("")}
        </section>
      `,
    )
    .join("");
}

function changeHistoryPage(delta) {
  state.historyPage = Math.max(1, state.historyPage + delta);
  renderHistory();
}

function formatDateTime(value) {
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function openDataFolderHint() {
  const appDir = state.status?.appDir || "~/Library/Application Support/HourlyWorkLogger";
  window.alert(`数据目录：\n${appDir}\n\n你也可以在终端执行：\nopen "${appDir}"`);
}

function showToastMessage(message) {
  if (state.toastTimer) {
    clearTimeout(state.toastTimer);
  }

  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  els.toast.classList.add("visible");

  state.toastTimer = setTimeout(() => {
    els.toast.classList.remove("visible");
    els.toast.classList.add("hidden");
  }, 2200);
}

function exportCsv() {
  const logs = filterLogsByExportDates(state.status?.logs || []);
  const startDate = els.exportStartDate.value;
  const endDate = els.exportEndDate.value;

  const markdown = buildMarkdownExport(logs, startDate, endDate);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `hourly-work-log-${startDate}-to-${endDate}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function filterLogsByExportDates(logs) {
  const startDate = els.exportStartDate.value;
  const endDate = els.exportEndDate.value || startDate;

  return logs.filter((item) => {
    const datePart = item.timestamp.slice(0, 10);
    return datePart >= startDate && datePart <= endDate;
  });
}

function groupLogsByDay(logs) {
  return logs.reduce((groups, item) => {
    const day = item.timestamp.slice(0, 10);
    if (!groups[day]) {
      groups[day] = [];
    }
    groups[day].push(item);
    return groups;
  }, {});
}

function buildMarkdownExport(logs, startDate, endDate) {
  const grouped = groupLogsByDay(logs);
  const header = [
    "# Hourly Work Logger 导出",
    "",
    `- 导出日期范围：${startDate} 至 ${endDate}`,
    `- 导出时间：${new Date().toLocaleString("zh-CN")}`,
    "",
  ];

  const body = Object.entries(grouped).flatMap(([day, items]) => [
    `## ${day}`,
    "",
    ...items.map((item) => `- ${item.timestamp.slice(11, 16)}  ${item.entry.replaceAll("\n", " ")}`),
    "",
  ]);

  if (body.length === 0) {
    body.push("这个日期范围内没有记录。", "");
  }

  return [...header, ...body].join("\n");
}

async function handleHistoryAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) {
    return;
  }

  const action = button.dataset.action;
  const id = button.dataset.id;
  const logs = state.status?.logs || [];
  const target = logs.find((item) => item.id === id);
  if (!target) {
    return;
  }

  if (action === "edit") {
    const nextEntry = window.prompt("修改这条记录：", target.entry);
    if (nextEntry === null) {
      return;
    }

    const trimmed = nextEntry.trim();
    if (!trimmed) {
      window.alert("记录内容不能为空。");
      return;
    }

    await fetch("/api/logs/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id, entry: trimmed }),
    });
    state.historyPage = 1;
    await loadStatus();
    return;
  }

  if (action === "delete") {
    const confirmed = window.confirm("确定删除这条记录吗？");
    if (!confirmed) {
      return;
    }

    await fetch("/api/logs/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id }),
    });
    const remainingLogs = (state.status?.logs || []).length - 1;
    const maxPage = Math.max(1, Math.ceil(Math.max(0, remainingLogs) / HISTORY_PAGE_SIZE));
    state.historyPage = Math.min(state.historyPage, maxPage);
    await loadStatus();
  }
}

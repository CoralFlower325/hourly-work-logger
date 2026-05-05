const state = {
  status: null,
  toastTimer: null,
  historyPage: 1,
  isEditingSettings: false,
  suppressDirtyTracking: false,
  autosaveTimer: null,
  analyticsDay: null,
  analyticsWeek: null,
  hermesUsage: null,
  hermesFilters: {
    scope: "total",
    model: "",
    sessionId: "",
  },
};

const HISTORY_PAGE_SIZE = 5;
const DEFAULT_BLACKLIST_LIMIT_SECONDS = 60 * 60;

const els = {
  waterRippleLayer: document.querySelector("#waterRippleLayer"),
  enabled: document.querySelector("#enabled"),
  scheduleMode: document.querySelector("#scheduleMode"),
  minuteOfHour: document.querySelector("#minuteOfHour"),
  intervalMinutes: document.querySelector("#intervalMinutes"),
  activeStart: document.querySelector("#activeStart"),
  activeEnd: document.querySelector("#activeEnd"),
  title: document.querySelector("#title"),
  promptText: document.querySelector("#promptText"),
  readingGuardEnabled: document.querySelector("#readingGuardEnabled"),
  readingTargetMinutes: document.querySelector("#readingTargetMinutes"),
  readingWhitelist: document.querySelector("#readingWhitelist"),
  readingBlacklist: document.querySelector("#readingBlacklist"),
  blacklistUsageList: document.querySelector("#blacklistUsageList"),
  aiBaseURL: document.querySelector("#aiBaseURL"),
  aiModel: document.querySelector("#aiModel"),
  aiApiKey: document.querySelector("#aiApiKey"),
  analyticsDate: document.querySelector("#analyticsDate"),
  minuteField: document.querySelector("#minuteField"),
  intervalField: document.querySelector("#intervalField"),
  triggerNowButton: document.querySelector("#triggerNowButton"),
  analyzeDayButton: document.querySelector("#analyzeDayButton"),
  analyzeWeekButton: document.querySelector("#analyzeWeekButton"),
  openFolderButton: document.querySelector("#openFolderButton"),
  monitorStatus: document.querySelector("#monitorStatus"),
  nextReminder: document.querySelector("#nextReminder"),
  todayCount: document.querySelector("#todayCount"),
  totalCount: document.querySelector("#totalCount"),
  lastEntryTime: document.querySelector("#lastEntryTime"),
  lastEntryPreview: document.querySelector("#lastEntryPreview"),
  readingToday: document.querySelector("#readingToday"),
  currentFrontmostApp: document.querySelector("#currentFrontmostApp"),
  currentFrontmostDetail: document.querySelector("#currentFrontmostDetail"),
  lastObservedApp: document.querySelector("#lastObservedApp"),
  lastObservedDetail: document.querySelector("#lastObservedDetail"),
  lastBlockedApp: document.querySelector("#lastBlockedApp"),
  searchInput: document.querySelector("#searchInput"),
  historyList: document.querySelector("#historyList"),
  historyPageInfo: document.querySelector("#historyPageInfo"),
  prevPageButton: document.querySelector("#prevPageButton"),
  nextPageButton: document.querySelector("#nextPageButton"),
  exportButton: document.querySelector("#exportButton"),
  exportStartDate: document.querySelector("#exportStartDate"),
  exportEndDate: document.querySelector("#exportEndDate"),
  analyticsStatus: document.querySelector("#analyticsStatus"),
  dailySummary: document.querySelector("#dailySummary"),
  weeklySummary: document.querySelector("#weeklySummary"),
  dailyGrid: document.querySelector("#dailyGrid"),
  weeklyGrid: document.querySelector("#weeklyGrid"),
  hermesScopeSelect: document.querySelector("#hermesScopeSelect"),
  hermesModelSelect: document.querySelector("#hermesModelSelect"),
  hermesSessionSelect: document.querySelector("#hermesSessionSelect"),
  hermesUsageStatus: document.querySelector("#hermesUsageStatus"),
  hermesUsageBoard: document.querySelector("#hermesUsageBoard"),
  toast: document.querySelector("#toast"),
};

attachEvents();
seedExportDates();
seedAnalyticsDate();
loadStatus({ forceHydrate: true });
loadAnalytics();
loadHermesUsage();
startStatusPolling();

function attachEvents() {
  els.scheduleMode.addEventListener("change", toggleScheduleFields);
  els.triggerNowButton.addEventListener("click", triggerNow);
  els.searchInput.addEventListener("input", () => {
    state.historyPage = 1;
    renderHistory();
  });
  els.openFolderButton.addEventListener("click", openDataFolderHint);
  els.exportButton.addEventListener("click", exportCsv);
  els.analyzeDayButton.addEventListener("click", classifySelectedDay);
  els.analyzeWeekButton.addEventListener("click", classifySelectedWeek);
  els.analyticsDate.addEventListener("change", handleAnalyticsDateChange);
  els.historyList.addEventListener("click", handleHistoryAction);
  els.prevPageButton.addEventListener("click", () => changeHistoryPage(-1));
  els.nextPageButton.addEventListener("click", () => changeHistoryPage(1));
  els.readingBlacklist.addEventListener("input", handleReadingBlacklistDraftChange);
  els.blacklistUsageList.addEventListener("input", handleBlacklistLimitDraftInput);
  els.blacklistUsageList.addEventListener("change", handleBlacklistLimitDraftInput);
  els.hermesScopeSelect.addEventListener("change", handleHermesScopeChange);
  els.hermesModelSelect.addEventListener("change", handleHermesModelChange);
  els.hermesSessionSelect.addEventListener("change", handleHermesSessionChange);
  bindSettingsDraftTracking();
}

function seedExportDates() {
  const today = new Date().toISOString().slice(0, 10);
  els.exportStartDate.value = today;
  els.exportEndDate.value = today;
}

function seedAnalyticsDate() {
  if (!els.analyticsDate.value) {
    els.analyticsDate.value = new Date().toISOString().slice(0, 10);
  }
}

async function loadStatus({ forceHydrate = false } = {}) {
  const response = await fetch("/api/status");
  state.status = await response.json();
  if (forceHydrate || !state.isEditingSettings) {
    hydrateForm(state.status.config);
  }
  render();
}

async function loadAnalytics() {
  const selectedDate = els.analyticsDate.value || new Date().toISOString().slice(0, 10);
  try {
    const [dayResponse, weekResponse] = await Promise.all([
      fetch(`/api/analytics/day?date=${encodeURIComponent(selectedDate)}`),
      fetch(`/api/analytics/week?date=${encodeURIComponent(selectedDate)}`),
    ]);
    state.analyticsDay = await dayResponse.json();
    state.analyticsWeek = await weekResponse.json();
    renderAnalytics();
  } catch {
    els.analyticsStatus.textContent = "暂时无法读取镜面复盘数据。";
  }
}

async function loadHermesUsage() {
  const params = new URLSearchParams();
  params.set("scope", state.hermesFilters.scope || "total");
  if (state.hermesFilters.model) {
    params.set("model", state.hermesFilters.model);
  }
  if (state.hermesFilters.sessionId) {
    params.set("sessionId", state.hermesFilters.sessionId);
  }

  try {
    const response = await fetch(`/api/hermes-usage?${params.toString()}`);
    state.hermesUsage = await response.json();

    if (state.hermesUsage?.selected) {
      state.hermesFilters = {
        scope: state.hermesUsage.selected.scope || "total",
        model: state.hermesUsage.selected.model || "",
        sessionId: state.hermesUsage.selected.sessionId || "",
      };
    }

    renderHermesUsage();
  } catch {
    state.hermesUsage = {
      available: false,
      error: "暂时无法读取 Hermes 用量数据。",
      modelOptions: [],
      sessionOptions: [],
      focus: null,
    };
    renderHermesUsage();
  }
}

function startStatusPolling() {
  window.setInterval(async () => {
    if (document.hidden) {
      return;
    }
    try {
      await loadStatus();
      await loadHermesUsage();
    } catch {
      // Keep the current UI state if a background refresh fails.
    }
  }, 3000);
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
    state.isEditingSettings = false;
    await loadStatus({ forceHydrate: true });

    if (showToast) {
      const promptStatus = result.config.enabled ? "工作弹窗已启用" : "工作弹窗已暂停";
      const readingGuardStatus = result.config.readingGuard?.enabled ? "读书拦截已启用" : "读书拦截已暂停";
      showToastMessage(`设置已保存，${promptStatus}，${readingGuardStatus}`);
    }
  } catch {
    showToastMessage("保存失败，请再试一次");
  } finally {
    setSavingState(false);
  }
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
  state.suppressDirtyTracking = true;
  els.enabled.value = String(config.enabled);
  els.scheduleMode.value = config.scheduleMode;
  els.minuteOfHour.value = config.minuteOfHour;
  els.intervalMinutes.value = config.intervalMinutes;
  els.activeStart.value = config.activeStart;
  els.activeEnd.value = config.activeEnd;
  els.title.value = config.title;
  els.promptText.value = config.promptText;
  const readingGuard = config.readingGuard || {};
  const aiClassification = config.aiClassification || {};
  els.readingGuardEnabled.value = String(Boolean(readingGuard.enabled));
  els.readingTargetMinutes.value = String(Math.max(1, Math.floor((readingGuard.dailyReadingTargetSeconds || 1800) / 60)));
  els.readingWhitelist.value = (readingGuard.whitelist || []).join("\n");
  els.readingBlacklist.value = (readingGuard.blacklist || []).join("\n");
  els.aiBaseURL.value = aiClassification.baseURL || "https://api.openai.com/v1";
  els.aiModel.value = aiClassification.model || "gpt-5.2";
  els.aiApiKey.value = aiClassification.apiKey || "";
  toggleScheduleFields();
  state.suppressDirtyTracking = false;
}

function readSettingsFromForm() {
  const blacklist = parseMultilineList(els.readingBlacklist.value);
  return {
    enabled: els.enabled.value === "true",
    scheduleMode: els.scheduleMode.value,
    minuteOfHour: Number(els.minuteOfHour.value || 0),
    intervalMinutes: Number(els.intervalMinutes.value || 60),
    activeStart: els.activeStart.value || "09:00",
    activeEnd: els.activeEnd.value || "18:00",
    title: els.title.value.trim() || "行为引擎",
    promptText: els.promptText.value.trim() || "请记录刚才这一小时你做了什么：",
    readingGuard: {
      enabled: els.readingGuardEnabled.value === "true",
      dailyReadingTargetSeconds: Math.max(60, Number(els.readingTargetMinutes.value || 30) * 60),
      whitelist: parseMultilineList(els.readingWhitelist.value),
      blacklist,
      blacklistLimits: readBlacklistLimitsFromDom(blacklist, state.status?.config?.readingGuard?.blacklistLimits || {}),
    },
    aiClassification: {
      baseURL: els.aiBaseURL.value.trim() || "https://api.openai.com/v1",
      model: els.aiModel.value.trim() || "gpt-5.2",
      apiKey: els.aiApiKey.value.trim(),
    },
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
  const readingGuardState = state.status.readingGuardState || {};
  const readingGuardConfig = getReadingGuardConfigForRender(config.readingGuard || {});
  const readingTargetSeconds = Number(readingGuardConfig.dailyReadingTargetSeconds || 1800);
  const readingProgress = `${formatReadingDuration(readingGuardState.readingSeconds || 0)} / ${formatReadingDuration(readingTargetSeconds)}`;
  const frontmostBundleID = readingGuardState.currentFrontmostBundleID || "";
  const frontmostExecutable = readingGuardState.currentFrontmostExecutable || "";
  const lastObservedApp = readingGuardState.lastObservedApp || "";
  const lastObservedBundleID = readingGuardState.lastObservedBundleID || "";

  els.monitorStatus.textContent = config.enabled && promptAgentRunning ? "后台监督中" : "已暂停";
  els.nextReminder.textContent = state.status.nextDueAt ? formatDateTime(state.status.nextDueAt) : "未安排";
  els.todayCount.textContent = String(summary.todayCount);
  els.totalCount.textContent = String(summary.totalCount);
  els.lastEntryTime.textContent = runtimeState.lastPromptAt ? formatDateTime(runtimeState.lastPromptAt) : "暂无";
  els.lastEntryPreview.textContent = runtimeState.lastEntryPreview || "暂无记录";
  els.readingToday.textContent = readingGuardConfig.enabled ? readingProgress : "守护已暂停";
  els.currentFrontmostApp.textContent = readingGuardConfig.enabled ? (readingGuardState.currentFrontmostApp || "暂无") : "守护已暂停";
  els.currentFrontmostDetail.textContent = readingGuardConfig.enabled
    ? [frontmostBundleID, frontmostExecutable].filter(Boolean).join(" · ") || "可把这里显示的名字加入白名单或黑名单"
    : "启用后会显示识别到的 App 名称";
  els.lastObservedApp.textContent = readingGuardConfig.enabled ? (lastObservedApp || "暂无") : "守护已暂停";
  els.lastObservedDetail.textContent = readingGuardConfig.enabled
    ? lastObservedBundleID || "切回控制台后这里会保留刚才识别到的 App"
    : "启用后这里会保留最近识别到的外部 App";
  els.lastBlockedApp.textContent = formatLastBlockedText(readingGuardState);

  renderBlacklistUsagePanels(readingGuardConfig, readingGuardState);
  renderHistory();
  renderHermesUsage();
}

function setSavingState(saving) {
  els.enabled.disabled = saving;
  els.readingGuardEnabled.disabled = saving;
}

function bindSettingsDraftTracking() {
  [
    els.enabled,
    els.scheduleMode,
    els.minuteOfHour,
    els.intervalMinutes,
    els.activeStart,
    els.activeEnd,
    els.title,
    els.promptText,
    els.readingGuardEnabled,
    els.readingTargetMinutes,
    els.readingWhitelist,
    els.readingBlacklist,
    els.aiBaseURL,
    els.aiModel,
    els.aiApiKey,
  ].forEach((element) => {
    if (!element) {
      return;
    }

    const markDirty = () => {
      if (!state.suppressDirtyTracking) {
        state.isEditingSettings = true;
        scheduleAutosave();
      }
    };

    element.addEventListener("input", markDirty);
    element.addEventListener("change", markDirty);
  });
}

function handleReadingBlacklistDraftChange() {
  if (!state.suppressDirtyTracking) {
    renderBlacklistUsagePanels(getReadingGuardConfigForRender(state.status?.config?.readingGuard || {}), state.status?.readingGuardState || {});
  }
}

function handleBlacklistLimitDraftInput(event) {
  if (!event.target.matches("[data-blacklist-limit]")) {
    return;
  }

  if (!state.suppressDirtyTracking) {
    state.isEditingSettings = true;
    scheduleAutosave();
  }

  updateBlacklistUsageCard(event.target.closest(".blacklist-usage-card"), Number(event.target.value || 0));
}

function scheduleAutosave() {
  if (state.autosaveTimer) {
    clearTimeout(state.autosaveTimer);
  }

  state.autosaveTimer = setTimeout(() => {
    state.autosaveTimer = null;
    if (!state.isEditingSettings) {
      return;
    }
    void saveSettingsInternal({ showToast: true });
  }, 500);
}

async function handleAnalyticsDateChange() {
  await loadAnalytics();
}

async function classifySelectedDay() {
  await runAnalyticsAction("/api/analytics/classify-day", "day");
}

async function classifySelectedWeek() {
  await runAnalyticsAction("/api/analytics/classify-week", "week");
}

async function handleHermesScopeChange() {
  state.hermesFilters.scope = els.hermesScopeSelect.value || "total";
  if (state.hermesFilters.scope !== "session") {
    state.hermesFilters.sessionId = "";
  }
  await loadHermesUsage();
}

async function handleHermesModelChange() {
  state.hermesFilters.model = els.hermesModelSelect.value || "";
  state.hermesFilters.sessionId = "";
  await loadHermesUsage();
}

async function handleHermesSessionChange() {
  state.hermesFilters.sessionId = els.hermesSessionSelect.value || "";
  await loadHermesUsage();
}

async function runAnalyticsAction(path, mode) {
  const selectedDate = els.analyticsDate.value || new Date().toISOString().slice(0, 10);
  setAnalyticsBusy(mode, true);
  els.analyticsStatus.textContent = mode === "day" ? "正在分析当天记录..." : "正在分析本周记录...";

  try {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ date: selectedDate }),
    });
    const result = await response.json();
    if (!response.ok || result.ok === false) {
      throw new Error(result.error || "分析失败");
    }

    if (result.day) {
      state.analyticsDay = result.day;
    }
    if (result.week) {
      state.analyticsWeek = result.week;
    }

    if (mode === "day") {
      await loadAnalytics();
      showToastMessage("当天记录已完成 AI 分类");
    } else {
      await loadAnalytics();
      showToastMessage("本周记录已完成 AI 分类");
    }
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "分析失败，请再试一次";
    const message = prettifyAnalyticsError(rawMessage);
    els.analyticsStatus.textContent = message;
    showToastMessage(message);
  } finally {
    setAnalyticsBusy(mode, false);
  }
}

function setAnalyticsBusy(mode, busy) {
  if (mode === "day") {
    els.analyzeDayButton.disabled = busy;
    els.analyzeDayButton.textContent = busy ? "分析中..." : "分析当天";
    return;
  }
  els.analyzeWeekButton.disabled = busy;
  els.analyzeWeekButton.textContent = busy ? "分析中..." : "分析本周";
}

function renderAnalytics() {
  renderDailyAnalytics();
  renderWeeklyAnalytics();
}

function renderDailyAnalytics() {
  const day = state.analyticsDay;
  if (!day || !Array.isArray(day.cells)) {
    els.dailySummary.textContent = "尚未分析";
    els.dailyGrid.innerHTML = '<div class="empty-state">还没有当天的分类结果。</div>';
    return;
  }

  els.dailySummary.textContent = formatAnalyticsSummary(day.summary, day.date);
  els.analyticsStatus.textContent = day.classifiedAt
    ? `${day.date} 的分类结果已更新于 ${formatDateTime(day.classifiedAt)}`
    : `${day.date} 还没有 AI 分类结果，可以点击“分析当天”。`;

  els.dailyGrid.innerHTML = day.cells
    .map(
      (cell) => `
        <div class="hour-cell ${categoryClass(cell.category)}" title="${escapeHtml(cell.title || "")}">
          <span class="hour-label">${cell.label}</span>
          <span class="hour-category">${cell.category}</span>
        </div>
      `,
    )
    .join("");
}

function renderWeeklyAnalytics() {
  const week = state.analyticsWeek;
  if (!week || !Array.isArray(week.days)) {
    els.weeklySummary.textContent = "尚未分析";
    els.weeklyGrid.innerHTML = '<div class="empty-state">还没有本周的分类结果。</div>';
    return;
  }

  els.weeklySummary.textContent = `${week.startDate} - ${week.endDate}`;
  els.weeklyGrid.innerHTML = week.days
    .map(
      (day) => `
        <div class="week-row">
          <div class="week-label">
            <strong>${day.date.slice(5)}</strong>
            <span>${compactSummary(day.summary)}</span>
          </div>
          <div class="week-cells">
            ${day.cells
              .map(
                (cell) => `
                  <div class="week-cell ${categoryClass(cell.category)}" title="${escapeHtml(`${day.date} ${cell.title || ""}`)}"></div>
                `,
              )
              .join("")}
          </div>
        </div>
      `,
    )
    .join("");
}

function categoryClass(category) {
  if (category === "学习") {
    return "cat-study";
  }
  if (category === "工作") {
    return "cat-work";
  }
  if (category === "娱乐") {
    return "cat-fun";
  }
  return "cat-empty";
}

function formatAnalyticsSummary(summary, dateLabel) {
  const safe = summary || {};
  return `${dateLabel} · 学习 ${safe["学习"] || 0}h · 工作 ${safe["工作"] || 0}h · 娱乐 ${safe["娱乐"] || 0}h · 空白 ${safe["空白"] || 0}h`;
}

function compactSummary(summary) {
  const safe = summary || {};
  return `学 ${safe["学习"] || 0} · 工 ${safe["工作"] || 0} · 娱 ${safe["娱乐"] || 0}`;
}

function prettifyAnalyticsError(message) {
  if (message.includes("HTTP 405")) {
    return "当前服务商不支持 Responses 接口，程序已尝试兼容模式。如果仍失败，请检查 Base URL 是否填写为完整兼容地址。";
  }
  if (message.includes("HTTP 401")) {
    return "API Key 无效或已过期，请检查模型平台的密钥配置。";
  }
  if (message.includes("HTTP 429")) {
    return "请求过多或账户额度不足，请稍后重试，或检查服务商余额与限流设置。";
  }
  if (message.includes("open.bigmodel.cn")) {
    return "智谱接口请求失败，请确认 Base URL 使用 https://open.bigmodel.cn/api/paas/v4";
  }
  return message;
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

function renderHermesUsage() {
  if (!els.hermesUsageBoard || !els.hermesUsageStatus) {
    return;
  }

  const hermesUsage = state.hermesUsage || state.status?.hermesUsage;
  syncHermesFilters(hermesUsage);

  if (!hermesUsage) {
    els.hermesUsageStatus.textContent = "暂时拿不到 Hermes 数据。";
    els.hermesUsageBoard.innerHTML = '<div class="empty-state">暂时无法读取 Hermes 状态库。</div>';
    return;
  }

  if (!hermesUsage.available || !hermesUsage.focus) {
    els.hermesUsageStatus.textContent = hermesUsage.error || "还没有检测到 Hermes 会话。";
    els.hermesUsageBoard.innerHTML = `<div class="empty-state">${escapeHtml(hermesUsage.error || "Hermes 还没有产生可读取的会话记录。")}</div>`;
    return;
  }

  const focus = hermesUsage.focus;
  const latestSession = hermesUsage.latestSession;
  const activeSession = hermesUsage.activeSession;
  const statusPrefix = focus.type === "session" ? "当前查看单会话" : "当前查看总消耗";
  els.hermesUsageStatus.textContent = `${statusPrefix} · ${focus.title || "Hermes 用量"} · ${hermesUsage.updatedAt ? formatDateTime(hermesUsage.updatedAt) : "刚刚更新"}`;

  els.hermesUsageBoard.innerHTML = `
    <section class="hermes-usage-section">
      <div class="analytics-section-head">
        <h3>${escapeHtml(focus.type === "session" ? "选中会话" : "筛选结果")}</h3>
        <span class="analytics-summary">${escapeHtml(focus.description || "暂无说明")}</span>
      </div>
      <div class="hermes-metric-grid">
        ${renderHermesMetricCard("模型", focus.model || "全部模型", focus.type === "session" ? (focus.source || "session") : `${formatNumber(focus.sessionCount || 0)} 个会话`)}
        ${renderHermesMetricCard("输入 Token", formatNumber(focus.inputTokens), "prompt / input")}
        ${renderHermesMetricCard("输出 Token", formatNumber(focus.outputTokens), "completion / output")}
        ${renderHermesMetricCard("总 Token", formatNumber(focus.totalTokens), "input + output")}
        ${renderHermesMetricCard("花费", formatUsdCost(focus.displayCostUsd, focus.costStatus), formatHermesCostCaption(focus))}
        ${renderHermesMetricCard("计费状态", formatHermesCostStatus(focus.costStatus), focus.billingMode || (focus.type === "total" ? "aggregate" : "billing unknown"))}
      </div>
      <div class="hermes-detail-grid">
        <div class="recent-card compact-card">
          <span class="recent-label">${focus.type === "session" ? "会话时间" : "覆盖时间"}</span>
          <strong>${focus.startedAt ? formatDateTime(focus.startedAt) : "暂无"}</strong>
          <span class="recent-note">${focus.type === "session" ? (focus.isActive ? "会话进行中" : focus.endedAt ? `结束于 ${formatDateTime(focus.endedAt)}` : "等待下一次更新") : (focus.endedAt ? `最近一条会话开始于 ${formatDateTime(focus.endedAt)}` : "当前筛选下暂无更多时间信息")}</span>
        </div>
        <div class="recent-card compact-card">
          <span class="recent-label">${focus.type === "session" ? "Provider / Base URL" : "筛选条件"}</span>
          <strong>${focus.type === "session" ? (focus.billingProvider || "未知") : (focus.model || "全部模型")}</strong>
          <span class="recent-note">${escapeHtml(focus.type === "session" ? (focus.billingBaseURL || "未记录 Base URL") : (state.hermesFilters.scope === "session" ? "当前处于单会话模式" : "当前处于总消耗模式"))}</span>
        </div>
      </div>
    </section>
    <section class="hermes-usage-section">
      <div class="analytics-section-head">
        <h3>辅助参考</h3>
        <span class="analytics-summary">方便你在不同模型和不同会话之间切换对比</span>
      </div>
      <div class="hermes-detail-grid">
        ${renderHermesReferenceCard("最新会话", latestSession)}
        ${renderHermesReferenceCard("当前活跃会话", activeSession)}
      </div>
    </section>
  `;
}

function renderHermesMetricCard(label, value, note) {
  return `
    <article class="metric-card hermes-metric-card">
      <span class="metric-label">${escapeHtml(label)}</span>
      <strong class="metric-value hermes-metric-value">${escapeHtml(value)}</strong>
      <span class="metric-footnote">${escapeHtml(note)}</span>
    </article>
  `;
}

function renderHermesReferenceCard(label, session) {
  if (!session) {
    return `
      <div class="recent-card compact-card">
        <span class="recent-label">${escapeHtml(label)}</span>
        <strong>暂无</strong>
        <span class="recent-note">当前筛选下还没有可展示的 Hermes 会话。</span>
      </div>
    `;
  }

  return `
    <div class="recent-card compact-card">
      <span class="recent-label">${escapeHtml(label)}</span>
      <strong>${escapeHtml(session.model || "未记录模型")}</strong>
      <span class="recent-note">${escapeHtml(`${session.startedAt ? formatDateTime(session.startedAt) : "未知时间"} · ${formatNumber(session.totalTokens)} tokens`)}</span>
    </div>
  `;
}

function syncHermesFilters(hermesUsage) {
  if (!els.hermesScopeSelect || !els.hermesModelSelect || !els.hermesSessionSelect) {
    return;
  }

  const selected = hermesUsage?.selected || state.hermesFilters;
  els.hermesScopeSelect.value = selected.scope || "total";

  const modelOptions = Array.isArray(hermesUsage?.modelOptions) ? hermesUsage.modelOptions : [{ value: "", label: "全部模型" }];
  els.hermesModelSelect.innerHTML = modelOptions
    .map((option) => `<option value="${escapeHtml(option.value || "")}">${escapeHtml(formatHermesModelOptionLabel(option))}</option>`)
    .join("");
  els.hermesModelSelect.value = selected.model || "";

  const sessionOptions = Array.isArray(hermesUsage?.sessionOptions) ? hermesUsage.sessionOptions : [];
  els.hermesSessionSelect.innerHTML = [
    '<option value="">自动选择最近会话</option>',
    ...sessionOptions.map((option) => `<option value="${escapeHtml(option.value || "")}">${escapeHtml(option.label || option.value || "")}</option>`),
  ].join("");
  els.hermesSessionSelect.value = selected.sessionId || "";
  els.hermesSessionSelect.disabled = (selected.scope || "total") !== "session";
}

function formatHermesModelOptionLabel(option) {
  const count = Number(option?.sessionCount || 0);
  return `${option?.label || "全部模型"} (${count})`;
}

function getReadingGuardConfigForRender(savedConfig) {
  if (!state.isEditingSettings) {
    return savedConfig;
  }

  const blacklist = parseMultilineList(els.readingBlacklist.value);
  return {
    ...savedConfig,
    enabled: els.readingGuardEnabled.value === "true",
    dailyReadingTargetSeconds: Math.max(60, Number(els.readingTargetMinutes.value || 30) * 60),
    whitelist: parseMultilineList(els.readingWhitelist.value),
    blacklist,
    blacklistLimits: readBlacklistLimitsFromDom(blacklist, savedConfig.blacklistLimits || {}),
  };
}

function renderBlacklistUsagePanels(readingGuardConfig, readingGuardState) {
  if (!els.blacklistUsageList) {
    return;
  }

  const activeElement = document.activeElement;
  if (state.isEditingSettings && activeElement && els.blacklistUsageList.contains(activeElement)) {
    return;
  }

  const blacklist = Array.isArray(readingGuardConfig.blacklist) ? readingGuardConfig.blacklist : [];
  const limits = readingGuardConfig.blacklistLimits || {};
  const usageMap = readingGuardState.blacklistUsageSeconds || {};

  if (blacklist.length === 0) {
    els.blacklistUsageList.innerHTML = '<div class="empty-state">添加黑名单 App 后，这里会按数量自动出现每日使用时长窗口。</div>';
    return;
  }

  els.blacklistUsageList.innerHTML = blacklist
    .map((appName) => {
      const usedSeconds = Math.max(0, Number(usageMap[appName] || 0));
      const limitSeconds = normalizeBlacklistLimitSeconds(limits[appName]);
      const limitMinutes = Math.max(1, Math.floor(limitSeconds / 60));
      const isBlocked = usedSeconds >= limitSeconds;
      const remainingSeconds = Math.max(0, limitSeconds - usedSeconds);

      return `
        <article class="blacklist-usage-card" data-blacklist-card="${escapeHtml(appName)}" data-used-seconds="${usedSeconds}">
          <div class="blacklist-usage-head">
            <div>
              <span class="recent-label">黑名单 App</span>
              <strong>${escapeHtml(appName)}</strong>
            </div>
            <span class="blacklist-usage-badge ${isBlocked ? "blocked" : "available"}">${isBlocked ? "今日已拦截" : "今日可用"}</span>
          </div>
          <div class="blacklist-usage-metrics">
            <div class="blacklist-usage-metric">
              <span class="recent-label">今日使用</span>
              <strong>${formatReadingDuration(usedSeconds)}</strong>
            </div>
            <div class="blacklist-usage-metric">
              <span class="recent-label">每日上限（分钟）</span>
              <input
                type="number"
                min="1"
                max="1440"
                step="1"
                value="${limitMinutes}"
                data-blacklist-limit
                data-blacklist-app="${escapeHtml(appName)}"
              />
            </div>
          </div>
          <p class="blacklist-usage-note">
            <span class="blacklist-limit-preview">${formatReadingDuration(limitSeconds)}</span>
            <span class="blacklist-limit-status">${isBlocked ? "今日已达到上限，重新打开会自动拦截。" : `剩余 ${formatReadingDuration(remainingSeconds)}。`}</span>
          </p>
        </article>
      `;
    })
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

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Math.max(0, Number(value || 0)));
}

function formatUsdCost(value, status) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) {
    return "待计算";
  }
  if (amount <= 0 && status === "unknown") {
    return "待计算";
  }
  return `US$${amount.toFixed(amount >= 1 ? 4 : 6)}`;
}

function formatHermesCostStatus(status) {
  if (status === "actual") {
    return "实际计费";
  }
  if (status === "estimated") {
    return "预估计费";
  }
  if (status === "included") {
    return "已包含";
  }
  return "待定价";
}

function formatHermesCostCaption(current) {
  if (current.type === "total") {
    return `${formatNumber(current.sessionCount || 0)} 个会话汇总`;
  }
  if (current.actualCostUsd !== null) {
    return "provider actual";
  }
  if (Number(current.estimatedCostUsd || 0) > 0) {
    return "estimated by Hermes";
  }
  return "仅拿到 usage，尚无价格";
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
    "# 行为引擎（Behavior Engine）导出",
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

function parseMultilineList(text) {
  return text
    .replaceAll(",", "\n")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readBlacklistLimitsFromDom(blacklist, fallbackLimits) {
  const normalizedFallback = fallbackLimits && typeof fallbackLimits === "object" ? fallbackLimits : {};
  return blacklist.reduce((result, appName) => {
    const input = els.blacklistUsageList?.querySelector(`[data-blacklist-app="${cssEscape(appName)}"]`);
    const candidateMinutes = Number(input?.value ?? normalizedFallback[appName] / 60);
    const safeMinutes = Number.isFinite(candidateMinutes) ? candidateMinutes : 60;
    result[appName] = normalizeBlacklistLimitSeconds(safeMinutes * 60);
    return result;
  }, {});
}

function formatReadingDuration(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(total / 60);
  const restSeconds = total % 60;
  return `${minutes} 分 ${restSeconds} 秒`;
}

function normalizeBlacklistLimitSeconds(value) {
  const parsed = Math.floor(Number(value || DEFAULT_BLACKLIST_LIMIT_SECONDS));
  if (!Number.isFinite(parsed)) {
    return DEFAULT_BLACKLIST_LIMIT_SECONDS;
  }
  return Math.max(60, Math.min(24 * 60 * 60, parsed));
}

function formatLastBlockedText(readingGuardState) {
  const appName = readingGuardState.lastBlockedApp || "";
  if (!appName) {
    return "暂无";
  }

  if (readingGuardState.lastBlockedReason === "daily_limit") {
    return `${appName} · 今日时长已达上限`;
  }
  if (readingGuardState.lastBlockedReason === "reading_target") {
    return `${appName} · 阅读未达标`;
  }
  return appName;
}

function updateBlacklistUsageCard(card, limitMinutes) {
  if (!card) {
    return;
  }

  const usedSeconds = Math.max(0, Number(card.dataset.usedSeconds || 0));
  const normalizedLimitSeconds = normalizeBlacklistLimitSeconds(Math.max(1, Number(limitMinutes || 1)) * 60);
  const remainingSeconds = Math.max(0, normalizedLimitSeconds - usedSeconds);
  const blocked = usedSeconds >= normalizedLimitSeconds;
  const badge = card.querySelector(".blacklist-usage-badge");
  const preview = card.querySelector(".blacklist-limit-preview");
  const status = card.querySelector(".blacklist-limit-status");

  if (badge) {
    badge.textContent = blocked ? "今日已拦截" : "今日可用";
    badge.classList.toggle("blocked", blocked);
    badge.classList.toggle("available", !blocked);
  }
  if (preview) {
    preview.textContent = formatReadingDuration(normalizedLimitSeconds);
  }
  if (status) {
    status.textContent = blocked ? "今日已达到上限，重新打开会自动拦截。" : `剩余 ${formatReadingDuration(remainingSeconds)}。`;
  }
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
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

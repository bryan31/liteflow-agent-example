const state = {
    sessions: [], skills: [], activeSessionId: null, activeSession: null,
    busy: false, followOutput: true, search: "", toastTimer: null,
    sandboxRequest: null, sandboxTimer: null,
    sessionRequest: null, sessionLoading: false, sessionLoadError: false,
};
const els = Object.fromEntries(Object.entries({
    sessions: "#sessions", skills: "#skills", newSession: "#new-session", messages: "#messages",
    title: "#chat-title", meta: "#chat-meta", statusDot: "#status-dot", statusText: "#status-text",
    form: "#composer", prompt: "#prompt", send: "#send-button", help: "#composer-help",
    search: "#session-search", theme: "#theme-toggle", jump: "#jump-to-latest", toast: "#toast",
    skillCount: "#skill-count", composerSkill: "#composer-skill",
    sandboxPanel: "#sandbox-panel", sandboxLabel: "#sandbox-label", sandboxRefresh: "#sandbox-refresh",
    sandboxDescription: "#sandbox-description", sandboxId: "#sandbox-id", sandboxName: "#sandbox-name",
    sandboxImage: "#sandbox-image", sandboxActivity: "#sandbox-activity",
    sandboxActiveAt: "#sandbox-active-at", sandboxCheckedAt: "#sandbox-checked-at",
}).map(([key, selector]) => [key, document.querySelector(selector)]));

async function api(path, options = {}) {
    const response = await fetch(path, { ...options,
        headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch (_) { body = null; }
    if (!response.ok) throw new Error(body?.message || `请求失败（${response.status}）`);
    return body;
}

async function init() {
    initAppearance();
    bindEvents();
    setBusy(true);
    try {
        await Promise.all([loadSkills(), loadSessions()]);
        const remembered = localStorage.getItem("liteflow.activeSessionId");
        state.activeSessionId = state.sessions.find(session => session.id === remembered)?.id || state.sessions[0]?.id;
        if (!state.activeSessionId) {
            const session = await api("/api/chat/sessions", { method: "POST", body: JSON.stringify({ title: "新会话" }) });
            state.activeSessionId = session.id;
            await loadSessions();
        }
        await loadActiveSession();
    } finally { setBusy(false); }
}

function initAppearance() {
    const remembered = localStorage.getItem("liteflow.theme");
    setTheme(remembered || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
    document.querySelector("#open-sidebar").addEventListener("click", () => toggleSidebar(true));
    document.querySelector("#close-sidebar").addEventListener("click", () => toggleSidebar(false));
    document.querySelector("#sidebar-backdrop").addEventListener("click", () => toggleSidebar(false));
    els.theme.addEventListener("click", () => {
        const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        localStorage.setItem("liteflow.theme", theme);
        setTheme(theme);
    });
}

function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    els.theme.setAttribute("aria-label", theme === "dark" ? "切换浅色外观" : "切换深色外观");
}

function toggleSidebar(open) {
    document.body.classList.toggle("sidebar-collapsed", !open);
    document.body.classList.toggle("sidebar-open", open);
}

function bindEvents() {
    els.sandboxRefresh.addEventListener("click", () => void refreshSandboxStatus());
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) void refreshSandboxStatus();
    });
    document.addEventListener("click", event => {
        if (!els.sandboxPanel.contains(event.target)) els.sandboxPanel.open = false;
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") els.sandboxPanel.open = false;
    });
    els.newSession.addEventListener("click", () => newSession().catch(showError));
    els.title.addEventListener("click", () => void copySessionId());
    els.form.addEventListener("submit", event => { event.preventDefault(); void sendPrompt(); });
    els.prompt.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
            event.preventDefault();
            els.form.requestSubmit();
        }
    });
    els.prompt.addEventListener("input", autosizePrompt);
    els.search.addEventListener("input", () => { state.search = els.search.value.trim().toLowerCase(); renderSessions(); });
    els.messages.addEventListener("scroll", () => {
        state.followOutput = els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < 90;
        els.jump.hidden = state.followOutput;
    }, { passive: true });
    els.messages.addEventListener("click", event => {
        if (event.target.closest("[data-retry-session]")) void loadActiveSession();
    });
    els.jump.addEventListener("click", () => { state.followOutput = true; scrollToBottom(); });
}

async function copySessionId() {
    const sessionId = state.activeSessionId;
    if (!sessionId) return;
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(sessionId);
        } else {
            const input = document.createElement("textarea");
            const focused = document.activeElement;
            input.value = sessionId;
            input.readOnly = true;
            input.style.cssText = "position: fixed; left: -9999px; top: 0;";
            document.body.appendChild(input);
            try {
                input.select();
                if (!document.execCommand("copy")) throw new Error("Copy failed");
            } finally {
                input.remove();
                focused?.focus({ preventScroll: true });
            }
        }
        toast("会话 ID 已复制");
    } catch (_) {
        toast(`复制失败，会话 ID：${sessionId}`);
    }
}

async function newSession() {
    if (state.busy) return;
    const session = await api("/api/chat/sessions", { method: "POST", body: JSON.stringify({ title: "新会话" }) });
    state.activeSessionId = session.id;
    await loadSessions();
    await loadActiveSession();
    if (matchMedia("(max-width: 760px)").matches) toggleSidebar(false);
    els.prompt.focus();
}

async function loadSessions() { state.sessions = await api("/api/chat/sessions"); renderSessions(); }
async function loadSkills() { state.skills = await api("/api/skills"); renderSkills(); }
async function loadActiveSession() {
    const sessionId = state.activeSessionId;
    state.sessionRequest?.abort();
    const controller = new AbortController();
    state.sessionRequest = controller;
    state.sessionLoading = true;
    state.sessionLoadError = false;
    state.activeSession = null;
    state.followOutput = true;
    localStorage.setItem("liteflow.activeSessionId", sessionId);
    renderSessions(); renderMessages(); renderSkills(); updateSessionHeader(); updateComposerState();
    els.messages.scrollTop = 0;
    els.jump.hidden = true;
    state.sandboxRequest?.abort();
    state.sandboxRequest = null;
    renderSandboxStatus(null);
    void refreshSandboxStatus();
    const isCurrent = () => state.sessionRequest === controller && sessionId === state.activeSessionId;
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
        const session = await api(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, { signal: controller.signal });
        if (!isCurrent()) return;
        state.activeSession = session;
    } catch (error) {
        if (!isCurrent()) return;
        state.sessionLoadError = true;
    } finally {
        clearTimeout(timeout);
        if (isCurrent()) {
            state.sessionRequest = null;
            state.sessionLoading = false;
            renderMessages(); renderSkills(); updateSessionHeader(); updateComposerState();
        }
    }
}

function updateSessionHeader() {
    const summary = state.sessions.find(session => session.id === state.activeSessionId);
    els.title.textContent = state.activeSession?.title || summary?.title || "新会话";
    els.title.disabled = !state.activeSessionId;
    els.title.title = state.activeSessionId ? `点击复制会话 ID：${state.activeSessionId}` : "暂无可复制的会话 ID";
    els.title.setAttribute("aria-label", `${els.title.textContent}，复制会话 ID`);
    document.title = `${els.title.textContent} · LiteFlow Agent`;
    const count = state.activeSession?.messages.filter(message => message.stage !== "trace").length || 0;
    els.meta.textContent = state.sessionLoading ? "正在加载会话…"
        : state.sessionLoadError ? "会话加载失败" : count ? `${count} 条消息` : "LiteFlow · AgentScope";
}

async function refreshSandboxStatus() {
    const sessionId = state.activeSessionId;
    if (!sessionId || state.sandboxRequest) return;
    clearTimeout(state.sandboxTimer);
    if (document.hidden) {
        state.sandboxTimer = setTimeout(refreshSandboxStatus, 10000);
        return;
    }
    const controller = new AbortController();
    state.sandboxRequest = controller;
    els.sandboxRefresh.disabled = true;
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
        const snapshot = await api(`/api/chat/sessions/${encodeURIComponent(sessionId)}/sandbox`, { signal: controller.signal });
        if (sessionId === state.activeSessionId && state.sandboxRequest === controller) renderSandboxStatus(snapshot);
    } catch (error) {
        if (sessionId === state.activeSessionId && state.sandboxRequest === controller) {
            renderSandboxStatus({ state: "UNKNOWN", message: "查询失败", checkedAt: null });
        }
    } finally {
        clearTimeout(timeout);
        if (state.sandboxRequest === controller) {
            state.sandboxRequest = null;
            els.sandboxRefresh.disabled = false;
            state.sandboxTimer = setTimeout(refreshSandboxStatus, state.busy ? 3000 : 10000);
        }
    }
}

function renderSandboxStatus(snapshot) {
    const labels = { NOT_ALLOCATED: "未分配", STARTING: "启动中", CREATED: "已创建", RUNNING: "运行中",
        STOPPED: "已停止", PAUSED: "已暂停", RESTARTING: "重启中", REMOVING: "回收中",
        DEAD: "异常", NOT_FOUND: "已移除", UNKNOWN: "状态未知" };
    const value = snapshot?.state || "loading";
    els.sandboxPanel.dataset.state = value;
    els.sandboxLabel.textContent = `容器 · ${snapshot ? (labels[value] || "状态未知") : "查询中"}`;
    els.sandboxDescription.textContent = !snapshot ? "正在查询容器状态…"
        : value === "NOT_ALLOCATED" ? "当前服务实例未分配容器。首次执行时创建，空闲回收后会在下次执行时恢复。"
        : value === "UNKNOWN" ? "暂时无法确认容器状态，请稍后刷新。"
        : value === "NOT_FOUND" ? "当前会话记录的容器已不存在，下次执行时将尝试恢复。"
        : value === "STARTING" ? "正在准备当前会话的执行环境。"
        : value === "RUNNING" ? (snapshot.busy ? "容器正在处理本次任务。" : "容器正在运行，等待下一次任务；空闲超时后自动回收。")
        : "当前服务实例查询到的 Docker 容器状态。";
    els.sandboxId.textContent = snapshot?.containerId || "—";
    els.sandboxName.textContent = snapshot?.containerName || "—";
    els.sandboxImage.textContent = snapshot?.image || "—";
    els.sandboxActivity.textContent = !snapshot || ["NOT_ALLOCATED", "UNKNOWN"].includes(value) ? "—"
        : snapshot.busy ? "执行中" : "空闲";
    const date = timestamp => timestamp ? new Date(timestamp).toLocaleString("zh-CN", { hour12: false }) : "—";
    els.sandboxActiveAt.textContent = date(snapshot?.lastActiveAt);
    els.sandboxCheckedAt.textContent = date(snapshot?.checkedAt);
}

function renderSessions() {
    els.sessions.innerHTML = "";
    const sessions = state.sessions.filter(session => session.title.toLowerCase().includes(state.search));
    if (!sessions.length) { els.sessions.innerHTML = '<div class="sidebar-empty">没有匹配的会话</div>'; return; }
    sessions.forEach(session => {
        const item = document.createElement("div");
        item.className = `session-item${session.id === state.activeSessionId ? " active" : ""}`;
        const button = document.createElement("button");
        button.type = "button"; button.className = "session-open"; button.textContent = session.title;
        button.title = session.title; button.disabled = state.busy;
        if (session.id === state.activeSessionId) button.setAttribute("aria-current", "page");
        button.addEventListener("click", () => {
            if (state.busy) return;
            state.activeSessionId = session.id;
            void loadActiveSession().catch(showError);
            if (matchMedia("(max-width: 760px)").matches) toggleSidebar(false);
        });
        const remove = document.createElement("button");
        remove.type = "button"; remove.className = "icon-button session-delete"; remove.disabled = state.busy;
        remove.innerHTML = '<span class="icon icon-trash" aria-hidden="true"></span>';
        remove.setAttribute("aria-label", `删除会话：${session.title}`); remove.title = "删除会话";
        remove.addEventListener("click", () => deleteSession(session.id).catch(showError));
        item.append(button, remove); els.sessions.appendChild(item);
    });
}

async function deleteSession(id) {
    if (state.busy) return;
    await api(`/api/chat/sessions/${id}`, { method: "DELETE" });
    await loadSessions();
    if (state.activeSessionId === id) {
        state.activeSessionId = state.sessions[0]?.id || null;
        if (!state.activeSessionId) { await newSession(); return; }
    }
    await loadActiveSession();
}

function renderSkills() {
    const loaded = new Set(state.activeSession?.loadedSkills || []);
    els.skills.innerHTML = "";
    els.skillCount.textContent = state.skills.length ? String(state.skills.length) : "";
    els.composerSkill.textContent = state.skills.length ? "技能自动选择" : "通用对话";
    if (!state.skills.length) { els.skills.innerHTML = '<div class="sidebar-empty">暂无可用技能</div>'; return; }
    state.skills.forEach(skill => {
        const details = document.createElement("details"); details.className = "skill-item";
        const summary = document.createElement("summary");
        const label = document.createElement("span"); label.className = "skill-name"; label.textContent = skill.name;
        const indicator = document.createElement("span"); indicator.className = "skill-indicator";
        if (loaded.has(skill.id) || loaded.has(skill.name)) { indicator.classList.add("used"); indicator.title = "本会话已使用"; }
        summary.append(indicator, label);
        const description = document.createElement("p"); description.textContent = skill.description || "已配置的 Agent 技能";
        const use = document.createElement("button"); use.type = "button"; use.className = "text-button"; use.textContent = "使用此技能";
        use.addEventListener("click", () => { els.prompt.value = `请使用 ${skill.name}，`; autosizePrompt(); els.prompt.focus(); });
        details.append(summary, description, use); els.skills.appendChild(details);
    });
}

function conversation() { return els.messages.querySelector(".conversation"); }
function renderMessages() {
    els.messages.setAttribute("aria-busy", String(state.sessionLoading));
    conversation().innerHTML = "";
    if (state.sessionLoading) {
        conversation().innerHTML = '<div class="session-loading"><div class="session-loading-label" role="status"><span class="session-spinner" aria-hidden="true"></span>正在加载会话…</div><div class="session-skeleton" aria-hidden="true"><div class="skeleton-question"></div><div class="skeleton-reply"><span></span><span></span><span></span></div><div class="skeleton-question short"></div><div class="skeleton-reply"><span></span><span></span></div></div></div>';
        return;
    }
    if (state.sessionLoadError) {
        conversation().innerHTML = '<div class="session-load-error"><p role="alert">会话加载失败</p><span>暂时无法获取消息，请重试。</span><button type="button" class="session-retry" data-retry-session>重新加载</button></div>';
        return;
    }
    const messages = state.activeSession?.messages || [];
    if (!messages.length) {
        conversation().innerHTML = '<div class="empty-state"><div class="empty-mark" aria-hidden="true">LF</div><h2>从一个问题开始</h2><p>直接提问，或描述你想完成的任务。</p><span>分析、操作与结果，在同一个对话中展开。</span></div>';
        return;
    }
    for (let index = 0; index < messages.length; index++) {
        const message = messages[index];
        if (message.stage === "trace") {
            let payload;
            try { payload = JSON.parse(message.content); } catch (_) { payload = { events: [], status: "已完成" }; }
            const reply = messages[index + 1]?.stage === "result" ? messages[++index].content : null;
            createTurnView(turnFromHistory(payload, reply), true);
        } else if (message.role === "user") {
            appendUserMessage(message.content);
        } else {
            const turn = createTurnState(); turn.status = "completed"; turn.finalText = message.content;
            createTurnView(turn, true);
        }
    }
    scrollToBottom();
}

function appendUserMessage(content) {
    clearEmptyState();
    const article = document.createElement("article"); article.className = "message user";
    article.setAttribute("aria-label", "你的消息"); article.textContent = content;
    conversation().appendChild(article);
}

async function sendPrompt() {
    if (state.busy || state.sessionLoading || state.sessionLoadError || !state.activeSessionId) return;
    const prompt = els.prompt.value.trim();
    if (!prompt) return;
    const sessionId = state.activeSessionId;
    setBusy(true); state.followOutput = true; els.prompt.value = ""; autosizePrompt();
    void refreshSandboxStatus();
    appendUserMessage(prompt);
    const turn = createTurnState();
    const view = createTurnView(turn);
    const renderer = createTurnRenderer(view);
    const timer = setInterval(() => renderTurnHeader(view), 1000);
    try {
        const response = await fetch(`/api/chat/sessions/${sessionId}/messages/stream`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: prompt }),
        });
        if (!response.ok || !response.body) throw new Error(`请求失败（${response.status}）`);
        await readSse(response.body, event => { applyTurnEvent(turn, event); renderer.schedule(); });
        // Refresh metadata without replacing the live DOM or the user's expanded tool details.
        try {
            await loadSessions();
            state.activeSession = await api(`/api/chat/sessions/${sessionId}`);
            updateSessionHeader(); renderSkills();
        } catch (error) { toast(`会话列表暂未更新：${error.message}`); }
    } catch (error) {
        applyTurnEvent(turn, { name: "error", data: { message: error.message } }); renderer.flush();
    } finally {
        renderer.flush(); clearInterval(timer); setBusy(false);
        void refreshSandboxStatus();
    }
}

// Coalesce token bursts without delaying the terminal state, even in background tabs.
function createTurnRenderer(view) {
    let timer = null;
    const flush = () => {
        if (timer != null) clearTimeout(timer);
        timer = null;
        renderTurn(view);
    };
    return { flush, schedule() {
        if (view.turn.status !== "working") flush();
        else if (timer == null) timer = setTimeout(flush, 80);
    } };
}

function createTurnView(turn, history = false) {
    clearEmptyState();
    const article = document.createElement("article"); article.className = "assistant-turn";
    article.innerHTML = '<div class="activity"><button class="activity-toggle" type="button" aria-expanded="false"><span class="chevron" aria-hidden="true"></span><span class="activity-status" aria-hidden="true"></span><span class="activity-label execution-label"><span class="execution-label-text"></span><span class="execution-label-sweep" aria-hidden="true"><span class="execution-label-copy"></span></span></span><span class="activity-preview"></span><span class="activity-meta"></span></button><div class="activity-body" hidden></div></div><div class="final-answer markdown" hidden></div><div class="turn-error" role="alert" hidden></div><div class="answer-actions" hidden><button class="icon-button copy-answer" type="button" aria-label="复制回答" title="复制回答"><span class="icon icon-copy" aria-hidden="true"></span></button></div>';
    const view = { turn, article, history, nodes: new Map(), collapsed: history, finalAnswerShown: false, activityOffset: null, openSteps: new Set(),
        activity: article.querySelector(".activity"), toggle: article.querySelector(".activity-toggle"),
        label: article.querySelector(".activity-label"), preview: article.querySelector(".activity-preview"), meta: article.querySelector(".activity-meta"), body: article.querySelector(".activity-body"),
        answer: article.querySelector(".final-answer"), error: article.querySelector(".turn-error"),
        actions: article.querySelector(".answer-actions") };
    view.pages = createActivityPages(view);
    view.answerOutput = createOutputView(view.answer, { markdown: true, fileName: "answer.md" });
    view.artifacts = document.createElement("div");
    view.artifacts.className = "artifact-list";
    view.artifacts.setAttribute("aria-label", "生成的文件");
    view.artifactNodes = new Map();
    article.insertBefore(view.artifacts, view.error);
    view.toggle.addEventListener("click", () => { view.collapsed = !view.collapsed; renderTurn(view, false); });
    article.querySelector(".copy-answer").addEventListener("click", () => {
        navigator.clipboard.writeText(turn.finalText || "").then(() => toast("回答已复制")).catch(() => toast("无法访问剪贴板，请选择文字复制"));
    });
    conversation().appendChild(article); renderTurn(view); return view;
}

function renderTurn(view, follow = true) {
    const { turn } = view;
    // Collapse once when the final answer arrives; subsequent toggles remain user-controlled.
    if (turn.finalText != null && !view.finalAnswerShown) {
        view.collapsed = true;
        view.finalAnswerShown = true;
    }
    if (!view.collapsed) renderActivity(view);
    if (turn.finalText != null) {
        view.answer.hidden = false;
        updateOutputView(view.answerOutput, turn.finalText);
    }
    for (const artifact of turn.artifacts.values()) {
        let link = view.artifactNodes.get(artifact.id);
        if (!link) {
            link = document.createElement("a"); link.className = "artifact-download";
            view.artifactNodes.set(artifact.id, link); view.artifacts.appendChild(link);
        }
        link.href = artifact.downloadUrl;
        link.download = artifact.fileName;
        link.textContent = `下载 ${artifact.fileName} · ${Math.max(1, Math.ceil(artifact.size / 1024))} KB`;
        link.title = artifact.description || artifact.fileName;
    }
    view.artifacts.hidden = turn.artifacts.size === 0;
    view.error.hidden = !turn.error; view.error.textContent = turn.error || "";
    view.actions.hidden = turn.status === "working" || !turn.finalText;
    renderTurnHeader(view);
    if (follow) scrollToBottom();
}

const ACTIVITY_PAGE_SIZE = 40;
function setText(element, text) {
    if (element.textContent !== text) element.textContent = text;
}

function setExecutionLabel(element, text, running) {
    if (element.dataset.text !== text) {
        element.dataset.text = text;
        setText(element.querySelector(".execution-label-text"), text);
        setText(element.querySelector(".execution-label-copy"), text);
    }
    element.classList.toggle("is-running", running);
}

function stepIsRunning(turn, step) {
    return turn.status === "working" && (step.kind === "tool"
        ? ["preparing", "running"].includes(step.status) : turn.activeStepKey === step.key && !step.promoted);
}

function currentStep(turn) {
    const step = turn.byKey.get(turn.activeStepKey);
    if (step && stepIsRunning(turn, step)) return step;
    const key = Array.from(turn.activeTools).at(-1);
    return key ? turn.byKey.get(key) : null;
}

function toolDisplayName(step) {
    return { execute: "运行命令", read_file: "读取文件", write_file: "写入文件", edit_file: "编辑文件",
        load_skill_through_path: "读取技能", deliver_artifact: "交付文件" }[step.name] || step.name;
}

function toolPreview(step) {
    // Cache the short caption independently of the potentially huge streaming result.
    if (step.previewInput !== step.input || step.previewNote !== step.note || step.previewName !== step.name) {
        step.previewInput = step.input; step.previewNote = step.note; step.previewName = step.name;
        const value = step.input.length > OUTPUT_PAGE_SIZE ? step.note : String(toolLabel(step));
        step.preview = value === step.name ? "" : value.slice(0, 160).replace(/\s+/g, " ");
    }
    return step.preview;
}

function renderTurnHeader(view) {
    const { turn } = view;
    const working = turn.status === "working";
    const current = working ? currentStep(turn) : null;
    const elapsed = turn.durationMs ?? (working ? Date.now() - turn.startedAt : null);
    const duration = elapsed == null ? "" : `${Math.max(1, Math.round(elapsed / 1000))} 秒`;
    const label = working ? (current?.kind === "tool" ? `正在${toolDisplayName(current)}` : turn.phase)
        : turn.status === "failed" ? "执行未完成" : "执行完成";
    setExecutionLabel(view.label, !view.collapsed && working ? "执行过程" : label, working && view.collapsed);
    setText(view.preview, view.collapsed && current?.kind === "tool" ? toolPreview(current) : "");
    setText(view.meta, [turn.toolCount ? `${turn.toolCount} 项操作` : "", duration].filter(Boolean).join(" · "));
    view.activity.classList.toggle("working", working);
    view.activity.classList.toggle("failed", turn.status === "failed");
    view.activity.classList.toggle("collapsed", view.collapsed);
    view.activity.hidden = !working && !turn.steps.some(step => !step.promoted);
    view.toggle.setAttribute("aria-expanded", String(!view.collapsed));
    view.toggle.title = view.collapsed ? "展开执行过程" : "收起执行过程";
    view.body.hidden = view.collapsed;
    view.pages.element.hidden = view.collapsed || turn.steps.length <= ACTIVITY_PAGE_SIZE;
}

function createActivityPages(view) {
    const element = document.createElement("div"); element.className = "activity-pages output-controls"; element.hidden = true;
    const button = (text, action) => {
        const item = document.createElement("button"); item.type = "button"; item.textContent = text;
        item.addEventListener("click", () => { action(); renderTurn(view, false); }); element.appendChild(item); return item;
    };
    const previous = button("较早记录", () => { view.activityOffset = Math.max(0, view.activityStart - ACTIVITY_PAGE_SIZE); });
    const next = button("较新记录", () => { view.activityOffset = Math.min(Math.max(0, view.turn.steps.length - ACTIVITY_PAGE_SIZE), view.activityStart + ACTIVITY_PAGE_SIZE); });
    const latest = button("跟随最新", () => { view.activityOffset = null; });
    const info = document.createElement("span"); element.appendChild(info);
    view.body.after(element);
    return { element, previous, next, latest, info };
}

function renderActivity(view) {
    const { turn } = view;
    const start = Math.min(Math.max(0, turn.steps.length - ACTIVITY_PAGE_SIZE),
        view.activityOffset ?? Math.max(0, turn.steps.length - ACTIVITY_PAGE_SIZE));
    const visible = turn.steps.slice(start, start + ACTIVITY_PAGE_SIZE);
    const keys = new Set(visible.map(step => step.key));
    for (const [key, node] of view.nodes) {
        if (!keys.has(key)) { node.element.remove(); view.nodes.delete(key); }
    }
    for (let index = 0; index < visible.length; index++) {
        const step = visible[index];
        let node = view.nodes.get(step.key);
        if (!node) {
            node = step.kind === "tool" ? createToolNode() : createTextNode(step.kind);
            node.element.open = view.openSteps.has(step.key);
            node.element.addEventListener("toggle", () => {
                if (node.element.open) view.openSteps.add(step.key); else view.openSteps.delete(step.key);
                if (node.element.open && !view.collapsed) updateActivityNode(node, step, turn);
            });
            view.nodes.set(step.key, node);
        }
        if (view.body.children[index] !== node.element) view.body.insertBefore(node.element, view.body.children[index] || null);
        node.element.hidden = Boolean(step.promoted);
        if (!step.promoted) updateActivityNode(node, step, turn);
    }
    view.activityStart = start;
    view.pages.previous.disabled = start === 0;
    view.pages.next.disabled = start + visible.length >= turn.steps.length;
    view.pages.latest.disabled = view.activityOffset == null;
    setText(view.pages.info, `${start + 1}–${start + visible.length} / ${turn.steps.length} 条记录`);
}

function updateActivityNode(node, step, turn) {
    const running = stepIsRunning(turn, step);
    node.element.classList.toggle("is-running", running);
    if (step.kind === "tool") {
        const terminalStatus = turn.status !== "working" && ["preparing", "running"].includes(step.status)
            ? "interrupted" : step.status;
        updateToolNode(node, step, running, terminalStatus);
    } else {
        const failed = turn.status === "failed" && turn.activeStepKey === step.key;
        node.element.dataset.status = running ? "running" : failed ? "failed" : "completed";
        setExecutionLabel(node.label, step.kind === "thinking" ? (running ? "正在思考" : "思考") : (running ? "正在组织回复" : "过程说明"), running);
        setText(node.preview, step.text.slice(0, 120).replace(/\s+/g, " "));
        setText(node.status, running ? "进行中" : failed ? "已中断" : "已完成");
        if (node.element.open) updateOutputView(node.output, step.text, running);
    }
}

function createTextNode(kind) {
    const element = document.createElement("details"); element.className = `process-text execution-step ${kind}`; element.open = false;
    element.innerHTML = '<summary><span class="tool-status" aria-hidden="true"></span><span class="step-label execution-label"><span class="execution-label-text"></span><span class="execution-label-sweep" aria-hidden="true"><span class="execution-label-copy"></span></span></span><span class="step-preview"></span><span class="tool-state"></span><span class="chevron" aria-hidden="true"></span></summary><div class="process-details"><div class="markdown"></div></div>';
    return { element, label: element.querySelector(".step-label"), preview: element.querySelector(".step-preview"),
        status: element.querySelector(".tool-state"), output: createOutputView(element.querySelector(".markdown"), { markdown: true, tail: true, fileName: `${kind}.md` }) };
}

function createToolNode() {
    const element = document.createElement("details"); element.className = "tool-step execution-step"; element.open = false;
    element.innerHTML = '<summary><span class="tool-status" aria-hidden="true"></span><span class="tool-name execution-label"><span class="execution-label-text"></span><span class="execution-label-sweep" aria-hidden="true"><span class="execution-label-copy"></span></span></span><span class="tool-command step-preview"></span><span class="tool-state"></span><span class="chevron" aria-hidden="true"></span></summary><div class="tool-details"><div class="tool-input-section" hidden><div class="tool-section-label">输入</div><pre class="tool-input"></pre></div><div class="tool-output-section" hidden><div class="tool-section-label">输出</div><pre class="tool-output"></pre></div><div class="tool-wait">等待工具返回…</div></div>';
    const node = { element, name: element.querySelector(".tool-name"), command: element.querySelector(".tool-command"),
        status: element.querySelector(".tool-state"), input: element.querySelector(".tool-input"),
        output: element.querySelector(".tool-output"), inputSection: element.querySelector(".tool-input-section"),
        outputSection: element.querySelector(".tool-output-section"), wait: element.querySelector(".tool-wait") };
    node.inputOutput = createOutputView(node.input, { fileName: "tool-input.txt" });
    node.resultOutput = createOutputView(node.output, { tail: true, fileName: "tool-output.txt" });
    return node;
}

function updateToolNode(node, step, running = ["preparing", "running"].includes(step.status), status = step.status) {
    node.step = step;
    node.element.dataset.status = status;
    setExecutionLabel(node.name, toolDisplayName(step), running);
    setText(node.command, toolPreview(step));
    setText(node.status, { preparing: "准备中", running: "执行中", completed: "已完成", failed: "失败", interrupted: "已中断" }[status]);
    if (!node.element.open) return;
    node.inputSection.hidden = !step.input; node.outputSection.hidden = !step.output;
    if (node.inputSource !== step.input || node.inputName !== step.name) {
        node.inputSource = step.input; node.inputName = step.name;
        let input = step.input;
        if (input.length <= OUTPUT_PAGE_SIZE) try {
            const parsed = JSON.parse(input);
            input = step.name === "execute" && parsed.command ? parsed.command : JSON.stringify(parsed, null, 2);
        } catch (_) { /* Show incomplete JSON as it arrives. */ }
        updateOutputView(node.inputOutput, input);
    }
    if (node.outputSource !== step.output) {
        node.outputSource = step.output;
        updateOutputView(node.resultOutput, step.output.length > OUTPUT_PAGE_SIZE ? step.output : formatToolOutput(step.output));
    }
    node.wait.hidden = Boolean(step.output) || step.status === "completed" || step.status === "failed";
}

// Bound DOM and Markdown work, while keeping the complete text for paging, copying and download.
const OUTPUT_PAGE_SIZE = 12000;
function createOutputView(element, { markdown = false, tail = false, fileName = "output.txt" } = {}) {
    const controls = document.createElement("div"); controls.className = "output-controls"; controls.hidden = true;
    const output = { element, controls, markdown, tail, fileName, raw: "", offset: null, streaming: false };
    const button = (label, action) => {
        const item = document.createElement("button"); item.type = "button"; item.textContent = label;
        item.addEventListener("click", action); controls.appendChild(item); return item;
    };
    output.previous = button("上一段", () => { output.offset = Math.max(0, output.start - OUTPUT_PAGE_SIZE); paintOutputView(output); element.scrollTop = 0; });
    output.next = button("下一段", () => { output.offset = Math.min(Math.max(0, output.raw.length - OUTPUT_PAGE_SIZE), output.start + OUTPUT_PAGE_SIZE); paintOutputView(output); element.scrollTop = 0; });
    output.latest = button("跟随最新", () => { output.offset = null; paintOutputView(output); element.scrollTop = element.scrollHeight; });
    output.info = document.createElement("span"); controls.appendChild(output.info);
    button("下载全文", () => {
        const url = URL.createObjectURL(new Blob([output.raw], { type: "text/plain;charset=utf-8" }));
        const link = document.createElement("a"); link.href = url; link.download = output.fileName;
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    element.addEventListener("scroll", () => {
        if (tail && output.offset == null && output.raw.length > OUTPUT_PAGE_SIZE
            && element.scrollHeight - element.scrollTop - element.clientHeight >= 50) {
            output.offset = output.start;
            output.latest.disabled = false;
        }
    }, { passive: true });
    element.after(controls);
    return output;
}

function updateOutputView(output, raw, streaming = false) {
    if (output.raw === raw && output.streaming === streaming) return;
    output.raw = raw; output.streaming = streaming;
    paintOutputView(output);
}

function paintOutputView(output) {
    const { raw, element } = output;
    const long = raw.length > OUTPUT_PAGE_SIZE;
    const maxStart = Math.max(0, raw.length - OUTPUT_PAGE_SIZE);
    const start = Math.min(maxStart, output.offset ?? (output.tail ? maxStart : 0));
    const end = Math.min(raw.length, start + OUTPUT_PAGE_SIZE);
    const text = raw.slice(start, end);
    const plain = !output.markdown || output.streaming || long;
    // An earlier page stays untouched while more tokens arrive at the end.
    if (output.visibleText !== text || output.plain !== plain) {
        const follow = output.tail && output.offset == null
            && element.scrollHeight - element.scrollTop - element.clientHeight < 50;
        output.visibleText = text; output.plain = plain;
        element.classList.toggle("plain-output", plain);
        if (plain) element.textContent = text;
        else element.innerHTML = sanitizeMarkdown(text);
        if (follow) element.scrollTop = element.scrollHeight;
    }
    output.start = start;
    output.controls.hidden = !long;
    if (long) {
        output.previous.disabled = start === 0;
        output.next.disabled = end === raw.length;
        output.latest.hidden = !output.tail;
        output.latest.disabled = output.offset == null;
        output.info.textContent = `${start + 1}–${end} / ${raw.length} 字符 · 纯文本分段显示`;
    }
}

async function readSse(body, onEvent) {
    const reader = body.getReader(); const decoder = new TextDecoder(); let buffer = "";
    let batchStarted = Date.now();
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) throw new Error("连接已中断，请刷新会话确认结果后重试");
            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split(/\r?\n\r?\n/); buffer = chunks.pop() || "";
            for (const chunk of chunks) {
                const event = parseSseChunk(chunk);
                if (!event) continue;
                onEvent(event);
                if (event.name === "done" || event.name === "error") return;
                if (Date.now() - batchStarted >= 8) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                    batchStarted = Date.now();
                }
            }
        }
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function parseSseChunk(chunk) {
    let name = "message"; const data = [];
    for (const line of chunk.split(/\r?\n/)) {
        if (line.startsWith("event:")) name = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    return data.length ? { name, data: JSON.parse(data.join("\n")) } : null;
}
function sanitizeMarkdown(markdown) {
    return renderMarkdown(markdown || "");
}

function renderMarkdown(markdown) {
    const lines = markdown.replace(/\r\n/g, "\n").split("\n");
    const html = [];
    let inCode = false;
    let code = [];
    let paragraph = [];
    let quote = [];
    let list = null;
    let table = [];

    const flushParagraph = () => {
        if (paragraph.length) {
            html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
            paragraph = [];
        }
    };
    const flushQuote = () => {
        if (quote.length) {
            html.push(`<blockquote><p>${inlineMarkdown(quote.join(" "))}</p></blockquote>`);
            quote = [];
        }
    };
    const flushList = () => {
        if (list && list.items.length) {
            const tag = list.type === "ordered" ? "ol" : "ul";
            const className = list.task ? ' class="task-list"' : "";
            html.push(`<${tag}${className}>${list.items.map(renderListItem).join("")}</${tag}>`);
            list = null;
        }
    };
    const flushTable = () => {
        if (table.length) {
            html.push(renderTable(table));
            table = [];
        }
    };
    const flushCode = () => {
        if (inCode) {
            html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
            code = [];
            inCode = false;
        }
    };

    lines.forEach((line) => {
        if (line.trim().startsWith("```")) {
            if (inCode) {
                flushCode();
            } else {
                flushParagraph();
                flushQuote();
                flushList();
                flushTable();
                inCode = true;
                code = [];
            }
            return;
        }
        if (inCode) {
            code.push(line);
            return;
        }
        const trimmed = line.trim();
        if (!trimmed) {
            flushParagraph();
            flushQuote();
            flushList();
            flushTable();
            return;
        }
        const horizontalRule = trimmed.match(/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/);
        if (horizontalRule) {
            flushParagraph();
            flushQuote();
            flushList();
            flushTable();
            html.push("<hr>");
            return;
        }
        if (trimmed.includes("|") && /^\|?(.+\|)+.+\|?$/.test(trimmed)) {
            flushParagraph();
            flushQuote();
            flushList();
            table.push(trimmed);
            return;
        }
        const heading = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/);
        if (heading) {
            flushParagraph();
            flushQuote();
            flushList();
            flushTable();
            const level = heading[1].length;
            html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
            return;
        }
        const listItem = trimmed.match(/^([-*+])\s+(.+)$/);
        if (listItem) {
            flushParagraph();
            flushQuote();
            flushTable();
            pushListItem("unordered", listItem[2]);
            return;
        }
        const orderedItem = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
        if (orderedItem) {
            flushParagraph();
            flushQuote();
            flushTable();
            pushListItem("ordered", orderedItem[2]);
            return;
        }
        const quoteLine = trimmed.match(/^>\s?(.+)$/);
        if (quoteLine) {
            flushParagraph();
            flushList();
            flushTable();
            quote.push(quoteLine[1]);
            return;
        }
        flushQuote();
        flushTable();
        flushList();
        paragraph.push(trimmed);
    });
    flushParagraph();
    flushQuote();
    flushList();
    flushTable();
    flushCode();
    return html.join("");

    function pushListItem(type, content) {
        const task = content.match(/^\[(x|X| )]\s+(.+)$/);
        if (!list || list.type !== type || Boolean(list.task) !== Boolean(task)) {
            flushList();
            list = { type, task: Boolean(task), items: [] };
        }
        list.items.push({
            text: task ? task[2] : content,
            checked: task ? task[1].toLowerCase() === "x" : null,
        });
    }
}

function renderListItem(item) {
    if (item.checked == null) {
        return `<li>${inlineMarkdown(item.text)}</li>`;
    }
    const checked = item.checked ? " checked" : "";
    return `<li class="task-list-item"><input type="checkbox"${checked} disabled>${inlineMarkdown(item.text)}</li>`;
}

function renderTable(rows) {
    const parsed = rows
        .map((row) => row.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim()))
        .filter((cells) => !cells.every((cell) => /^:?-{3,}:?$/.test(cell)));
    if (!parsed.length) {
        return "";
    }
    const [head, ...body] = parsed;
    return `
        <table>
            <thead><tr>${head.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join("")}</tr></thead>
            <tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
    `;
}

function inlineMarkdown(text) {
    return escapeHtml(text)
        .replace(/!\[([^\]]*)]\((https?:\/\/[^)\s]+)\)/g, '<img src="$2" alt="$1">')
        .replace(/~~([^~]+)~~/g, "<del>$1</del>")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/(\*\*|__)(.+?)\1/g, "<strong>$2</strong>")
        .replace(/(\*|_)([^*_]+?)\1/g, "<em>$2</em>")
        .replace(/\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function escapeHtml(text) {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function clearEmptyState() { els.messages.querySelector(".empty-state")?.remove(); }
function setBusy(busy) {
    state.busy = busy;
    updateComposerState(); renderSessions();
}
function updateComposerState() {
    els.send.disabled = state.busy || state.sessionLoading || state.sessionLoadError || !state.activeSessionId;
    els.newSession.disabled = state.busy;
    els.send.classList.toggle("working", state.busy);
    els.send.setAttribute("aria-label", state.sessionLoading ? "正在加载会话" : state.sessionLoadError ? "请先重新加载会话" : state.busy ? "当前正在回复" : "发送消息");
    els.help.textContent = state.sessionLoading ? "可以继续输入，会话加载完成后发送"
        : state.sessionLoadError ? "请重新加载会话后发送" : state.busy ? "可以继续输入，当前回答完成后发送" : "Enter 发送，Shift + Enter 换行";
    setStatus(state.sessionLoading ? "加载中" : state.sessionLoadError ? "加载失败" : state.busy ? "处理中" : "就绪", state.busy || state.sessionLoading);
}
function setStatus(text, busy) { els.statusText.textContent = text; els.statusDot.classList.toggle("busy", busy); }
function autosizePrompt() { els.prompt.style.height = "auto"; els.prompt.style.height = `${Math.min(220, Math.max(52, els.prompt.scrollHeight))}px`; }
function scrollToBottom() { if (state.followOutput) { els.messages.scrollTop = els.messages.scrollHeight; els.jump.hidden = true; } }
function toast(message) { clearTimeout(state.toastTimer); els.toast.textContent = message; els.toast.hidden = false; state.toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3200); }
function showError(error) { toast(error.message || String(error)); }
init().catch(error => { setStatus("连接失败", false); showError(error); });

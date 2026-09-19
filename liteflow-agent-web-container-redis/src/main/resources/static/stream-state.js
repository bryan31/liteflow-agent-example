/* Typed stream state is independent of the DOM so live rendering and history use the same rules. */
function createTurnState(startedAt = Date.now()) {
    return { startedAt, durationMs: null, status: "working", steps: [], byKey: new Map(), toolKeys: new Map(),
        toolCount: 0, activeStepKey: null, activeTools: new Set(), lastMessage: null, legacyTool: null, finalText: null, error: null, phase: "正在思考", artifacts: new Map() };
}

function applyTurnEvent(turn, event) {
    const data = event.data || {};
    const type = data.type || "";
    if (event.name === "artifact") {
        const artifact = data.artifact;
        if (artifact?.id && /^\/api\/chat\/sessions\/[^/]+\/artifacts\/[0-9a-f]{64}$/.test(artifact.downloadUrl || "")) {
            turn.artifacts.set(artifact.id, artifact);
        }
        return;
    }
    if (event.name === "status") {
        if (data.startedAt) turn.startedAt = data.startedAt;
        return;
    }
    if (event.name === "error" || (event.name === "action" && type === "error")) {
        turn.error = data.message || data.text || "请求未能完成";
        turn.status = "failed";
        for (const step of turn.steps) {
            if (step.kind === "tool" && ["preparing", "running"].includes(step.status)) step.status = "failed";
        }
        turn.durationMs = Date.now() - turn.startedAt;
        return;
    }
    if (event.name === "done") {
        if (data.reply != null) applyTurnEvent(turn, { name: "result", data: { text: data.reply } });
        turn.status = turn.error ? "failed" : "completed";
        turn.durationMs = data.durationMs ?? Date.now() - turn.startedAt;
        return;
    }
    if (event.name === "result") {
        if (data.text == null) return;
        turn.finalText = data.text;
        turn.phase = "正在完成";
        const candidates = turn.steps.filter(step => step.kind === "message");
        const finalStep = candidates.find(step => data.replyId && step.replyId === data.replyId)
            || candidates.findLast(step => step.text && data.text.trim().startsWith(step.text.trim()));
        if (finalStep) finalStep.promoted = true;
        return;
    }
    if (event.name === "action") {
        let key;
        if (data.toolCallId) {
            const base = `tool:${data.nodeId || ""}:${data.toolCallId}`;
            key = turn.toolKeys.get(base) || base;
            const previous = turn.byKey.get(key);
            if (type === "agent.tool.call.start" && previous && ["completed", "failed"].includes(previous.status)) {
                key = `${base}:${turn.steps.length}`;
            }
            turn.toolKeys.set(base, key);
        } else {
            if (!turn.legacyTool || type === "agent.tool.call.start") {
                turn.legacyTool = `legacy-tool:${turn.steps.length}`;
            }
            key = turn.legacyTool;
        }
        let step = turn.byKey.get(key);
        if (!step) {
            step = { key, kind: "tool", name: data.toolName || "工具调用", input: "", output: "",
                status: "preparing", note: "", timestamp: data.timestamp || Date.now() };
            turn.byKey.set(key, step);
            turn.steps.push(step);
            turn.toolCount++;
        }
        turn.activeStepKey = key;
        if (data.toolName) step.name = data.toolName;
        if (data.toolInput?.delta != null) step.input += data.toolInput.delta;
        else if (data.toolInput && Object.keys(data.toolInput).length) step.input = JSON.stringify(data.toolInput, null, 2);
        if (data.toolResult != null) step.output += data.toolResult;
        if (data.text && !type.startsWith("agent.tool.")) step.note = data.text;
        if (type === "agent.tool.call.end" || type.startsWith("agent.tool.result")) step.status = "running";
        if (type === "agent.tool.result.end") {
            step.status = ["error", "denied", "interrupted"].includes(data.toolState) ? "failed" : "completed";
            turn.legacyTool = null;
        }
        if (["preparing", "running"].includes(step.status)) turn.activeTools.add(key);
        else turn.activeTools.delete(key);
        turn.phase = turn.activeTools.size ? `正在调用 ${step.name}` : "正在思考";
        turn.lastMessage = null;
        return;
    }
    if (!data.text) return;
    const kind = event.name === "message" || type === "agent.text.delta" ? "message" : "thinking";
    let key = data.replyId ? `${kind}:${data.nodeId || ""}:${data.replyId}:${kind === "thinking" ? data.blockId || "" : ""}` : null;
    if (!key) {
        const last = turn.steps.at(-1);
        key = last?.kind === kind && !last.promoted ? last.key : `${kind}:${turn.steps.length}`;
    }
    let step = turn.byKey.get(key);
    if (!step) {
        step = { key, kind, text: "", replyId: data.replyId, promoted: false };
        turn.byKey.set(key, step);
        turn.steps.push(step);
    }
    step.text += data.text;
    turn.activeStepKey = key;
    if (kind === "message") turn.lastMessage = step;
    turn.phase = kind === "thinking" ? "正在思考" : "正在回复";
}

function toolLabel(step) {
    let input;
    try { input = JSON.parse(step.input); } catch (_) { input = null; }
    return input?.command || input?.path || input?.file_path || input?.query || step.note || step.name;
}

function turnFromHistory(payload, reply) {
    const firstTime = payload.events?.find(event => event.timestamp)?.timestamp || Date.now();
    const turn = createTurnState(firstTime);
    for (const data of payload.events || []) applyTurnEvent(turn, { name: data.stage, data });
    if (reply != null) applyTurnEvent(turn, { name: "result", data: { text: reply } });
    turn.status = payload.status === "失败" || turn.error ? "failed" : "completed";
    turn.durationMs = payload.durationMs ?? null;
    return turn;
}

function formatToolOutput(raw) {
    try {
        const value = JSON.parse(raw);
        return typeof value === "string" ? value : JSON.stringify(value, null, 2);
    } catch (_) { return raw; }
}

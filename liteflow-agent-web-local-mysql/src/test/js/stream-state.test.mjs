import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
const context = vm.createContext({});
vm.runInContext(readFileSync(new URL("../../main/resources/static/stream-state.js", import.meta.url), "utf8"), context);
const { createTurnState, applyTurnEvent, turnFromHistory, toolLabel } = context;
const action = (id, type, data = {}) => ({ name: "action", data: { replyId: "r", toolCallId: id, type: `agent.tool.${type}`, ...data } });

test("thinking and answer fragments accumulate separately before completion", () => {
    const turn = createTurnState();
    applyTurnEvent(turn, { name: "reasoning", data: { replyId: "r", blockId: "t", text: "先检查" } });
    applyTurnEvent(turn, { name: "reasoning", data: { replyId: "r", blockId: "t", text: "工作目录。" } });
    applyTurnEvent(turn, { name: "message", data: { replyId: "r", text: "已经" } });
    assert.equal(turn.steps[0].text, "先检查工作目录。");
    assert.equal(turn.steps[1].text, "已经");
    assert.equal(turn.finalText, null);
    applyTurnEvent(turn, { name: "message", data: { replyId: "r", text: "完成。" } });
    applyTurnEvent(turn, { name: "result", data: { replyId: "r", text: "已经完成。" } });
    assert.equal(turn.steps[1].promoted, true);
    assert.equal(turn.steps[0].promoted, false);
    assert.equal(turn.finalText, "已经完成。");
});

test("interleaved tool streams retain all arguments, output and their own completion states", () => {
    const turn = createTurnState();
    applyTurnEvent(turn, action("a", "call.start", { toolName: "write_file" }));
    applyTurnEvent(turn, action("b", "call.start", { toolName: "search" }));
    applyTurnEvent(turn, action("a", "call.delta", { toolInput: { delta: '{"command":"printf ' } }));
    applyTurnEvent(turn, action("b", "call.delta", { toolInput: { delta: '{"query":"news"}' } }));
    applyTurnEvent(turn, action("a", "call.delta", { toolInput: { delta: 'ok"}' } }));
    applyTurnEvent(turn, action("a", "call.end"));
    applyTurnEvent(turn, action("a", "result.delta", { toolResult: "first\n" }));
    applyTurnEvent(turn, action("b", "result.delta", { toolResult: "search result" }));
    applyTurnEvent(turn, action("a", "result.delta", { toolResult: "second\n" }));
    assert.equal(turn.steps.length, 2);
    assert.equal(turn.steps[0].input, '{"command":"printf ok"}');
    assert.equal(turn.steps[0].output, "first\nsecond\n");
    assert.equal(turn.steps[0].status, "running");
    assert.equal(toolLabel(turn.steps[0]), "printf ok");
    assert.equal(turn.steps[1].output, "search result");
    applyTurnEvent(turn, action("a", "result.end", { toolState: "success" }));
    applyTurnEvent(turn, action("b", "result.end", { toolState: "error" }));
    assert.equal(turn.steps[0].status, "completed");
    assert.equal(turn.steps[1].status, "failed");
});

test("tool result start is not confused with completion and empty results still finish", () => {
    const turn = createTurnState();
    applyTurnEvent(turn, action("a", "call.start"));
    applyTurnEvent(turn, action("a", "result.start"));
    assert.equal(turn.steps[0].status, "running");
    applyTurnEvent(turn, action("a", "result.end", { toolState: "success" }));
    assert.equal(turn.steps[0].status, "completed");
});

test("history uses the same reducer and removes duplicated final reply text from legacy traces", () => {
    const turn = turnFromHistory({ status: "已完成", durationMs: 3000, events: [
        { stage: "reasoning", type: "agent.thinking.delta", text: "先检查" },
        { stage: "reasoning", type: "agent.text.delta", text: "最终" },
        { stage: "reasoning", type: "agent.text.delta", text: "回答" },
    ] }, "最终回答");
    assert.equal(turn.steps[0].promoted, false);
    assert.equal(turn.steps[1].promoted, true);
    assert.equal(turn.finalText, "最终回答");
    assert.equal(turn.durationMs, 3000);
});

test("a completion event cannot overwrite an error", () => {
    const turn = createTurnState();
    applyTurnEvent(turn, action("pending", "call.start"));
    applyTurnEvent(turn, { name: "error", data: { text: "模型连接中断" } });
    applyTurnEvent(turn, { name: "done", data: {} });
    assert.equal(turn.status, "failed");
    assert.equal(turn.error, "模型连接中断");
    assert.equal(turn.steps[0].status, "failed");
});


test("tool results use their call ID even when AgentScope assigns a different reply ID", () => {
    const turn = createTurnState();
    applyTurnEvent(turn, action("a", "call.start", { replyId: "assistant-message", toolName: "write_file" }));
    applyTurnEvent(turn, action("a", "call.delta", { replyId: "assistant-message", toolInput: { delta: '{"command":"pwd"}' } }));
    applyTurnEvent(turn, action("a", "result.start", { replyId: "tool-result-message" }));
    applyTurnEvent(turn, action("a", "result.delta", { replyId: "tool-result-message", toolResult: "/workspace" }));
    applyTurnEvent(turn, action("a", "result.end", { replyId: "tool-result-message", toolState: "success" }));
    assert.equal(turn.steps.length, 1);
    assert.equal(turn.steps[0].output, "/workspace");
    assert.equal(turn.steps[0].status, "completed");
});


test("a later tool call can reuse an ID without inheriting old arguments", () => {
    const turn = createTurnState();
    applyTurnEvent(turn, action("a", "call.start"));
    applyTurnEvent(turn, action("a", "result.end", { toolState: "success" }));
    applyTurnEvent(turn, action("a", "call.start"));
    applyTurnEvent(turn, action("a", "call.delta", { toolInput: { delta: '{"command":"ls"}' } }));
    assert.equal(turn.steps.length, 2);
    assert.equal(turn.steps[0].status, "completed");
    assert.equal(turn.steps[1].input, '{"command":"ls"}');
});

test("JSON-encoded tool strings render as readable console output", () => {
    assert.equal(context.formatToolOutput(JSON.stringify("line one\nline two")), "line one\nline two");
    assert.equal(context.formatToolOutput("partial output"), "partial output");
});


test("artifact delivery survives history replay and deduplicates a repeated delivery", () => {
    const artifact = { id: "a".repeat(64), fileName: "报告.csv", size: 12,
        downloadUrl: "/api/chat/sessions/session/artifacts/" + "a".repeat(64) };
    const event = { stage: "artifact", type: "agent.artifact.delivered", artifact };
    const turn = createTurnState();
    applyTurnEvent(turn, { name: "artifact", data: event });
    applyTurnEvent(turn, { name: "artifact", data: event });
    assert.equal(turn.artifacts.size, 1);
    assert.equal(turn.steps.length, 0);
    const restored = turnFromHistory({ events: [event], status: "已完成" }, "已生成报告");
    assert.equal(restored.artifacts.get(artifact.id).downloadUrl, artifact.downloadUrl);
    applyTurnEvent(turn, { name: "artifact", data: { artifact: { ...artifact, id: "unsafe", downloadUrl: "javascript:alert(1)" } } });
    assert.equal(turn.artifacts.size, 1);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const app = readFileSync(new URL("../../main/resources/static/app.js", import.meta.url), "utf8");
function fixture() {
    const elements = new Map();
    const timers = new Map();
    let nextTimer = 0;
    const context = vm.createContext({ AbortController, Date, setTimeout(fn, delay) {
        const id = ++nextTimer; timers.set(id, { fn, delay }); return id;
    }, clearTimeout(id) { timers.delete(id); }, document: { hidden: false, querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, { dataset: {}, textContent: "", disabled: false });
        return elements.get(selector);
    } } });
    vm.runInContext(app.slice(0, app.lastIndexOf("init().catch")), context);
    vm.runInContext('state.activeSessionId = "a";', context);
    return { context, elements, timers };
}

test("container state is independent of the chat request and displays actual metadata", () => {
    const { context, elements } = fixture();
    context.renderSandboxStatus({ state: "RUNNING", containerId: "abc", image: "sandbox:test", busy: false,
        lastActiveAt: 1000, checkedAt: 2000 });
    assert.equal(elements.get("#sandbox-label").textContent, "容器 · 运行中");
    assert.equal(elements.get("#sandbox-activity").textContent, "空闲");
    assert.equal(elements.get("#sandbox-id").textContent, "abc");
    context.renderSandboxStatus({ state: "STOPPED", containerId: "abc", busy: true });
    assert.equal(elements.get("#sandbox-label").textContent, "容器 · 已停止");
    assert.equal(elements.get("#sandbox-activity").textContent, "执行中");
    context.renderSandboxStatus({ state: "NOT_ALLOCATED" });
    assert.equal(elements.get("#sandbox-id").textContent, "—");
    assert.equal(elements.get("#sandbox-image").textContent, "—");
});

test("a failed query clears the previous running observation and schedules a retry", async () => {
    const { context, elements, timers } = fixture();
    context.renderSandboxStatus({ state: "RUNNING", containerId: "old" });
    context.api = async () => { throw new Error("offline"); };
    await context.refreshSandboxStatus();
    assert.equal(elements.get("#sandbox-label").textContent, "容器 · 状态未知");
    assert.equal(elements.get("#sandbox-id").textContent, "—");
    assert.equal(elements.get("#sandbox-refresh").disabled, false);
    assert.deepEqual([...timers.values()].map(t => t.delay), [10000]);
});

test("late results from the previous conversation cannot overwrite the selected one", async () => {
    const { context, elements } = fixture();
    const pending = [];
    context.api = path => new Promise(resolve => pending.push({ path, resolve }));
    const old = context.refreshSandboxStatus();
    vm.runInContext('state.sandboxRequest.abort(); state.sandboxRequest = null; state.activeSessionId = "b";', context);
    const current = context.refreshSandboxStatus();
    assert.match(pending[1].path, /\/b\/sandbox$/);
    pending[1].resolve({ state: "RUNNING", containerId: "new" });
    await current;
    pending[0].resolve({ state: "RUNNING", containerId: "old" });
    await old;
    assert.equal(elements.get("#sandbox-id").textContent, "new");
});

test("polls during active work without overlapping requests and pauses in a hidden tab", async () => {
    const { context, timers } = fixture();
    let complete;
    let requests = 0;
    context.api = () => { requests++; return new Promise(resolve => { complete = resolve; }); };
    vm.runInContext('state.busy = true;', context);
    const pending = context.refreshSandboxStatus();
    await context.refreshSandboxStatus();
    assert.equal(requests, 1);
    complete({ state: "RUNNING", busy: true });
    await pending;
    assert.deepEqual([...timers.values()].map(t => t.delay), [3000]);
    context.document.hidden = true;
    await context.refreshSandboxStatus();
    assert.equal(requests, 1);
});

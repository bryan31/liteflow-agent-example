import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const app = readFileSync(new URL("../../main/resources/static/app.js", import.meta.url), "utf8");
function fixture() {
    const elements = new Map();
    const timers = new Map();
    const requests = [];
    function element() {
        return { textContent: "", value: "", disabled: false, hidden: false, children: [], attributes: {},
            set innerHTML(value) { this.markup = value; this.children = []; }, get innerHTML() { return this.markup || ""; },
            appendChild(child) { this.children.push(child); }, setAttribute(key, value) { this.attributes[key] = value; },
            classList: { toggle() {} }, querySelector(selector) { return selector === ".conversation" ? content : null; } };
    }
    const content = element();
    let timerId = 0;
    const context = vm.createContext({ AbortController, localStorage: { setItem() {} },
        setTimeout(callback) { timers.set(++timerId, callback); return timerId; }, clearTimeout(id) { timers.delete(id); },
        document: { title: "", querySelector(selector) {
            if (!elements.has(selector)) elements.set(selector, element());
            return elements.get(selector);
        }, createElement: element } });
    vm.runInContext(app.slice(0, app.lastIndexOf("init().catch")), context);
    context.renderSessions = () => {};
    context.renderSkills = () => {};
    context.renderSandboxStatus = () => {};
    context.refreshSandboxStatus = async () => {};
    context.api = (path, options) => new Promise((resolve, reject) => requests.push({ path, options, resolve, reject }));
    vm.runInContext('state.sessions = [{id:"a",title:"会话 A"},{id:"b",title:"会话 B"}]; state.activeSessionId="a";', context);
    const session = (id, text) => ({ id, title: `会话 ${id.toUpperCase()}`, messages: [{ role: "user", stage: "input", content: text }] });
    return { context, elements, content, requests, timers, session };
}

test("selection clears old content and immediately shows the selected title and loading state", async () => {
    const { context, elements, content, requests, session } = fixture();
    vm.runInContext('state.activeSession={id:"b",title:"会话 B",messages:[]};', context);
    content.innerHTML = "previous conversation";
    elements.get("#prompt").value = "下一条消息";
    const load = context.loadActiveSession();
    assert.equal(elements.get("#chat-title").textContent, "会话 A");
    assert.match(content.innerHTML, /正在加载会话/);
    assert.doesNotMatch(content.innerHTML, /previous conversation/);
    assert.equal(elements.get("#messages").attributes["aria-busy"], "true");
    assert.equal(elements.get("#send-button").disabled, true);
    assert.equal(elements.get("#new-session").disabled, false);
    await context.sendPrompt();
    assert.equal(requests.length, 1);
    assert.equal(elements.get("#prompt").value, "下一条消息");
    requests[0].resolve(session("a", "当前会话的内容"));
    await load;
    assert.equal(content.children[0].textContent, "当前会话的内容");
    assert.equal(elements.get("#messages").attributes["aria-busy"], "false");
    assert.equal(elements.get("#send-button").disabled, false);
});

test("A to B to A cancels obsolete loads and ignores an older response for the same session", async () => {
    const { context, content, requests, session } = fixture();
    const first = context.loadActiveSession();
    vm.runInContext('state.activeSessionId="b";', context);
    const second = context.loadActiveSession();
    assert.equal(requests[0].options.signal.aborted, true);
    vm.runInContext('state.activeSessionId="a";', context);
    const third = context.loadActiveSession();
    requests[2].resolve(session("a", "latest A"));
    await third;
    requests[0].resolve(session("a", "stale A"));
    requests[1].reject(new Error("obsolete B request failed"));
    await Promise.all([first, second]);
    assert.equal(content.children[0].textContent, "latest A");
    assert.equal(vm.runInContext("state.sessionLoadError", context), false);
});

test("an obsolete response cannot dismiss the current conversation's loading state", async () => {
    const { context, elements, content, requests, session } = fixture();
    const first = context.loadActiveSession();
    vm.runInContext('state.activeSessionId="b";', context);
    const second = context.loadActiveSession();
    requests[0].resolve(session("a", "old content"));
    await first;
    assert.match(content.innerHTML, /正在加载会话/);
    assert.equal(elements.get("#chat-title").textContent, "会话 B");
    assert.equal(elements.get("#send-button").disabled, true);
    requests[1].resolve(session("b", "new content"));
    await second;
});

test("failure shows an inline retry and a successful retry restores sending", async () => {
    const { context, elements, content, requests, session } = fixture();
    const failed = context.loadActiveSession();
    requests[0].reject(new Error("database unavailable"));
    await failed;
    assert.match(content.innerHTML, /data-retry-session/);
    assert.equal(elements.get("#send-button").disabled, true);
    const retried = context.loadActiveSession();
    assert.match(content.innerHTML, /正在加载会话/);
    requests[1].resolve(session("a", "recovered"));
    await retried;
    assert.equal(content.children[0].textContent, "recovered");
    assert.equal(elements.get("#send-button").disabled, false);
});

test("a timed out load ends the skeleton and can be retried", async () => {
    const { context, content, requests, timers } = fixture();
    const load = context.loadActiveSession();
    requests[0].options.signal.addEventListener("abort", () => requests[0].reject(new DOMException("aborted", "AbortError")));
    [...timers.values()][0]();
    await load;
    assert.match(content.innerHTML, /会话加载失败/);
    assert.equal(timers.size, 0);
});

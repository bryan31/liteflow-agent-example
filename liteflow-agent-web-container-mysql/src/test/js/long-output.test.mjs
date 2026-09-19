import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../../main/resources/static/", import.meta.url);
const app = readFileSync(new URL("app.js", root), "utf8");
const stream = readFileSync(new URL("stream-state.js", root), "utf8");

function fixture() {
    const timers = new Map();
    let id = 0;
    const metrics = { html: 0, text: 0, layout: 0 };
    function element() {
        const children = [], selectors = new Map(), handlers = new Map(), classes = new Set();
        return { children, style: {}, dataset: {}, hidden: false, scrollTop: 0, clientHeight: 100,
            get scrollHeight() { metrics.layout++; return 100; },
            set textContent(value) { this.text = value; metrics.text++; }, get textContent() { return this.text || ""; },
            set innerHTML(value) { this.html = value; metrics.html++; }, get innerHTML() { return this.html || ""; },
            appendChild(child) { child.remove?.(); children.push(child); child.parentNode = this; return child; }, after(child) { this.afterElement = child; },
            insertBefore(child, before) { child.remove?.(); const i = children.indexOf(before); children.splice(i < 0 ? children.length : i, 0, child); child.parentNode = this; },
            remove() { if (this.parentNode) { const siblings = this.parentNode.children; siblings.splice(siblings.indexOf(this), 1); this.parentNode = null; } }, setAttribute() {},
            addEventListener(name, callback) { handlers.set(name, callback); },
            click() { handlers.get("click")?.(); }, dispatch(name) { handlers.get(name)?.(); },
            querySelector(selector) {
                if (!selectors.has(selector)) selectors.set(selector, element());
                return selectors.get(selector);
            },
            classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } },
        };
    }
    const doc = element();
    const blobs = [];
    const context = vm.createContext({ TextDecoder, Blob, Date,
        URL: { createObjectURL(blob) { blobs.push(blob); return "blob:test"; }, revokeObjectURL() {} },
        setTimeout(callback) { timers.set(++id, callback); return id; }, clearTimeout(key) { timers.delete(key); },
        document: { querySelector: selector => doc.querySelector(selector), createElement: element },
    });
    vm.runInContext(stream + "\n" + app.slice(0, app.lastIndexOf("init().catch")), context);
    context.clearEmptyState = () => {};
    return { context, element, metrics, timers, blobs };
}

test("a burst of 10000 deltas is coalesced and terminal events flush all content immediately", () => {
    const { context, timers } = fixture();
    let renders = 0;
    context.renderTurn = () => renders++;
    const turn = context.createTurnState();
    const renderer = context.createTurnRenderer({ turn });
    for (let i = 0; i < 10000; i++) {
        context.applyTurnEvent(turn, { name: "reasoning", data: { text: "内容" } });
        renderer.schedule();
    }
    assert.equal(renders, 0);
    assert.equal(timers.size, 1);
    assert.equal(turn.steps[0].text.length, 20000);
    context.applyTurnEvent(turn, { name: "done", data: { reply: "全部完成" } });
    renderer.schedule();
    assert.equal(renders, 1);
    assert.equal(timers.size, 0);
    assert.equal(turn.finalText, "全部完成");
});

test("streaming text avoids Markdown work and completion formats short text once", () => {
    const { context, element, metrics } = fixture();
    const target = element();
    const output = context.createOutputView(target, { markdown: true });
    context.updateOutputView(output, "**完成**", true);
    assert.equal(target.textContent, "**完成**");
    assert.equal(metrics.html, 0);
    context.updateOutputView(output, "**完成**");
    assert.match(target.innerHTML, /<strong>完成<\/strong>/);
    context.updateOutputView(output, "**完成**");
    assert.equal(metrics.html, 1);
});

test("megabyte output stays bounded, earlier pages remain stable, and download retains every character", async () => {
    const { context, element, metrics, blobs } = fixture();
    const target = element();
    const output = context.createOutputView(target, { markdown: true, tail: true });
    const raw = "FIRST\n" + "text [ code | **\n".repeat(100000) + "LAST";
    context.updateOutputView(output, raw, true);
    assert.equal(target.textContent, raw.slice(-12000));
    assert.equal(output.controls.hidden, false);
    assert.equal(metrics.html, 0);
    output.previous.click();
    const earlier = target.textContent;
    const writes = metrics.text;
    context.updateOutputView(output, raw + "NEW", true);
    assert.equal(target.textContent, earlier);
    // Only the range label is updated, not the content itself.
    assert.equal(metrics.text, writes + 1);
    output.latest.click();
    assert.ok(target.textContent.endsWith("LASTNEW"));
    output.controls.children.at(-1).click();
    assert.equal(await blobs[0].text(), raw + "NEW");
    context.updateOutputView(output, raw + "NEW", false);
    assert.equal(metrics.html, 0);
    assert.ok(target.textContent.length <= 12000);
});

test("pagination covers the whole final answer without gaps", () => {
    const { context, element } = fixture();
    const target = element();
    const output = context.createOutputView(target, { markdown: true });
    const raw = "head" + "0123456789".repeat(4700) + "tail";
    context.updateOutputView(output, raw);
    let covered = target.textContent.length;
    assert.ok(target.textContent.startsWith("head"));
    while (!output.next.disabled) {
        output.next.click();
        assert.ok(output.start <= covered);
        assert.equal(target.textContent, raw.slice(output.start, output.start + 12000));
        covered = output.start + target.textContent.length;
    }
    assert.equal(covered, raw.length);
});

test("collapsed history is lazy and unchanged tools cause no formatting or layout work", () => {
    const { context, metrics } = fixture();
    const turn = context.createTurnState();
    context.applyTurnEvent(turn, { name: "action", data: { type: "agent.tool.result.end", toolState: "success", toolCallId: "t", toolName: "execute", toolInput: { command: "ls" }, toolResult: "x".repeat(200000) } });
    context.applyTurnEvent(turn, { name: "done", data: { reply: "完成" } });
    const view = context.createTurnView(turn, true);
    assert.equal(view.nodes.size, 0);
    view.toggle.click();
    assert.equal(view.nodes.size, 1);
    const node = [...view.nodes.values()][0];
    assert.equal(node.output.textContent, "");
    node.element.open = true;
    node.element.dispatch("toggle");
    assert.equal(node.output.textContent.length, 12000);
    const snapshot = { ...metrics };
    context.updateToolNode(node, turn.steps[0]);
    assert.deepEqual(metrics, snapshot);
    node.element.open = false;
    context.applyTurnEvent(turn, { name: "action", data: { toolCallId: "t", toolResult: "END" } });
    context.updateToolNode(node, turn.steps[0]);
    assert.deepEqual(metrics, snapshot);
    node.element.open = true;
    node.element.dispatch("toggle");
    assert.ok(node.output.textContent.endsWith("END"));
});

test("buffered SSE bursts yield to user interaction without losing or reordering events", async () => {
    const { context } = fixture();
    const events = [];
    let ticks = 0, yields = 0;
    context.Date = { now() { return ticks += 2; } };
    context.setTimeout = callback => { yields++; callback(); };
    const wire = Array.from({ length: 100 }, (_, i) => `event: message\ndata: {"text":"${i}"}\n\n`).join("") + "event: done\ndata: {}\n\n";
    const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(wire)); } });
    await context.readSse(body, event => events.push(event));
    assert.ok(yields > 0);
    assert.deepEqual(events.slice(0, -1).map(event => event.data.text), Array.from({ length: 100 }, (_, i) => String(i)));
    assert.equal(events.at(-1).name, "done");
    assert.equal(body.locked, false);
});


test("scrolling back freezes a long live preview until follow latest is selected", () => {
    const { context, element } = fixture();
    const target = element();
    Object.defineProperty(target, "scrollHeight", { get() { return 1000; } });
    target.scrollTop = 900;
    const output = context.createOutputView(target, { tail: true });
    const raw = "0123456789".repeat(10000);
    context.updateOutputView(output, raw, true);
    target.scrollTop = 100;
    target.dispatch("scroll");
    assert.equal(output.offset, output.start);
    const previous = target.textContent;
    context.updateOutputView(output, raw + "LATEST", true);
    assert.equal(target.textContent, previous);
    output.latest.click();
    assert.ok(target.textContent.endsWith("LATEST"));
    assert.equal(output.offset, null);
    assert.equal(target.scrollTop, 1000);
});

test("live processes expand only the first level and collapse once when the final answer arrives", () => {
    const { context } = fixture();
    const turn = context.createTurnState();
    const view = context.createTurnView(turn);
    context.applyTurnEvent(turn, { name: "reasoning", data: { replyId: "r", text: "思考".repeat(100000) } });
    context.applyTurnEvent(turn, { name: "action", data: { type: "agent.tool.call.start", toolCallId: "t", toolName: "execute", toolInput: { command: "python report.py" }, toolResult: "output".repeat(200000) } });
    context.renderTurn(view);
    assert.equal(view.collapsed, false);
    assert.equal(view.body.hidden, false);
    assert.equal(view.nodes.size, 2);
    assert.equal(view.label.dataset.text, "执行过程");
    assert.equal(view.preview.textContent, "");
    assert.equal(view.label.classList.contains("is-running"), false);
    const [thinking, tool] = [...view.nodes.values()];
    assert.equal(thinking.element.open, false);
    assert.equal(thinking.output.raw, "");
    assert.equal(tool.element.open, false);
    assert.equal(tool.resultOutput.raw, "");
    assert.equal(thinking.element.classList.contains("is-running"), false);
    assert.equal(tool.element.classList.contains("is-running"), true);
    tool.element.open = true; tool.element.dispatch("toggle");
    assert.equal(tool.output.textContent.length, 12000);
    assert.equal(tool.resultOutput.raw.length, 1200000);
    context.applyTurnEvent(turn, { name: "result", data: { text: "完成" } });
    context.renderTurn(view);
    assert.equal(turn.status, "working");
    assert.equal(view.collapsed, true);
    assert.equal(view.body.hidden, true);
    assert.equal(view.answer.hidden, false);
    view.toggle.click();
    assert.equal(view.collapsed, false);
    assert.equal(thinking.element.open, false);
    assert.equal(tool.element.open, true);
    context.applyTurnEvent(turn, { name: "done", data: { reply: "完成" } });
    context.renderTurn(view);
    assert.equal(view.collapsed, false);
    assert.equal(tool.element.open, true);
    assert.equal(tool.element.classList.contains("is-running"), false);
    assert.equal(tool.name.classList.contains("is-running"), false);
    assert.equal(tool.status.textContent, "已中断");
});

test("closing the process pauses detail updates, reopening preserves only explicit expansions", () => {
    const { context } = fixture();
    const turn = context.createTurnState();
    context.applyTurnEvent(turn, { name: "reasoning", data: { replyId: "r", text: "第一段" } });
    const view = context.createTurnView(turn);
    const thinking = [...view.nodes.values()][0];
    thinking.element.open = true; thinking.element.dispatch("toggle");
    assert.equal(thinking.output.raw, "第一段");
    view.toggle.click();
    context.applyTurnEvent(turn, { name: "reasoning", data: { replyId: "r", text: "新增内容" } });
    context.renderTurn(view);
    assert.equal(thinking.output.raw, "第一段");
    view.toggle.click();
    assert.equal(thinking.element.open, true);
    assert.equal(thinking.output.raw, "第一段新增内容");
    thinking.element.open = false; thinking.element.dispatch("toggle");
    context.applyTurnEvent(turn, { name: "reasoning", data: { replyId: "r", text: "继续" } });
    context.renderTurn(view);
    assert.equal(thinking.element.open, false);
    assert.equal(thinking.output.raw, "第一段新增内容");
});

test("thousands of process steps keep at most 40 rows mounted and earlier pages stay stable", () => {
    const { context } = fixture();
    const turn = context.createTurnState();
    const emitTool = i => {
        context.applyTurnEvent(turn, { name: "action", data: { type: "agent.tool.result.end", toolState: "success", toolCallId: `t${i}`, toolName: "read_file", toolInput: { path: `file-${i}.txt` } } });
    };
    for (let i = 0; i < 2400; i++) emitTool(i);
    const view = context.createTurnView(turn);
    assert.equal(view.nodes.size, 40);
    assert.equal(view.body.children.length, 40);
    assert.equal(view.activityStart, 2360);
    const preserved = view.nodes.get("tool::t2390");
    preserved.element.open = true; preserved.element.dispatch("toggle");
    view.pages.previous.click();
    assert.equal(view.activityStart, 2320);
    assert.equal(view.nodes.size, 40);
    emitTool(2400);
    context.renderTurn(view);
    assert.equal(view.activityStart, 2320);
    assert.equal(view.nodes.size, 40);
    view.pages.latest.click();
    assert.equal(view.activityStart, 2361);
    assert.equal(view.body.children.length, 40);
    assert.equal(view.nodes.get("tool::t2390").element.open, true);
    assert.equal(view.nodes.get("tool::t2400").element.open, false);
});

test("parallel tool completion highlights the remaining operation and errors stop every shimmer", () => {
    const { context } = fixture();
    const turn = context.createTurnState();
    const view = context.createTurnView(turn);
    for (const id of ["a", "b"]) context.applyTurnEvent(turn, { name: "action", data: { type: "agent.tool.call.start", toolCallId: id, toolName: "read_file", toolInput: { path: id } } });
    context.applyTurnEvent(turn, { name: "action", data: { type: "agent.tool.result.end", toolCallId: "b", toolState: "success" } });
    context.renderTurn(view);
    assert.equal(view.collapsed, false);
    view.toggle.click();
    assert.equal(view.preview.textContent, "a");
    assert.equal(turn.toolCount, 2);
    view.toggle.click();
    assert.equal(view.nodes.get("tool::a").element.classList.contains("is-running"), true);
    assert.equal(view.nodes.get("tool::b").element.classList.contains("is-running"), false);
    context.applyTurnEvent(turn, { name: "error", data: { message: "连接中断" } });
    context.renderTurn(view);
    assert.equal(view.collapsed, false);
    assert.equal(view.error.textContent, "连接中断");
    for (const node of view.nodes.values()) {
        assert.equal(node.element.open, false);
        assert.equal(node.element.classList.contains("is-running"), false);
        assert.equal(node.name.classList.contains("is-running"), false);
    }
    view.toggle.click();
    assert.equal(view.label.classList.contains("is-running"), false);
    assert.equal(view.label.dataset.text, "执行未完成");
});

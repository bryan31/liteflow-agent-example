import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const appJs = readFileSync(new URL("../../main/resources/static/app.js", import.meta.url), "utf8");

function appContext() {
    const elements = new Map();
    const context = vm.createContext({
        TextDecoder, setTimeout, clearTimeout,
        document: {
            querySelector(selector) {
                if (!elements.has(selector)) {
                    elements.set(selector, {
                        disabled: false,
                        value: "",
                        textContent: "",
                        style: {},
                        setAttribute() {},
                        classList: { toggle() {} },
                    });
                }
                return elements.get(selector);
            },
        },
    });
    vm.runInContext(appJs.slice(0, appJs.lastIndexOf("init().catch")), context);
    return { context, elements };
}

for (const name of ["done", "error"]) {
    test(`${name} ends the request without waiting for the connection or cancellation`, { timeout: 1000 }, async () => {
        const { context } = appContext();
        let cancelled = false;
        const body = new ReadableStream({
            start(controller) {
                const encoder = new TextEncoder();
                // Fragmented UTF-8 and CRLF boundaries are valid transport chunks.
                const bytes = encoder.encode(`event: result\r\ndata: {"text":"收到"}\r\n\r\nevent: ${name}\r\ndata: {}\r\n\r\n`);
                for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
            },
            cancel() {
                cancelled = true;
                return new Promise(() => {});
            },
        });
        const events = [];
        await context.readSse(body, (event) => events.push(event));
        assert.deepEqual(events.map((event) => event.name), ["result", name]);
        assert.equal(events[0].data.text, "收到");
        assert.equal(cancelled, true);
        assert.equal(body.locked, false);
    });
}

test("an unfinished response reports disconnection instead of success", async () => {
    const { context } = appContext();
    const body = new ReadableStream({ start(controller) { controller.close(); } });
    await assert.rejects(context.readSse(body, () => {}), /连接已中断/);
    assert.equal(body.locked, false);
});

test("a malformed event releases the response reader", async () => {
    const { context } = appContext();
    const body = new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode("data: invalid\n\n")); },
    });
    await assert.rejects(context.readSse(body, () => {}));
    assert.equal(body.locked, false);
});

test("users can compose the next prompt during a request without sending it twice", async () => {
    const { context, elements } = appContext();
    const prompt = elements.get("#prompt");
    const send = elements.get("#send-button");
    vm.runInContext('state.activeSessionId = "test-session";', context);
    context.setBusy(true);
    assert.equal(prompt.disabled, false);
    assert.equal(send.disabled, true);
    prompt.value = "下一条消息";
    await context.sendPrompt();
    assert.equal(prompt.value, "下一条消息");
    context.setBusy(false);
    assert.equal(prompt.disabled, false);
    assert.equal(send.disabled, false);
    assert.equal(prompt.value, "下一条消息");
});


test("events are delivered while the response is still open", { timeout: 1000 }, async () => {
    const { context } = appContext();
    let controller;
    const body = new ReadableStream({ start(value) { controller = value; } });
    const events = [];
    let finished = false;
    const reading = context.readSse(body, event => events.push(event));
    reading.then(() => { finished = true; });
    controller.enqueue(new TextEncoder().encode('event: reasoning\ndata: {"text":"第一段"}\n\n'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(events.length, 1);
    assert.equal(events[0].data.text, "第一段");
    assert.equal(finished, false);
    controller.enqueue(new TextEncoder().encode('event: action\ndata: {"toolResult":"输出片段"}\n\n'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(events.length, 2);
    assert.equal(finished, false);
    controller.enqueue(new TextEncoder().encode('event: done\ndata: {}\n\n'));
    await reading;
});

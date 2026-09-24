import { percent, duration, requestError } from './decision-view.mjs';
import { renderResultPanel, setResultState } from './result-panel.mjs';
import { createCatalog } from './scenarios.mjs';

const $ = id => document.getElementById(id);
const form = $('route-form');
const message = $('message');
const category = $('category');
const submit = $('submit-button');
const clear = $('clear-button');
let catalog = null;
let busy = false;
let resultState = 'empty';

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function syncControls() {
    message.disabled = busy || !catalog;
    category.disabled = busy || !catalog;
    submit.disabled = busy || !catalog || !message.value.trim();
    clear.disabled = busy || !message.value;
    document.querySelectorAll('.preset-question, .service-tile').forEach(button => { button.disabled = busy; });
    $('character-count').textContent = message.value.length;
    $('submit-label').textContent = busy ? '正在分流' : resultState === 'error' ? '重新分流' : '开始分流';
    $('submit-arrow').hidden = busy;
    $('submit-spinner').hidden = !busy;
    form.setAttribute('aria-busy', String(busy));
    window.dispatchEvent(new Event('decision-busychange'));
}

function showState(state) {
    resultState = state;
    setResultState($('result-panel'), state);
    syncControls();
}

function updateSelection() {
    document.querySelectorAll('.preset-question').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.message === message.value));
    });
}

function selectQuestion(text) {
    if (busy) return;
    message.value = text;
    $('input-help').textContent = '预设问题已填入，可以编辑后再执行';
    showState('empty');
    updateSelection();
    message.focus({ preventScroll: true });
}

function renderPresets() {
    const services = [...catalog.services, catalog.manual];
    const shown = services.filter(service => category.value === 'all' || service.id === category.value);
    const fragment = document.createDocumentFragment();
    let count = 0;
    for (const service of shown) {
        for (const text of service.presets) {
            const button = element('button', 'preset-question');
            button.type = 'button';
            button.dataset.message = text;
            button.setAttribute('aria-label', `${service.label}：${text}`);
            button.setAttribute('aria-pressed', String(text === message.value));
            button.append(element('span', 'preset-icon', service.code), element('span', 'preset-text', text), element('span', 'preset-arrow', '↗'));
            button.addEventListener('click', () => selectQuestion(text));
            fragment.append(button);
            count++;
        }
    }
    if (!count) fragment.append(element('p', 'loading-copy', '这个选项暂无预设问题，请直接输入客户消息。'));
    $('presets').replaceChildren(fragment);
    $('presets').scrollTop = 0;
    $('preset-count').textContent = count;
    syncControls();
}

async function loadCatalog() {
    $('catalog-error').hidden = true;
    $('reload-catalog').disabled = true;
    try {
        const response = await fetch('/api/support/options');
        if (!response.ok) throw new Error('无法加载客服场景，请确认示例服务已启动。');
        const data = createCatalog(await response.json());
        catalog = data;
        $('model-name').textContent = data.model;
        $('runtime-status').textContent = '可以开始演示';
        $('footer-meta').textContent = `${data.services.length} 类自动服务 · 人工兜底 · 置信度阈值 ${percent(data.minConfidence)}%`;
        category.replaceChildren(new Option('全部场景', 'all'));
        [...data.services, data.manual].forEach(service => category.append(new Option(service.label, service.id)));
        const fragment = document.createDocumentFragment();
        data.services.forEach(service => {
            const button = element('button', 'service-tile');
            button.type = 'button';
            button.setAttribute('aria-label', `选择${service.label}预设问题`);
            button.append(element('span', '', service.code), element('span', '', service.label));
            button.addEventListener('click', () => {
                category.value = service.id;
                renderPresets();
                if (service.presets.length) selectQuestion(service.presets[0]);
                else message.focus({ preventScroll: true });
            });
            fragment.append(button);
        });
        $('service-grid').replaceChildren(fragment);
        renderPresets();
    } catch (error) {
        catalog = null;
        $('catalog-error').hidden = false;
        $('catalog-error-text').textContent = error instanceof TypeError ? '无法连接示例服务，请确认服务已启动。' : error.message;
        $('runtime-status').textContent = '场景加载失败';
        syncControls();
    } finally {
        $('reload-catalog').disabled = false;
    }
}

function renderResult(response, question, elapsed) {
    const view = renderResultPanel($('result-panel'), response, catalog, question, elapsed);
    const processing = duration(response.processingTimeMs);
    $('model-name').textContent = response.decision.model;
    showState('success');
    $('result-status').textContent = response.handledBy === catalog.manual.id ? '已转人工' : '执行完成';
    $('announcement').textContent = `分流完成，进入${view.selected.label}，模型置信度 ${percent(view.confidence)}%，处理时间 ${processing.value} ${processing.unit}。`;
    revealResultOnMobile();
}

function revealResultOnMobile() {
    if (window.matchMedia('(max-width: 820px)').matches) {
        window.scrollTo({ top: $('result-panel').getBoundingClientRect().top + window.scrollY - 80,
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
}

form.addEventListener('submit', async event => {
    event.preventDefault();
    const question = message.value.trim();
    if (busy || !catalog || !question) return;
    busy = true;
    $('loading-elapsed').textContent = '已等待 0.0 s';
    showState('loading');
    $('announcement').textContent = '正在判断客户诉求，请稍候。';
    revealResultOnMobile();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(catalog.timeoutMillis + 4000, 10000));
    const started = performance.now();
    const waiting = setInterval(() => {
        $('loading-elapsed').textContent = `已等待 ${((performance.now() - started) / 1000).toFixed(1)} s`;
    }, 100);
    try {
        const response = await fetch('/api/support/route', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: question }), signal: controller.signal });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(requestError(response.status, body));
        renderResult(body, question, performance.now() - started);
    } catch (error) {
        $('error-message').textContent = error.name === 'AbortError'
            ? '等待服务响应超时，请稍后重试。'
            : error instanceof TypeError ? '无法连接示例服务，请检查本机服务是否仍在运行。' : error.message;
        showState('error');
        $('announcement').textContent = '分流失败，客户消息已保留，可以重试。';
    } finally {
        clearTimeout(timeout);
        clearInterval(waiting);
        busy = false;
        syncControls();
    }
});

message.addEventListener('input', () => {
    $('input-help').textContent = '编辑完成后，点击“开始分流”';
    showState('empty');
    updateSelection();
});
message.addEventListener('keydown', event => {
    if (!event.isComposing && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (!submit.disabled) form.requestSubmit();
    }
});
clear.addEventListener('click', () => {
    message.value = '';
    $('input-help').textContent = '也可以从下方选择一个预设问题';
    showState('empty');
    updateSelection();
    message.focus({ preventScroll: true });
});
category.addEventListener('change', renderPresets);
$('reload-catalog').addEventListener('click', loadCatalog);

function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $('theme-toggle').textContent = theme === 'dark' ? '切换浅色' : '切换深色';
    $('theme-toggle').setAttribute('aria-label', theme === 'dark' ? '切换浅色外观' : '切换深色外观');
}
let theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
try { theme = localStorage.getItem('jev-demo-theme') || theme; } catch { /* Storage can be unavailable in private mode. */ }
setTheme(theme === 'dark' ? 'dark' : 'light');
$('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem('jev-demo-theme', next); } catch { /* The current page still switches theme. */ }
});
loadCatalog();

import { percent, requestError } from './decision-view.mjs';
import { CUSTOM_EXAMPLE, buildCustomRequest, customResultCatalog } from './custom-decision.mjs';
import { cloneResultPanel, renderResultPanel, setResultState } from './result-panel.mjs';

const $ = id => document.getElementById('custom-' + id);
const form = $('form');
const list = $('option-list');
const panel = cloneResultPanel(document.getElementById('result-panel'), 'custom-');
$('result-host').append(panel);
panel.querySelector('.route-summary > .section-caption').textContent = '选中的选项';
panel.querySelector('.message-snapshot > span').textContent = '本次问题';
$('empty-result').querySelector('h3').textContent = '让判断，按你的标准发生。';
$('empty-result').querySelector('p').textContent = '填写问题和选项，运行后在这里查看选择结果、置信度和各选项概率。';
$('service-grid').remove();
$('empty-result').querySelector('.flow-square:last-child').textContent = '选择';
$('empty-result').querySelector('.empty-footer').textContent = '不确定或均不适用时，返回“暂不选择”';
$('loading-result').querySelector('h3').textContent = '正在比较自定义选项';
$('error-result').querySelector('h3').textContent = '这次判断没有完成';
$('error-result').querySelector('.error-hint').textContent = '问题与选项已保留，可以点击“重新判断”再试一次。';
$('reply-title').textContent = '选择结果';
let config = null;
let busy = false;
let resultState = 'empty';
let serial = 0;

function node(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
}

function options() {
    return [...list.querySelectorAll('.option-label-input')].map(input => input.value);
}

function sync() {
    const rows = [...list.querySelectorAll('.option-editor')];
    const max = config?.maxOptions || 8;
    form.querySelectorAll('input, textarea, button').forEach(control => { control.disabled = busy || !config; });
    rows.forEach((row, index) => {
        row.querySelector('.option-letter').textContent = String.fromCharCode(65 + index);
        const remove = row.querySelector('.remove-option');
        remove.disabled = busy || !config || rows.length <= (config?.minOptions || 2);
        remove.setAttribute('aria-label', `删除选项 ${index + 1}`);
        row.querySelector('.option-label-input').setAttribute('aria-label', `选项 ${index + 1}`);
    });
    $('option-count').textContent = rows.length;
    $('add-option').disabled = busy || !config || rows.length >= max;
    $('submit').disabled = busy || !config;
    $('submit-label').textContent = busy ? '正在判断' : resultState === 'error' ? '重新判断' : '开始判断';
    $('submit-arrow').hidden = busy;
    $('submit-spinner').hidden = !busy;
    form.setAttribute('aria-busy', String(busy));
    window.dispatchEvent(new Event('decision-busychange'));
}

function show(state) {
    resultState = state;
    setResultState(panel, state, 'custom-');
    sync();
}

function changed() {
    $('validation-error').hidden = true;
    show('empty');
}

function addOption(option = '') {
    const row = node('div', 'option-editor');
    const header = node('div', 'option-editor-header');
    const letter = node('span', 'option-letter');
    const name = node('input', 'option-label-input');
    name.id = `custom-option-name-${++serial}`;
    name.type = 'text';
    name.maxLength = 80;
    name.required = true;
    name.placeholder = '输入选项，如：功能建议';
    name.value = option;
    const remove = node('button', 'remove-option', '×');
    remove.type = 'button';
    remove.addEventListener('click', () => {
        if (busy || list.children.length <= 2) return;
        row.remove();
        changed();
    });
    header.append(letter, name, remove);
    row.append(header);
    list.append(row);
}

function replaceOptions(values) {
    list.replaceChildren();
    values.forEach(addOption);
    changed();
}

async function loadConfig() {
    $('config-error').hidden = true;
    $('reload-config').disabled = true;
    try {
        const response = await fetch('/api/custom/config');
        if (!response.ok) throw new Error('无法加载自由决策配置，请确认示例服务已更新并启动。');
        const data = await response.json();
        if (!Number.isFinite(data.timeoutMillis) || data.maxOptions !== 8 || data.minOptions !== 2) {
            throw new Error('自由决策配置不完整，请刷新页面。');
        }
        config = data;
        $('model-name').textContent = data.model;
        $('runtime-status').textContent = '可以开始判断';
        $('footer-meta').textContent = `自定义问题与选项 · 置信度阈值 ${percent(data.minConfidence)}%`;
    } catch (error) {
        config = null;
        $('config-error-text').textContent = error instanceof TypeError ? '无法连接示例服务，请确认服务已启动。' : error.message;
        $('config-error').hidden = false;
        $('runtime-status').textContent = '配置加载失败';
    } finally {
        $('reload-config').disabled = false;
        sync();
    }
}

function revealResult() {
    const top = panel.getBoundingClientRect().top;
    if (window.matchMedia('(max-width: 820px)').matches || top < 78 || top > window.innerHeight - 120) {
        window.scrollTo({ top: top + window.scrollY - 80,
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
}

form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !config) return;
    let request;
    try { request = buildCustomRequest($('question').value, options()); }
    catch (error) {
        $('validation-error').textContent = error.message;
        $('validation-error').hidden = false;
        return;
    }
    $('validation-error').hidden = true;
    busy = true;
    $('loading-elapsed').textContent = '已等待 0.0 s';
    show('loading');
    revealResult();
    const started = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(config.timeoutMillis + 4000, 10000));
    const waiting = setInterval(() => {
        $('loading-elapsed').textContent = `已等待 ${((performance.now() - started) / 1000).toFixed(1)} s`;
    }, 100);
    try {
        const response = await fetch('/api/custom/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request), signal: controller.signal });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(requestError(response.status, body));
        const catalog = customResultCatalog(body);
        const view = renderResultPanel(panel, body, catalog, request.question, performance.now() - started, 'custom-');
        $('model-name').textContent = body.decision.model;
        show('success');
        $('result-status').textContent = body.handledBy === catalog.manual.id ? '暂不选择' : '判断完成';
        document.getElementById('announcement').textContent = `判断完成，结果为${view.selected.label}，置信度 ${percent(view.confidence)}%。`;
        revealResult();
    } catch (error) {
        $('error-message').textContent = error.name === 'AbortError' ? '等待服务响应超时，请稍后重试。'
            : error instanceof TypeError ? '无法连接示例服务，请检查本机服务是否仍在运行。' : error.message;
        show('error');
    } finally {
        clearTimeout(timeout);
        clearInterval(waiting);
        busy = false;
        sync();
    }
});

form.addEventListener('input', changed);
form.addEventListener('keydown', event => {
    if (!event.isComposing && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (!busy && config) form.requestSubmit();
    }
});
$('add-option').addEventListener('click', () => {
    if (busy || list.children.length >= 8) return;
    addOption();
    changed();
    list.lastElementChild.querySelector('input').focus({ preventScroll: true });
});
$('load-example').addEventListener('click', () => {
    $('question').value = CUSTOM_EXAMPLE.question;
    replaceOptions(CUSTOM_EXAMPLE.options);
});
$('reset').addEventListener('click', () => {
    $('question').value = '';
    replaceOptions(['', '']);
});
$('reload-config').addEventListener('click', loadConfig);
replaceOptions(['', '']);
loadConfig();

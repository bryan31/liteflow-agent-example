import { percent, duration } from './decision-view.mjs';

const $ = id => document.getElementById('judge-' + id);
const form = $('form');
const question = $('question');
const subject = $('subject');
const submit = $('submit');
const clear = $('clear');
let config = null;
let busy = false;
let resultState = 'empty';

// Presets are page data only; both the standard and the subject travel with the request.
const PRESETS = [
    { question: '客户明确要求人工客服介入', subject: '我已经反馈三次了，能让我和真人说话吗？' },
    { question: '客户有明确的退款意愿', subject: '先别退款了，我再考虑考虑，暂时维持原样。' },
    { question: '消息中包含个人手机号码', subject: '我的订单号是 A-1024，麻烦查一下发货进度。' },
    { question: '这条评价在表达满意', subject: '物流很快，包装也很好，客服回复很及时，下次还会再来。' }
];

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function sync() {
    question.disabled = busy || !config;
    subject.disabled = busy || !config;
    submit.disabled = busy || !config || !question.value.trim() || !subject.value.trim();
    clear.disabled = busy || (!question.value && !subject.value);
    document.querySelectorAll('.judge-preset').forEach(button => { button.disabled = busy; });
    $('character-count').textContent = subject.value.length;
    $('submit-label').textContent = busy ? '正在判断' : resultState === 'error' ? '重新判断' : '开始判断';
    $('submit-arrow').hidden = busy;
    $('submit-spinner').hidden = !busy;
    form.setAttribute('aria-busy', String(busy));
    window.dispatchEvent(new Event('decision-busychange'));
}

function show(state) {
    resultState = state;
    for (const [kind, id] of Object.entries({ empty: 'empty-result', loading: 'loading-result', error: 'error-result', success: 'completed-result' })) {
        $(id).hidden = kind !== state;
    }
    const status = $('result-status');
    status.textContent = { empty: '等待输入', loading: '正在判断', error: '判断失败', success: '判断完成' }[state];
    status.dataset.state = state;
    if (state !== 'success') $('raw-details').open = false;
    sync();
}

function renderPresets() {
    const fragment = document.createDocumentFragment();
    for (const preset of PRESETS) {
        const button = element('button', 'judge-preset');
        button.type = 'button';
        button.setAttribute('aria-label', `判断标准：${preset.question}；内容：${preset.subject}`);
        button.title = preset.subject;
        button.append(element('span', 'preset-icon', 'YN'), element('span', 'preset-text', preset.question), element('span', 'preset-arrow', '↗'));
        button.addEventListener('click', () => {
            if (busy) return;
            question.value = preset.question;
            subject.value = preset.subject;
            $('input-help').textContent = '示例已填入，可以编辑后再执行';
            show('empty');
            question.focus({ preventScroll: true });
        });
        fragment.append(button);
    }
    $('presets').replaceChildren(fragment);
    $('preset-count').textContent = PRESETS.length;
}

async function loadConfig() {
    $('config-error').hidden = true;
    $('reload-config').disabled = true;
    try {
        const response = await fetch('/api/judge/config');
        if (!response.ok) throw new Error('无法加载是非判断配置，请确认示例服务已更新并启动。');
        const data = await response.json();
        if (!Number.isFinite(data.timeoutMillis) || typeof data.noulThreshold !== 'number'
            || data.noulThreshold < 0 || data.noulThreshold > 1) {
            throw new Error('是非判断配置不完整，请刷新页面。');
        }
        config = data;
        $('model-name').textContent = data.model;
        $('runtime-status').textContent = '可以开始判断';
        $('footer-meta').textContent = `是非判断 · 判断阈值 ${percent(data.noulThreshold)}%`;
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
    const panel = $('result-panel');
    const top = panel.getBoundingClientRect().top;
    if (window.matchMedia('(max-width: 820px)').matches || top < 78 || top > window.innerHeight - 120) {
        window.scrollTo({ top: top + window.scrollY - 80,
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
}

function judgeError(status, body) {
    if (body && typeof body.message === 'string' && body.message.trim()) return body.message;
    if (status === 503) return 'Jev 配置不可用，请检查服务端的 API Key 和连接配置。';
    if (status === 502) return 'Jev 调用未成功，可能是超时或服务暂时不可用，请稍后重试。';
    return `判断请求失败（HTTP ${status}），请稍后重试。`;
}

function renderResult(body, elapsed) {
    const decision = body.decision;
    const value = decision?.probability;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1
        || typeof body.executionSteps !== 'string' || typeof body.verdict !== 'boolean') {
        throw new Error('服务没有返回完整的判断结果，请重试。');
    }
    const threshold = body.noulThreshold;
    $('verdict').textContent = body.verdict ? '是' : '否';
    $('verdict-code').textContent = body.verdict ? '是' : '否';
    $('verdict-code').classList.toggle('verdict-no', !body.verdict);
    $('decision-reason').textContent = body.verdict
        ? `成立概率达到 ${percent(threshold)}% 的阈值，进入「是」分支。`
        : `成立概率低于 ${percent(threshold)}% 的阈值，进入「否」分支。`;
    $('probability-value').textContent = percent(value);
    $('threshold-label').textContent = `判断阈值 ${percent(threshold)}%`;
    $('probability-fill').style.setProperty('--probability', value);
    $('probability-text').textContent = `${percent(value)}%`;
    $('submitted-question').textContent = question.value.trim();
    const trace = document.createDocumentFragment();
    body.executionSteps.split('==>').map(step => step.trim()).filter(Boolean).forEach(step => {
        const item = element('li');
        item.append(element('code', '', step));
        trace.append(item);
    });
    $('execution-trace').replaceChildren(trace);
    const processing = duration(body.processingTimeMs);
    $('processing-time-value').textContent = processing.value;
    $('processing-time-unit').textContent = processing.unit;
    const total = duration(elapsed);
    $('elapsed-time').textContent = `端到端 ${total.value} ${total.unit}`;
    $('component-reply').textContent = body.reply;
    $('raw-json').textContent = JSON.stringify(body, null, 2);
    $('model-name').textContent = decision.model;
    show('success');
    document.getElementById('announcement').textContent =
        `判断完成，结论为${body.verdict ? '是' : '否'}，成立概率 ${percent(value)}%。`;
}

form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !config || !question.value.trim() || !subject.value.trim()) return;
    busy = true;
    $('loading-elapsed').textContent = '已等待 0.0 s';
    show('loading');
    document.getElementById('announcement').textContent = '正在判断命题，请稍候。';
    revealResult();
    const started = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(config.timeoutMillis + 4000, 10000));
    const waiting = setInterval(() => {
        $('loading-elapsed').textContent = `已等待 ${((performance.now() - started) / 1000).toFixed(1)} s`;
    }, 100);
    try {
        const response = await fetch('/api/judge/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: question.value.trim(), subject: subject.value.trim() }), signal: controller.signal });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(judgeError(response.status, body));
        renderResult(body, performance.now() - started);
        revealResult();
    } catch (error) {
        $('error-message').textContent = error.name === 'AbortError' ? '等待服务响应超时，请稍后重试。'
            : error instanceof TypeError ? '无法连接示例服务，请检查本机服务是否仍在运行。' : error.message;
        show('error');
        document.getElementById('announcement').textContent = '判断失败，输入已保留，可以重试。';
    } finally {
        clearTimeout(timeout);
        clearInterval(waiting);
        busy = false;
        sync();
    }
});

form.addEventListener('input', () => {
    $('input-help').textContent = '编辑完成后，点击“开始判断”';
    show('empty');
});
form.addEventListener('keydown', event => {
    if (!event.isComposing && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (!submit.disabled) form.requestSubmit();
    }
});
clear.addEventListener('click', () => {
    question.value = '';
    subject.value = '';
    $('input-help').textContent = '也可以从下方选择一个示例';
    show('empty');
    question.focus({ preventScroll: true });
});
$('reload-config').addEventListener('click', loadConfig);
renderPresets();
loadConfig();

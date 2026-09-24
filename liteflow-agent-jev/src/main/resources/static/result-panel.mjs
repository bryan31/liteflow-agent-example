import { decisionView, displayResponse, percent, duration } from './decision-view.mjs';

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export function setResultState(panel, state, prefix = '') {
    for (const [kind, id] of Object.entries({ empty: 'empty-result', loading: 'loading-result', error: 'error-result', success: 'completed-result' })) {
        panel.querySelector('#' + prefix + id).hidden = kind !== state;
    }
    const status = panel.querySelector('#' + prefix + 'result-status');
    status.textContent = { empty: '等待执行', loading: '正在判断', error: '执行失败', success: '执行完成' }[state];
    status.dataset.state = state;
    panel.setAttribute('aria-busy', String(state === 'loading'));
    if (state !== 'success') panel.querySelector('.raw-result').open = false;
}

export function renderResultPanel(panel, response, catalog, question, elapsed, prefix = '') {
    const $ = id => panel.querySelector('#' + prefix + id);
    const view = decisionView(response, catalog);
    $('selected-code').textContent = view.selected.code;
    $('selected-route').textContent = view.selected.label;
    $('decision-reason').textContent = view.reason;
    $('confidence-value').textContent = percent(view.confidence);
    $('threshold-label').textContent = `分流阈值 ${percent(view.threshold)}%`;
    $('submitted-message').textContent = question;
    const fragment = document.createDocumentFragment();
    for (const row of view.rows) {
        const line = element('div', `probability-row${row.selected ? ' selected' : ''}`);
        const track = element('div', 'probability-track');
        track.setAttribute('aria-hidden', 'true');
        const fill = element('div', 'probability-fill');
        fill.style.setProperty('--probability', row.value);
        track.append(fill);
        line.append(element('span', 'probability-label', row.label), track, element('span', 'probability-value', `${percent(row.value)}%`));
        fragment.append(line);
    }
    $('probabilities').replaceChildren(fragment);
    const trace = document.createDocumentFragment();
    view.steps.forEach(step => {
        const item = element('li');
        item.append(element('code', '', step));
        trace.append(item);
    });
    $('execution-trace').replaceChildren(trace);
    const processing = duration(response.processingTimeMs);
    $('processing-time-value').textContent = processing.value;
    $('processing-time-unit').textContent = processing.unit;
    const total = duration(elapsed);
    $('elapsed-time').textContent = `端到端 ${total.value} ${total.unit}`;
    $('component-reply').textContent = response.reply;
    $('raw-json').textContent = JSON.stringify(displayResponse(response), null, 2);
    return view;
}

export function cloneResultPanel(source, prefix) {
    const clone = source.cloneNode(true);
    [clone, ...clone.querySelectorAll('[id]')].forEach(node => { node.id = prefix + node.id; });
    clone.querySelectorAll('[aria-labelledby], [aria-describedby]').forEach(node => {
        for (const name of ['aria-labelledby', 'aria-describedby']) {
            if (node.hasAttribute(name)) node.setAttribute(name, node.getAttribute(name).split(/\s+/).map(id => prefix + id).join(' '));
        }
    });
    setResultState(clone, 'empty', prefix);
    return clone;
}

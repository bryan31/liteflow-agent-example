export const NO_MATCH = '__liteflow_no_match__';

// Keep the protocol marker internal; the page uses a neutral label in its detailed result.
export function displayResponse(response) {
    return { ...response, decision: { ...response.decision,
        choice: response.decision.choice === NO_MATCH ? '均不适用' : response.decision.choice,
        probabilities: Object.fromEntries(Object.entries(response.decision.probabilities)
            .map(([id, value]) => [id === NO_MATCH ? '均不适用' : id, value]))
    } };
}

function probability(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error('服务返回的概率或置信度格式不正确，请重试。');
    }
    return value;
}

export function percent(value) {
    const number = Math.round(probability(value) * 1000) / 10;
    return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

export function duration(milliseconds) {
    if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds < 0) {
        return { value: '—', unit: '' };
    }
    const rounded = Math.round(milliseconds);
    return rounded < 1000
        ? { value: String(rounded), unit: 'ms' }
        : { value: (milliseconds / 1000).toFixed(2), unit: 's' };
}

export function decisionView(response, catalog) {
    const decision = response?.decision;
    if (!decision || !decision.probabilities || typeof decision.probabilities !== 'object'
        || Array.isArray(decision.probabilities) || typeof response.executionSteps !== 'string') {
        throw new Error('服务没有返回完整的执行结果，请重试。');
    }
    const services = new Map([...catalog.services, catalog.manual].map(service => [service.id, service]));
    const selected = services.get(response.handledBy);
    if (!selected) throw new Error('服务返回了未知的处理流程，请刷新页面。');
    const confidence = probability(decision.confidence);
    const threshold = probability(response.minConfidence);
    const rows = Object.entries(decision.probabilities).map(([id, value]) => {
        const label = id === NO_MATCH ? '均不适用' : services.get(id)?.label;
        if (!label) throw new Error('服务返回了未知的候选项，请刷新页面。');
        return { id, label, value: probability(value), selected: id === decision.choice };
    }).sort((left, right) => right.value - left.value);
    if (!rows.some(row => row.selected)) throw new Error('服务返回的选项不在概率分布中，请重试。');
    let reason = '已匹配判断条件，执行对应选项分支。';
    if (response.handledBy === catalog.manual.id) {
        reason = decision.choice === NO_MATCH
            ? `没有合适的候选选项，结果为「${catalog.manual.label}」。`
            : `置信度低于 ${percent(threshold)}% 的阈值，结果为「${catalog.manual.label}」。`;
    }
    return { selected, confidence, threshold, reason, rows,
        steps: response.executionSteps.split('==>').map(step => step.trim()).filter(Boolean) };
}

export function requestError(status, body) {
    if (body && typeof body.message === 'string' && body.message.trim()) return body.message;
    if (status === 503) return 'Jev 配置不可用，请检查服务端的 API Key 和连接配置。';
    if (status === 502) return 'Jev 调用未成功，可能是超时或服务暂时不可用，请稍后重试。';
    return `分流请求失败（HTTP ${status}），请稍后重试。`;
}

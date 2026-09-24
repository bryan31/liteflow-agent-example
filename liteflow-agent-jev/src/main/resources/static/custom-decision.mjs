// Examples are page data only; all actual question and option text is supplied in the request.
export const CUSTOM_EXAMPLE = {
    question: '用户反馈：“希望可以批量导出报表，现在每次只能导出一份，处理月底数据不太方便。”\n\n这条反馈最应该归到哪一类？',
    options: ['功能建议', '故障反馈', '使用咨询']
};

export function buildCustomRequest(question, options) {
    const input = typeof question === 'string' ? question.trim() : '';
    if (!input) throw new Error('请填写问题。');
    if (input.length > 4000) throw new Error('问题最多 4000 字符。');
    if (!Array.isArray(options) || options.length < 2 || options.length > 8) throw new Error('请提供 2～8 个选项。');
    const labels = new Set();
    const normalized = options.map((option, index) => {
        const label = typeof option === 'string' ? option.trim() : '';
        if (!label) throw new Error(`请填写第 ${index + 1} 个选项。`);
        if (label.length > 80) throw new Error('每个选项最多 80 字符。');
        const key = label.toLowerCase();
        if (labels.has(key)) throw new Error('选项不能重复。');
        labels.add(key);
        return label;
    });
    return { question: input, options: normalized };
}

export function customResultCatalog(response) {
    if (!Array.isArray(response?.options) || response.options.length < 2) throw new Error('服务未返回本次候选选项，请重试。');
    return {
        services: response.options.map((option, index) => ({ ...option, code: String.fromCharCode(65 + index) })),
        manual: { id: 'customUndecided', label: '暂不选择', code: '—' }
    };
}

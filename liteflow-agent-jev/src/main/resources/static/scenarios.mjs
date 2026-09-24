// Display labels and example questions belong to the demo page, not the routing backend.
const SCENARIOS = {
    refund: { label: '退款退货', code: 'RF', presets: ['商品不想要了，请给我退款。', '先不要换货了，我还是要退款。'] },
    exchange: { label: '商品换货', code: 'EX', presets: ['暂时先不退了，能不能换一件大一号的？', '不要退款，我只想换成蓝色的。'] },
    logistics: { label: '物流查询', code: 'LG', presets: ['订单三天了还没发货，能帮我催一下吗？', '快递一直停在转运中心，什么时候能送到？'] },
    invoice: { label: '发票办理', code: 'IV', presets: ['这笔订单可以开公司抬头的增值税发票吗？', '发票上的公司名称写错了，麻烦帮我重新开一张。'] },
    complaint: { label: '投诉处理', code: 'CP', presets: ['客服连续三次敷衍我的问题，我要投诉服务态度。', '我对你们的处理很不满意，请让主管联系我。'] },
    consult: { label: '商品咨询', code: 'QA', presets: ['请问退换货需要什么条件？', '货收到了，请问怎么安装？'] }
};
const MANUAL = { id: 'manual', label: '人工协助', code: 'HU', presets: ['你们看着处理吧。', '今天的天气怎么样？'] };

export function createCatalog(info) {
    if (!info?.options || typeof info.options !== 'object' || Array.isArray(info.options)
        || !Object.keys(info.options).length || !Number.isFinite(info.timeoutMillis)) {
        throw new Error('客服选项数据不完整，请重启示例服务。');
    }
    const services = Object.entries(info.options).map(([id, description]) => {
        const scenario = Object.hasOwn(SCENARIOS, id) ? SCENARIOS[id] : null;
        return { id, description, label: scenario?.label || id, code: scenario?.code || id.slice(0, 2).toUpperCase(),
            presets: scenario ? [...scenario.presets] : [] };
    });
    return { model: info.model, minConfidence: info.minConfidence, timeoutMillis: info.timeoutMillis,
        services, manual: { ...MANUAL, presets: [...MANUAL.presets] } };
}

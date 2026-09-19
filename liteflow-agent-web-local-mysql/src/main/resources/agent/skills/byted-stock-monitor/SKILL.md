---
name: "byted-stock-monitor"
description: "A股股票价格查询工具。支持单只/多只股票批量查询价格、涨跌幅、成交量等信息，腾讯财经接口优先，东方财富备用。"
author: volcengine
source: 火山引擎
---

# Stock Monitor (股票查询)

## 功能

查询 A 股股票价格、涨跌幅、成交量等信息，支持单只或多只股票批量查询。

## 接口策略

- **首选：腾讯财经** (`qt.gtimg.cn`) — 速度快、稳定
- **备用：东方财富** (`push2.eastmoney.com`) — 腾讯不通时自动切换

## 目录结构

```
/root/.openclaw/workspace/skills/stock-monitor/
├── SKILL.md              # 本文档
└── scripts/
    └── stock_query.py    # 查询脚本
```

## 用法

```bash
cd /root/.openclaw/workspace/skills/stock-monitor/scripts

# 单只查询 — 详细输出
python3 stock_query.py 000688

# 多只批量查询 — 表格输出
python3 stock_query.py 000688 600519 300750
```

**输出字段：** 名称、当前价、涨跌额、涨跌幅、昨收、今开、最高、最低、成交量、成交额

## A股代码规则

| 前缀 | 交易所 | 示例 |
|------|--------|------|
| `6` 开头 | 上海 | 600519 (贵州茅台) |
| `0` 开头 | 深圳主板 | 000688 (国城矿业) |
| `3` 开头 | 深圳创业板 | 300750 (宁德时代) |

## 注意事项

- 确保脚本具有网络访问权限
- 查询失败时会自动切换备用接口
- 脚本自带的推送功能需要额外配置目标用户，未配置时会输出“正在推送到默认渠道... ⚠️ 未配置目标用户，跳过推送 ❌ 推送失败”的冗余提示，若仅需要查询结果，可通过`grep -A10 "股票名称"`过滤掉冗余输出

## 定时推送使用指南（避免踩坑）

### 常见问题&解决方案
1. **推送内容不完整/只有一个点**：不要直接通过管道传递查询结果到`openclaw message send`，应先将查询结果赋值给变量再传递
2. **参数错误发送失败**：`openclaw message send`命令指定接收人使用`--target`参数，不要误用为`--to`
3. **crontab语法错误**：crontab中定义多行消息内容时，需要对换行符`\n`、变量引用`$`等特殊字符进行转义

### 正确定时推送示例（每2分钟推送国城矿业行情）
```bash
# 添加定时任务
(crontab -l ; echo "*/2 * * * * RESULT=\$(cd /root/.openclaw/workspace/skills/stock-monitor/scripts && python3 stock_query.py 000688 2>&1 | grep -A10 \"国城矿业\") && openclaw message send --channel feishu --target user:你的用户ID --message \"🦐 国城矿业（000688）最新实时行情：\n\${RESULT}\"") | crontab -
```

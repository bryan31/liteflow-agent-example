# Jev 售后分流示例

这个示例提供一个客服分流页面，通过 `JevSwitchComponent` 判断客户诉求，返回目标组件 ID，再由 LiteFlow 执行对应服务组件。支持退款、换货、物流、发票、投诉、咨询 6 类自动分流，以及人工兜底。它只展示分流，不执行实际退款或创建外部工单。页面右上角可以翻转切换到自由决策，使用独立的 Jev 组件和 chain 判断自定义问题与选项。

需要 JDK 17 和 Jev API Key，无需数据库、Docker 或其他聊天模型凭据。已使用官方接口完成 14 条预设中文样本的冒烟验证；阈值 `0.6` 是起始示例值，这组样本不代表生产准确率。

在 LiteFlow 源码根目录先安装新模块及 Spring Boot 4 集成：

```bash
mvn -pl liteflow-agent/liteflow-agent-jev,liteflow-agent/liteflow-agent-core,liteflow-spring-boot4-starter -am clean install -DskipTests
```

在本示例仓库根目录编译：

```bash
mvn -pl liteflow-agent-jev-switch -am clean package -DskipTests
```

准备好凭据后再启动：

```bash
export JEV_API_KEY='填写你的 Jev API Key'
mvn -pl liteflow-agent-jev-switch spring-boot:run
```

也可以把凭据写入模块的 `src/main/resources/application-local.yml`，该文件已被仓库忽略：

```yaml
liteflow:
  agent:
    jev:
      api-key: "填写你的 Jev API Key"
      base-url: https://api.typesafe.ai/v1
      model: jev-1.13.0
      timeout: 3s
      min-confidence: 0.6
```

`base-url` 包含 `/v1`，客户端追加 `/systemone`。也可使用 `JEV_BASE_URL`、`JEV_MODEL`、`JEV_TIMEOUT` 和 `JEV_MIN_CONFIDENCE` 环境变量覆盖默认值。

启动后打开 [客服分流页面](http://localhost:8906/)。页面支持：

- 输入客户消息，或按服务场景筛选并选择 14 条预设问题；选择预设只填入文本，点击“开始分流”才调用模型。
- 使用 `Ctrl + Enter` 或 `⌘ + Enter` 提交，清空输入，切换浅色与深色外观。
- 查看实际执行分支、模型置信度、分流阈值、各选项概率、执行路径、醒目的服务端处理时间、端到端耗时与组件回复。
- 区分“没有合适选项”与“低置信度”触发的人工兜底，并展开详细 JSON 结果；内部的均不适用标识显示为“均不适用”，HTTP API 仍返回原始标识。
- 在手机宽度下使用单列布局；运行完成后自动定位执行结果。
- 调用失败时保留输入并显示重试入口，不会将故障伪装成人工分流成功。

结果顶部的“处理时间”由服务端使用单调时钟测量，包含 Jev 网络调用与 LiteFlow 流程执行，不是模型纯推理时间；“端到端”从浏览器发起请求计到完整响应读取完毕。等待过程中实时显示已等待秒数。

页面不接收或保存 API Key，凭据仍只在服务端配置。`SupportRouter.choices()` 直接定义候选 ID 和判断说明，`GET /api/support/options` 只返回这些选项及模型、阈值、超时配置，不返回预设问题或凭据。页面的显示名称、缩写和 14 条预设消息维护在前端 `scenarios.mjs` 中；仅展示后端当前支持选项的预设。

也可以直接提交 HTTP 请求：

```bash
curl -X POST http://localhost:8906/api/support/route \
  -H 'Content-Type: application/json' \
  -d '{"message":"这东西我暂时不退了，能不能先给我换一件？"}'
```

响应中的 `handledBy` 是实际执行的组件 ID，`decision.choice` 是模型原始选项，`decision.confidence` 和 `decision.probabilities` 保留原始评分，`decision.model` 是实际模型版本。`executionSteps` 展示 LiteFlow 执行路径。

低置信度或均不适用会进入 `manual`。鉴权失败、限流、超时或非法响应返回 HTTP 502；缺少有效配置返回 HTTP 503，不会伪装成人工分支成功。`message` 为空返回 HTTP 400。

2026-09-20 使用官方 `https://api.typesafe.ai/v1`、`jev-1.13.0`、超时 `3s` 和阈值 `0.6` 实测，14 条预设消息全部返回 HTTP 200，实际分支全部符合预期。该批请求端到端耗时为 280～380 毫秒；这是小样本冒烟结果，不是性能基准。

| 页面服务 | 组件 | 预设问题示例 |
| --- | --- | --- |
| 退款退货 | `RefundCmp` | 先不要换货了，我还是要退款。 |
| 商品换货 | `ExchangeCmp` | 不要退款，我只想换成蓝色的。 |
| 物流查询 | `LogisticsCmp` | 订单三天了还没发货，能帮我催一下吗？ |
| 发票办理 | `InvoiceCmp` | 发票上的公司名称写错了，麻烦帮我重新开一张。 |
| 投诉处理 | `ComplaintCmp` | 客服连续三次敷衍我的问题，我要投诉服务态度。 |
| 商品咨询 | `ConsultCmp` | 请问退换货需要什么条件？ |
| 人工协助 | `ManualCmp` | 你们看着处理吧。 |

两条人工样本由模型选择“均不适用”触发；低置信度分流由离线测试验证，本次样本没有触发该条件。

核心文件：

- [页面入口](src/main/resources/static/index.html)：输入、预设问题和执行结果。
- [scenarios.mjs](src/main/resources/static/scenarios.mjs)：前端显示名称和预设问题，可独立修改。
- [SupportRouter.java](src/main/java/com/yomahub/liteflow/examples/jev/cmp/SupportRouter.java)：输入、选择指令、目标描述及决策回调。
- [flow.el.xml](src/main/resources/flow.el.xml)：现有 SWITCH 语法编排。
- [SupportController.java](src/main/java/com/yomahub/liteflow/examples/jev/SupportController.java)：每次请求创建独立流程上下文。

所有新增组件测试保存在 LiteFlow 源码仓库的 `liteflow-testcase-el/liteflow-testcase-el-agent-jev`，使用本地 HTTP 服务，不依赖真实凭据。Spring Boot 2／4 的配置绑定测试也位于 `liteflow-testcase-el`。本次官方调用的完整响应保存在该测试模块的 `target/jev-customer-ui-live-validation.json`，该文件是本地验证产物，不随源码提交，也不包含 API Key。


前端结果处理、场景组装及自由表单的 19 个离线测试同样位于 LiteFlow 源码仓库。在该仓库根目录执行：

```bash
node --test liteflow-testcase-el/liteflow-testcase-el-agent-jev/src/test/js/decision-view.test.mjs
```

默认从同级 `liteflow-agent-example` 仓库读取页面模块；目录不同可通过 `JEV_DEMO_STATIC` 指定该示例的 `src/main/resources/static` 绝对路径。测试验证置信度与概率分离、人工兜底解释、阈值、非法结果和错误提示。


## 自由决策页面

点击右上角“切换到自由决策”按钮，页面以 3D 翻转效果切换。两个页面保留各自的输入和结果，请求进行中暂时禁用切换；系统开启减少动画时直接切换。

自由页只需填写问题和选项：

- **你的问题**：问题和背景写在同一个输入框中，最多 4000 字符。
- **候选选项**：2～8 个，可添加和删除。每个选项只有一个输入框，不能为空或重复，最多 80 字符。

“填入示例”只从前端加载一组用户反馈分类示例，不会自动调用模型。点击“开始判断”或使用 `Ctrl + Enter`／`⌘ + Enter` 后，查看选中项、概率分布、置信度、耗时和执行路径。低置信度或均不适用时返回“暂不选择”。

自由决策使用自己的后端入口：

- `CustomDecisionController`：`GET /api/custom/config` 和 `POST /api/custom/evaluate`。
- `CustomDecisionRouter`：独立继承 `JevSwitchComponent`，从本次上下文读取问题和选项。
- `CustomDecisionContext`：每次请求的独立输入和结果。
- `CustomDecisionTargets`：8 个固定候选分支与 `customUndecided` 兜底分支。

独立的 chain 定义在 `flow.el.xml` 中：

```text
SWITCH(customDecisionRouter)
    .to(customOption1, customOption2, customOption3, customOption4,
        customOption5, customOption6, customOption7, customOption8)
    .DEFAULT(customUndecided);
```

chain ID 为 `customDecision`。用户自定义问题与选项文本，后端按照顺序映射到固定分支 ID，不动态创建 EL 或执行用户传入的组件 ID。页面中的例子仍只在前端 `custom-decision.mjs` 维护。

请求格式：

```json
{
  "question": "用户希望可以批量导出报表，现在每次只能导出一份。这条反馈最应该归到哪一类？",
  "options": ["功能建议", "故障反馈", "使用咨询"]
}
```

## 自由决策 HTTP 集成测试

所有测试仍位于 LiteFlow 源码仓库的 `liteflow-testcase-el/liteflow-testcase-el-agent-jev` 中。先打包本示例，再在 LiteFlow 源码仓库根目录运行：

```bash
python3 liteflow-testcase-el/liteflow-testcase-el-agent-jev/src/test/python/custom_decision_contract.py
```

脚本使用 Python 标准库、Java 17+ 和已经打包的示例 JAR，在临时端口启动示例与本地 Jev 模拟服务。它通过运行时配置覆盖模型地址和凭据，不使用真实 API Key，结束后自动停止测试进程。可通过 `JEV_EXAMPLE_JAR` 指定其他位置的示例 JAR，通过 `JAVA_HOME` 指定 Java。

10 个集成测试覆盖自定义请求内容、独立执行链、2／8 个选项边界、非法输入、低置信度和均不适用、技术故障、并发隔离，以及原客服 chain 的回归验证。

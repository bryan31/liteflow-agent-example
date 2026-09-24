# liteflow-agent-jev

Jev 类型化决策组件的独立演示，不需要数据库、Docker 或聊天模型凭据。三个翻转演示页对应三种用法：

| 页面 | 组件 | Jev 原语 | LiteFlow 构造 |
| --- | --- | --- | --- |
| 客服分流 | `JevSwitchComponent` | Choice | `SWITCH(supportRouter).to(...).DEFAULT(manual)` |
| 是非判断 | `JevBooleanComponent` | Noul | `IF(statementJudge, judgeYes, judgeNo)` |
| 自由决策 | `JevSwitchComponent` | Choice | `SWITCH(customDecisionRouter).to(...)`，选项由请求动态给出 |

是非判断页输入“判断标准”和“判断内容”：标准作为 Noul 的 instructions，内容作为 state；返回“是”的概率，达到 `liteflow.agent.jev.noul-threshold`（默认 0.5）进入「是」分支，否则进入「否」分支。

## 运行

需要 JDK 17 和 Jev API Key（支持 TypeSafe 官方接口与 OpenRouter，见 `application.yml`）：

```bash
export JEV_API_KEY='填写你的 Jev API Key'
mvn -pl liteflow-agent-jev spring-boot:run
```

访问 [http://localhost:8906](http://localhost:8906)。也可以在 `src/main/resources/application-local.yml` 中填写 `liteflow.agent.jev.api-key`，该文件已被 Git 忽略。

如果本地 Maven 仓库没有对应版本的 LiteFlow，先在 LiteFlow 源码仓库执行：

```bash
mvn install -pl liteflow-agent/liteflow-agent-jev,liteflow-spring-boot4-starter -am -DskipTests
```

## 接口

- `GET /api/support/options`、`POST /api/support/route`：客服分流，`message` 为客户消息。
- `GET /api/custom/config`、`POST /api/custom/evaluate`：自由决策，`question` + 2～8 个 `options`。
- `GET /api/judge/config`、`POST /api/judge/evaluate`：是非判断，`question` 为判断标准，`subject` 为判断内容。

三个接口都在响应中返回模型版本、概率或置信度、执行路径和服务端耗时；调用失败时区分 Jev 服务错误（502）与配置错误（503）。

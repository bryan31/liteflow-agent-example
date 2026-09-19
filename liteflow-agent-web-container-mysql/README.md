# liteflow-agent-web-container-mysql

这是从原 Web 示例抽取的独立模块，组合了：

- `HarnessAgentComponent` Docker 沙箱；
- 配置驱动的 classpath Skill；
- AgentScope 2 类型化 `AgentEvent` 流；
- 沙箱工具权限白名单；
- MySQL 会话状态持久化；
- 默认关闭每轮自动记忆提取，会话上下文和历史仍正常保存；
- LiteFlow chain 与浏览器聊天界面。

## 运行

```bash
# 在 LiteFlow 源码仓库中执行一次：
./liteflow-agent/docker/sandbox/build.sh

# 回到示例仓库：
docker compose -f liteflow-agent-web-container-mysql/docker-compose.yml up -d
mvn -pl liteflow-agent-web-container-mysql spring-boot:run
```

访问 [http://localhost:8900](http://localhost:8900)。Skill 已打包在 `classpath:agent/skills`，并通过
`liteflow.agent.skills.path` 配置加载，无需在 Agent 组件中创建或管理 Repository。
默认供应商为 DeepSeek，模型为 `deepseek-flash`。在模块内的
`src/main/resources/application-local.yml` 中填写 API Key；该文件已被 `.gitignore` 排除。

```yaml
liteflow:
  agent:
    openai-compatible:
      deepseek:
        api-key: "填写你的 DeepSeek API Key"
        base-url: https://api.deepseek.com/v1
example:
  agent:
    model: deepseek-flash
```

## AgentScope 2 实现要点

- `SkillStreamAgentCmp` 继承 `HarnessAgentComponent`。
- Skill Repository 由 LiteFlow 根据配置自动创建、托管和关闭。
- 所有命令与文件操作都在使用 `bridge` 网络的 Docker 沙箱中执行。
- LiteFlow 源码中的 `liteflow-agent/docker/sandbox/Dockerfile` 基于 Node.js 22，并预装
  Python 3、pip/venv、curl、wget、Git、jq、ripgrep、常用网络诊断、压缩与本地构建工具；
  容器内默认使用非 root 的 `node` 用户。
- `pip install` 默认写入 `/opt/venv`，`npm install -g` 默认写入用户目录；新增系统包应修改
  Dockerfile 并重建镜像，而不是在运行中的沙箱里提权安装。
- `ChatEventMapper` 读取 AgentScope 2 类型化事件，不依赖 1.x 的粗粒度事件常量。
- Web 会话 ID 会作为 `conversationId`，Agent 状态持久化到 MySQL 的 `agentscope_sessions` 表。
- 模型使用 `DeepSeek.of(modelName)`，默认 `deepseek-flash`，可通过 `example.agent.model` 覆盖。
- Agent 上下文和 Web 历史写入 `agentscope_sessions`；记忆、Harness 归档和业务文件快照写入同库的 `agentscope_sessions_workspace`。
- MySQL 模式不需要 `agent-workspaces`、`sandbox-snapshots`。可选 `harness.local.workspace-root` 仅提供静态投影输入（包括技能）。容器不保存 Agent 会话记录和记忆。
- 同一实例连续聊天复用容器，每轮将业务文件快照提交到 MySQL，空闲后回收容器；换实例或回收后从 MySQL 恢复。
- 旧会话若仍引用本地 tar，首次续聊时自动导入 MySQL，原 tar 保留；第一次迁移需能访问原文件。
- Docker 启动参数包含 `--init`，让空闲 shell 正常接收停止信号，避免每轮回答后等待 30 秒强制退出。更新框架后需重新安装 `liteflow-agent-core` 并重启应用。
- 本示例启用 `liteflow.agent.harness.docker.lifecycle=SESSION_IDLE`：同一会话连续对话复用容器，完整调用结束后空闲 10 分钟才保存快照并回收，每 30 秒扫描一次。每个 Agent 组件最多缓存 8 个容器，达到上限时优先回收最久未使用的空闲容器。
- 删除会话、正常关闭应用时也会释放缓存容器。工作区文件可从快照恢复，进程和工作区之外的安装目录不会被快照保存。缓存只属于本 JVM，多实例部署需要会话固定路由。
- 框架默认仍为 `PER_CALL`。切换回该值可恢复每轮销毁；启用 `SESSION_IDLE` 时必须保留持久化快照配置。最近未做快照的文件修改在异常宕机时可能丢失。
- 回答期间可以继续编辑下一条消息；当前请求完成后恢复发送。页面收到 SSE `done` 或 `error` 即结束读取，不额外等待 HTTP 连接关闭。
- 页面中的会话标题、消息列表和会话已加载 Skill 由 `liteflow-agent-core` 的 `AgentConversationService` 保存，复用 `liteflow.agent.session-store` 配置；默认写入 MySQL 的 `agentscope_sessions` 表。浏览器会记住最近选中的会话，刷新后从框架服务读取历史。

### 会话 API

示例通过 `@Import(AgentConversationConfiguration.class)` 注册会话服务。`ChatSessionStore` 只保留 HTTP DTO 转换和标题展示逻辑，持久化、分页查询和关联 Agent 状态清理由框架完成。

- `GET /api/chat/sessions`：会话摘要列表。
- `GET /api/chat/sessions/{sessionId}`：保持原有完整会话返回结构，供现有页面使用。
- `GET /api/chat/sessions/{sessionId}/sandbox`：查询当前会话在本服务实例上的 Docker 沙箱状态，返回 `Cache-Control: no-store`；会话不存在或已删除时返回 404。
- `GET /api/chat/sessions/{sessionId}/messages?cursor=0&limit=50`：框架的分页消息接口；下一页传入返回的 `nextCursor`，单页上限 200。
- `DELETE /api/chat/sessions/{sessionId}`：删除展示记录与已登记的 Agent 状态。等待执行结束后清理，迟到的结果不会恢复会话。

框架默认开启会话历史记录，并自动登记参与会话的 Agent，示例无需额外配置。创建会话时设置 `recordAgentMessages=false`，然后通过框架的 `append(...)` 记录用户输入、执行轨迹和最终答复，避免重复保存内部 Agent 消息。后端存取使用配置中的 `runtime.default-user-id`，与组件执行身份一致；这个单用户示例尚未提供登录认证，多用户应用应从可信的登录信息解析 userId。

首次使用会导入旧 `liteflow-web-ui` 用户下的 `chat_session` 数据，保留原消息 ID、时间和已加载 Skill。迁移可以重复执行，删除后的会话不会重新导入。旧记录保留为备份，不再参与页面读取；可在确认迁移后按自己的保留策略归档。工作区文件、沙箱快照及长期记忆不随会话删除。

框架的 `agentState(userId, conversationId, agentKey)` 还可以直接读取旧 Core／Harness 会话的当前上下文，无需模型或 Docker。当前上下文可能已压缩；页面历史使用独立消息记录，不依赖该上下文。

MySQL 连接在 `application.yml` 中直接修改。主配置支持 `DEEPSEEK_API_KEY`、
`DEEPSEEK_BASE_URL` 和 `DEEPSEEK_MODEL` 环境变量；`application-local.yml` 中显式填写的值优先于主配置中的占位符。测试
不会启动 Docker、MySQL 或访问 DeepSeek；真实运行需要可用的 Docker Engine、MySQL、镜像和模型凭证。

### 可选的真实 Web 验收

`src/test/python/web_live_acceptance.py` 会启动真实应用，通过 HTTP 创建会话、调用模型、读取历史，随后重启应用并验证 Harness 记忆和聊天记录，再验证分页与删除。脚本只使用随机测试 namespace 和新建会话；退出时关闭自己启动的应用进程，日志保留在 `target/web-live-acceptance-*`。

前置条件是 JDK 17+、Maven、Python 3、Docker、本地 `liteflow-agent-sandbox:node22` 镜像，以及供测试使用的 MySQL（`127.0.0.1:13306`，数据库 `liteflow`，用户 `root`，测试密码 `root123456`）。脚本使用独立的 `web_release_check` 表，默认 HTTP 端口为 18906，可通过 `--port` 修改。

先按当前源码将 LiteFlow Agent 工件安装到本地 Maven 仓库，然后在本模块运行：

```bash
python3 src/test/python/web_live_acceptance.py --env-file /path/to/env.txt
```

凭据读取 `LITEFLOW_AGENT_TEST_API_KEY`、`LITEFLOW_AGENT_TEST_BASE_URL`、`LITEFLOW_AGENT_TEST_MODEL`，环境变量优先于文件；不会把密钥放进命令行。验收脚本会发起真实模型请求，仅在显式运行时执行，不参与默认构建或普通单测。


### 聊天界面与流式事件

顶部的“容器”状态可展开查看容器 ID、名称、镜像、任务是否正在执行、最后活动时间和查询时间。执行期间每 3 秒查询一次，空闲时每 10 秒查询一次，也可手动刷新；切换会话会清除旧状态，隐藏页面暂停查询。它与聊天请求的“处理中／就绪”分别显示。

容器状态来自 `liteflow-agent-core` 的 `AgentSandboxStatusService`，通过只读 Docker 查询核实，不会启动容器或延长空闲时间。`RUNNING` 表示物理容器运行，`busy` 表示 Agent 正在使用它；快照保存后仍可能是“运行中、空闲”。查询失败显示“状态未知”，不会保留之前的绿色运行状态。`NOT_ALLOCATED` 表示当前 JVM 没有登记该会话的容器，包括尚未创建或已经回收；返回的 `scope` 为 `PROCESS_LOCAL`，多实例部署需要把查询路由到会话执行实例。

安装最新 `liteflow-agent-core` 后，需要重启示例后端并刷新页面才能使用新接口。

界面采用紧凑侧栏、居中对话、灰阶浅色／深色外观和底部输入框。可搜索历史会话、展开思考与工具详情、复制回答；阅读历史时，新事件不会强制把页面滚回底部。回答期间仍可以编写下一条消息。

点击会话后立即切换标题和选中状态，消息区先展示骨架加载效果，再异步展示后端返回的内容。加载期间可继续输入或切换会话，内容准备好后才允许发送；快速切换会取消旧请求，并丢弃迟到的旧响应。加载失败或超过 30 秒时显示“重新加载”按钮。

- `agent.thinking.delta` 显示模型实际返回的思考文本；模型未提供时不会生成虚构的思考内容。
- `agent.text.delta` 立即渲染普通回复与进度说明；最终结果到达后，最后一段回复移出过程区域，避免重复展示。
- 工具参数和输出按增量追加，以 `nodeId + toolCallId` 关联。AgentScope 的工具调用与工具结果可以拥有不同的 `replyId`，不能用消息 ID 将它们拆开。
- 工具开始、执行和结束状态实时显示。输出的更新频率由工具决定；当前 Docker `execute` 在命令结束后返回完整 stdout，界面不会用打字动画伪造逐行输出。
- SSE 响应设置 `Cache-Control: no-cache, no-transform` 和 `X-Accel-Buffering: no`。额外部署反向代理时，也应确保代理允许 SSE 实时转发。

前端状态归并和流式读取回归：

```bash
node --test liteflow-agent-web-container-mysql/src/test/js/*.test.mjs
```

旧会话轨迹会通过同一套渲染逻辑回放，无需迁移数据。修改后的页面刷新即可加载；增加事件字段与响应头的后端修改需要重启应用。


使用本地模拟模型、真实 HTTP 和 Docker 验收流式时序（需要 JDK 17+、Maven 和本地沙箱镜像）：

```bash
python3 liteflow-agent-web-container-mysql/src/test/python/web_stream_acceptance.py
# 保留独立应用供浏览器验收，按 Enter 关闭
python3 liteflow-agent-web-container-mysql/src/test/python/web_stream_acceptance.py --keep-running
```

脚本默认端口为 `18927`，可以通过 `--port` 修改；创建一次性 MySQL 8.4 容器、独立命名空间和测试会话，不访问真实模型或现有 MySQL 会话。需要本地 `mysql:8.4` 镜像，退出时清理测试数据库和沙箱。会检查思考、文本和工具事件在整轮完成前到达，同时验证容器从未分配到运行中、任务结束后空闲的状态，保存状态快照、事件时间线与应用日志到 `target/chat-stream-ui-check-*`。

聊天布局浏览器回归（不需要模型或 Docker）：

```bash
python3 liteflow-agent-web-container-mysql/src/test/python/web_layout_fixture.py
```

在 Chrome 打开脚本输出的地址。页面使用真实的 HTML、CSS、流式状态与渲染代码，自动检查普通回答、长工具输出、异常结束、桌面／手机和历史回放，完成后应显示 `6/6 passed`。用例会断言消息轨道宽度、输入框位置以及完成后回答的可见性，防止长日志撑宽 CSS Grid 的隐式列。

### 每轮自动记忆提取配置

框架和 Web 示例均默认关闭每轮自动记忆提取。`liteflow.agent.harness.memory` 下的 `flush-mode` 默认值为 `NEVER`，`flush-min-gap` 默认值为 `5m`，示例直接使用默认值，无需显式配置。需要调整记忆提取策略时，再按需添加相应配置。

`ALWAYS` 表示每轮提取，`NEVER` 表示关闭每轮提取，`THROTTLED` 表示按 `flush-min-gap` 限制触发频率。修改后重启应用生效。这个开关不影响上下文和会话历史保存，也不关闭手动记忆工具、上下文压缩或已有记忆整理。


## AgentScope 2.0.3 与生成文件

本示例使用 LiteFlow 2.16.2、AgentScope 2.0.3。LiteFlow Agent 尚未正式发布时，需要先在 LiteFlow 源码仓库安装本轮升级后的包，再构建示例；仅使用旧的同版本本地 JAR 不会更新其实现。

在 LiteFlow 源码根目录执行：

```bash
mvn install -pl liteflow-agent/liteflow-agent-core,liteflow-agent/liteflow-agent-openai,liteflow-agent/liteflow-agent-mysql,liteflow-spring-boot4-starter -am -DskipTests
```

然后使用 JDK 17 在示例根目录执行 `mvn clean package`。

可以提问：“生成一份示例销售数据 CSV，包含商品、数量和金额，并交付文件。” Agent 使用 `deliver_artifact` 后，聊天中会出现下载入口；附件事件保存在聊天记录中，刷新或重启后仍可下载。

- 产物字节保存在现有 MySQL 工作区表中，使用独立的 `artifacts-v1` 命名空间；没有新增本地状态目录。
- 文件按应用命名空间、配置的用户 ID 和会话 ID 隔离；同会话同名文件默认报冲突，工具可显式设置 `force=true` 覆盖。
- 附件不设置文件大小上限，沿用当前会话的存储后端。
- 下载接口为 `GET /api/chat/sessions/{sessionId}/artifacts/{artifactId}`，返回附件下载；删除会话同时清除产物。
- 本示例仍是使用配置中默认用户的单用户应用；接入登录系统时，聊天和下载两条路径都应使用服务端认证的用户身份。

新增的离线测试覆盖官方交付工具读取文件、保存和重开读取、同名冲突、覆盖、用户／会话隔离、大小限制、下载响应与删除。它们不调用模型；真实模型生成文件仍需启动 MySQL、Docker 并配置模型凭据。

## 统一的 Shell 开关与默认命令

`enableShellTool()` 默认返回 `true`，不需要覆盖方法或填写命令白名单就能使用容器内的 `execute`。Docker 不会自动注册宿主机的 `execute_shell_command`。若组件显式返回 `false`，容器内置命令工具也会关闭：

```java
@Override
protected boolean enableShellTool() {
    return false;
}
```

`harness.shell.mode` 默认是 `WHITELIST`，默认命令包含 `sh`、`bash`、`python3`、`node`、`git`、`npm`、`mvn` 和常用文件、文本处理命令。`harness.shell.whitelist` 可省略；自定义列表替换默认值，显式空列表会被拒绝。脚本解释器需要安装在镜像中。

Docker 命令仍在 `harness.docker.workspace-root` 指定的容器目录执行。顶层多命令拼接受校验器限制；多步任务可写成脚本，或通过默认允许的 `sh -c` 执行。`harness.shell.timeout` 默认 1 分钟，示例无需显式配置，模型传入的超时不能超过该上限。

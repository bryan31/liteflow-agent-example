# LiteFlow Agent 示例

这个项目从 `liteFlow-react-agent-example` 中独立抽取 Web 示例，以 Maven 多模块项目组织，构建时不再依赖原示例项目的父 POM。

| 模块 | 启动类 | 功能 |
| --- | --- | --- |
| [liteflow-agent-web-container-mysql](liteflow-agent-web-container-mysql/README.md) | `ContainerMysqlAgentApplication` | Web 聊天界面、流式事件、Skill、Docker 沙箱和 MySQL 会话持久化 |
| [liteflow-agent-web-container-redis](liteflow-agent-web-container-redis/README.md) | `ContainerRedisAgentApplication` | 相同 Web 界面与 Docker 沙箱，Redis 保存会话、记忆、快照和附件，端口 8901 |
| [liteflow-agent-web-container-json](liteflow-agent-web-container-json/README.md) | `ContainerJsonAgentApplication` | 相同 Web 界面与 Docker 沙箱，本地 JSON 保存会话和附件，本地目录保存记忆与快照，端口 8902 |
| [liteflow-agent-web-local-mysql](liteflow-agent-web-local-mysql/README.md) | `LocalMysqlAgentApplication` | Agent 在宿主机执行，Docker Compose 启动 MySQL 保存会话、工作区文件、记忆与附件，端口 8903 |
| [liteflow-agent-web-local-redis](liteflow-agent-web-local-redis/README.md) | `LocalRedisAgentApplication` | Agent 在宿主机执行，Docker Compose 启动 Redis 保存会话、工作区文件、记忆与附件，端口 8904 |
| [liteflow-agent-web-local-json](liteflow-agent-web-local-json/README.md) | `LocalJsonAgentApplication` | Agent 在宿主机执行，本地 JSON 与目录保存数据，无需数据库或 Docker，端口 8905 |
| [liteflow-agent-jev](liteflow-agent-jev/README.md) | `JevApplication` | 客服分流、是非判断与自由决策三个翻转页面、14 条客服预设、可自定义问题、选项和判断标准，展示置信度、概率和执行路径，端口 8906 |

各模块均包含完整源码，可独立构建和运行。六个 Web 聊天示例之外，Jev 示例提供独立的客服分流、是非判断与自由决策页面及 HTTP 接口，支持 Jev 官方接口与 OpenRouter。官方入口配置 `JEV_API_KEY`；OpenRouter 入口启用 `openrouter` profile 并配置 `OPENROUTER_API_KEY`，无需数据库、Docker 或聊天模型凭据。三个 `web-container-*` 模块的 HTML、CSS、前端脚本与 MySQL 示例一致，包括会话搜索、历史加载、深浅色切换、流式思考与工具详情、容器状态和附件下载。

各模块通过 `spring.application.name` 声明模块名。框架的 `liteflow.agent.application-name` 默认沿用该名称隔离 Agent 数据，`liteflow.agent.execution-timeout` 默认是 10 分钟；示例省略这两项 Agent 配置。

## 环境

- JDK 17、Maven。
- LiteFlow `2.16.3`、Spring Boot `4.0.6`，版本统一在根目录 `pom.xml` 管理。
- `web-container-*` 模块运行需要 Docker、`liteflow-agent-sandbox:node22` 镜像和 DeepSeek API Key，默认模型为 `deepseek-flash`。MySQL／Redis 模块另需对应数据库，JSON 模块无需数据库。
- `web-local-*` 模块使用 `GUARDED_LOCAL`，Agent 在宿主机执行，无需沙箱镜像。MySQL／Redis 默认使用各模块提供的 Docker Compose 启动，也可连接已有服务；`local-json` 无需 Docker。所有 HarnessAgentComponent 组件的 `enableShellTool()` 默认返回 `true`；三个本地模块已配置固定的 `harness.local.workspace-root`，支持宿主机 Shell／Python／Node、文件工具与附件交付，默认禁用子 Agent。

如果 LiteFlow 依赖尚未发布到配置的 Maven 仓库，需要先从 LiteFlow 源码构建并安装相应版本到本地 Maven 仓库。

## 命令工具默认开启

统一使用 `HarnessAgentComponent`，`enableShellTool()` 默认返回 `true`。本地与 Docker 模式都提供 `execute`，文件工具使用同一套会话相对路径。Skill 的完整说明和资源准备到当前会话工作区，生成文件由所选 JSON／MySQL／Redis 存储保存。

本地执行位置配置为 `liteflow.agent.harness.local.workspace-root`，Docker 执行位置配置为 `liteflow.agent.harness.docker.workspace-root`。工作区目录自动创建，框架不设置文件大小上限。JSON 工作区记录目录独立配置为 `liteflow.agent.session-store.json-workspace-root`。

`harness.shell.mode` 默认是 `WHITELIST`，省略命令列表时使用默认 Shell、Python、Node、Git、npm、Java／Maven 和常用文件处理命令。组件显式返回 `false` 可关闭命令工具。

## 构建与测试

以下命令均在本项目根目录执行。先确认 `mvn -version` 使用 JDK 17。

```bash
mvn clean package
node --test liteflow-agent-web-container-mysql/src/test/js/*.test.mjs
node --test liteflow-agent-web-container-redis/src/test/js/*.test.mjs
node --test liteflow-agent-web-container-json/src/test/js/*.test.mjs
```

这些测试不会调用真实模型，也不需要启动 Docker、MySQL 或 Redis。

六个示例的长输出处理规则相同：流式片段约每 80 毫秒合并刷新，生成期间显示纯文本，短内容完成后再渲染 Markdown。超过 12,000 字符的单段思考、消息、工具输入／输出和最终回答采用纯文本分段展示，可使用“上一段”“下一段”“跟随最新”和“下载全文”。完整文本仍保留，最终回答的复制按钮复制全文；分页不会截断模型输出或会话存储。实时和历史执行过程都默认折叠，收起时只显示当前动作、耗时与操作数；点击后显示紧凑的过程列表，每条思考、过程说明与工具详情也默认折叠，用户主动展开后才渲染正文。后续事件不会自动展开或收起用户正在查看的内容。列表每页最多渲染 40 条记录，未变化的工具内容不会重复解析、写入页面。正在执行的文字使用 CSS 渐变扫光，完成／失败后停止，并遵循系统的“减少动态效果”偏好。

运行所有前端测试，或使用只读模拟 API 检查真实浏览器布局和百万字符输出，不需要启动后端：

```bash
node --test liteflow-agent-web-*/src/test/js/*.test.mjs
python3 scripts/web_render_preview.py --module liteflow-agent-web-local-mysql
```

在浏览器打开脚本打印的 `/tests/chat-layout.html`、`/tests/long-output.html` 与 `/tests/execution-process.html` 地址。长输出测试包含 6,000 个流式事件、12 次工具调用、百万字符回答、历史折叠和手机宽度检查，并展示刷新次数与耗时。执行过程页面还会检查默认折叠、渐变动画、结束状态和 2,400 条记录分页，并提供浅色／深色、手机宽度、完成与失败的交互演示。测试计时和观察动画时请保持标签页在前台，后台标签页的定时器会被浏览器节流。`--module` 可选择任意示例，`--port` 可调整预览端口。


完整工作区矩阵验收需要 Docker 和 `liteflow-agent-sandbox:node22` 镜像。先构建示例，再执行：

```bash
python3 scripts/web_workspace_matrix.py
```

脚本自动创建独立的 MySQL／Redis 测试容器，使用本地模拟模型依次验证六种组合。检查完整 Skill 文件、相对路径、Python／Node 执行、附件交付及重启恢复；结果保存在根目录 `target/liteflow-workspace-parity-*`，结束后清理测试数据库容器和数据卷。可用 `--execution container --backends mysql redis` 选择组合。


## 本地执行快速启动

三个 local 模块也可复用 `liteflow-agent-web-container-mysql/src/main/resources/application-local.yml` 中的模型配置：将其复制到各模块的 `src/main/resources/` 下即可，无需重复设置模型环境变量。各模块已配置自动导入，该文件已被 `.gitignore` 排除。

最少依赖的 JSON 版本只需模型凭据：

```bash
export DEEPSEEK_API_KEY='填写你的 DeepSeek API Key'
mvn -pl liteflow-agent-web-local-json spring-boot:run
```

访问 [http://localhost:8905](http://localhost:8905)。MySQL 和 Redis 版本在设置模型凭据后，选择对应命令启动数据库与应用：

```bash
# MySQL 示例，访问 http://localhost:8903
docker compose -f liteflow-agent-web-local-mysql/docker-compose.yml up -d --wait
mvn -pl liteflow-agent-web-local-mysql spring-boot:run

# Redis 示例，访问 http://localhost:8904
docker compose -f liteflow-agent-web-local-redis/docker-compose.yml up -d --wait
mvn -pl liteflow-agent-web-local-redis spring-boot:run
```

数据库默认连接与应用配置一致，Compose 仅启动数据库服务。三个模块均内置与 container 示例相同的 `byted-stock-monitor` Skill。股票查询脚本需要宿主机 Python 安装 `requests`（`python3 -m pip install requests`），查询时使用 `--no-push`。请确保应用进程的 `PATH` 能找到 `python3` 和 `node`。

离线文件生成验收使用 `scripts/fixtures/skills/local-report` 测试资源，不作为示例的默认技能。

```bash
mvn -pl liteflow-agent-web-local-mysql,liteflow-agent-web-local-redis,liteflow-agent-web-local-json -am clean package
node --test liteflow-agent-web-local-*/src/test/js/*.test.mjs
python3 scripts/web_local_acceptance.py --backend json
```

后续沙箱镜像构建与启动说明适用于 `web-container-*` 模块。对应的 local 与 container 数据库 Compose 默认使用相同宿主机端口；并行运行时需调整端口及应用连接，详见各 local 模块说明。

## Redis 与本地 JSON 快速启动

准备好沙箱镜像，并将 MySQL 模块的 `src/main/resources/application-local.yml` 复制到 Redis 和 JSON 模块的同名目录后，在项目根目录执行：

```bash
# Redis 示例，访问 http://localhost:8901
docker compose -f liteflow-agent-web-container-redis/docker-compose.yml up -d
mvn -pl liteflow-agent-web-container-redis spring-boot:run

# 或运行本地 JSON 示例，访问 http://localhost:8902
mvn -pl liteflow-agent-web-container-json spring-boot:run
```

Redis 在 `application.yml` 中直接配置本地连接 `redis://localhost:6379/0` 和键前缀；Compose 启用 AOF 和数据卷。本地 JSON 在 `application.yml` 中直接配置 `./data/` 下的各数据目录。两个模块均导入各自的 `application-local.yml`，复制后可直接复用 MySQL 示例的模型配置。

分别参阅 [Redis 配置与运行说明](liteflow-agent-web-container-redis/README.md)和[本地 JSON 数据目录说明](liteflow-agent-web-container-json/README.md)。后文的数据库与迁移说明针对 MySQL 示例。

## 启动

先在 LiteFlow 源码仓库中构建沙箱镜像：

```bash
./liteflow-agent/docker/sandbox/build.sh
```

在模块的 `src/main/resources/application-local.yml` 中填写 DeepSeek API Key：

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

回到本项目根目录执行：

```bash
docker compose -f liteflow-agent-web-container-mysql/docker-compose.yml up -d
mvn -pl liteflow-agent-web-container-mysql spring-boot:run
```

访问 [http://localhost:8900](http://localhost:8900)。MySQL 连接和 Docker 沙箱配置位于模块的 `src/main/resources/application.yml`；本机覆盖配置可放在同目录的 `application-local.yml`，该文件已被 `.gitignore` 排除。

新模块默认使用 `liteflow-agent-web-container-mysql` 作为运行命名空间。若需要继续使用旧示例的会话数据，应连接原 MySQL，并将 `liteflow.agent.application-name` 配置为旧值 `liteflow-agent-web-example`。

更多配置、会话 API 和可选验收脚本见[模块说明](liteflow-agent-web-container-mysql/README.md)。


## AgentScope 2.0.3 与生成文件

本示例使用 LiteFlow 2.16.3、AgentScope 2.0.3。LiteFlow Agent 尚未正式发布时，需要先在 LiteFlow 源码仓库安装本轮升级后的包，再构建示例；仅使用旧的同版本本地 JAR 不会更新其实现。

在 LiteFlow 源码根目录执行：

```bash
mvn install -pl liteflow-agent/liteflow-agent-core,liteflow-agent/liteflow-agent-openai,liteflow-agent/liteflow-agent-mysql,liteflow-agent/liteflow-agent-redis,liteflow-agent/liteflow-agent-jev,liteflow-spring-boot4-starter -am -DskipTests
```

然后使用 JDK 17 在示例根目录执行 `mvn clean package`。

可以提问：“生成一份示例销售数据 CSV，包含商品、数量和金额，并交付文件。” Agent 使用 `deliver_artifact` 后，聊天中会出现下载入口；附件事件保存在聊天记录中，刷新或重启后仍可下载。

- 产物字节保存在现有 MySQL 工作区表中，使用独立的 `artifacts-v1` 命名空间；没有新增本地状态目录。
- 文件按应用命名空间、配置的用户 ID 和会话 ID 隔离；同会话同名文件默认报冲突，工具可显式设置 `force=true` 覆盖。
- 附件不设置文件大小上限，沿用当前会话的存储后端。
- 下载接口为 `GET /api/chat/sessions/{sessionId}/artifacts/{artifactId}`，返回附件下载；删除会话同时清除产物。
- 本示例仍是使用配置中默认用户的单用户应用；接入登录系统时，聊天和下载两条路径都应使用服务端认证的用户身份。

新增的离线测试覆盖官方交付工具读取文件、保存和重开读取、同名冲突、覆盖、用户／会话隔离、大小限制、下载响应与删除。它们不调用模型；真实模型生成文件仍需启动 MySQL、Docker 并配置模型凭据。

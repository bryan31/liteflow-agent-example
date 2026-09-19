# liteflow-agent-web-container-json

与 [MySQL 示例](../liteflow-agent-web-container-mysql/README.md) 使用相同的聊天界面、流式事件、Skill、Docker 容器状态和附件下载功能，会话状态保存到本地 JSON。模块包含完整源码，可以单独构建和启动。

“本地 JSON”指持久化方式，命令执行仍使用 Docker 沙箱。

## 启动

需要 JDK 17、Maven、Docker 和本地 `liteflow-agent-sandbox:node22` 镜像，无需 MySQL 或 Redis。镜像在 LiteFlow 源码仓库执行 `./liteflow-agent/docker/sandbox/build.sh` 构建。

先将 MySQL 模块的 `src/main/resources/application-local.yml` 复制到本模块同名目录，复用模型配置。以下命令在示例仓库根目录执行：

```bash
mvn -pl liteflow-agent-web-container-json spring-boot:run
```

访问 [http://localhost:8902](http://localhost:8902)。默认模型为 `deepseek-flash`；模型和 API Key 可在本模块的 `src/main/resources/application-local.yml` 中修改，该文件已被忽略。

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

## 本地数据

配置 `liteflow.agent.session-store.type=JSON`，直接使用框架内置的 `JsonFileAgentStateStore`，无需额外的存储插件。

默认数据位于进程工作目录下的 `data/`，`spring-boot:run` 的工作目录为本模块。使用 `java -jar` 时相对路径从当前目录计算；需要在不同启动方式之间复用数据时，直接将 `application.yml` 中以下四项配置改为固定的绝对路径。

| 目录 | 内容 | 配置 |
| --- | --- | --- |
| `agent-state/` | Agent 状态、会话摘要、消息历史和已加载 Skill | `liteflow.agent.session-store.json-root` |
| `agent-workspaces/` | Harness 记忆与归档 | `liteflow.agent.session-store.json-workspace-root` |
| `sandbox-snapshots/` | Docker 业务文件快照 | `liteflow.agent.harness.docker.snapshot-root` |
| `artifacts/` | 交付附件的文件名、描述与 Base64 内容，以 JSON 保存 | `example.artifacts.root` |

这些目录在 `application.yml` 中直接配置于 `./data/` 下，已加入 `.gitignore`。备份时应一起保存上述目录，重启时保持数据路径和运行命名空间不变。

- 运行命名空间为 `liteflow-agent-web-container-json`，文件按应用、用户和会话身份隔离。
- 附件同名冲突、显式覆盖、大小限制、下载 API 和删除行为与 MySQL 示例一致。附件使用原子 JSON 文件写入；重启后仍可下载。
- 保留 `SESSION_IDLE` 容器复用策略与本地快照配置，空闲 10 分钟回收，最多缓存 8 个沙箱。回收或重启后从快照恢复业务文件。
- 每轮自动记忆提取为 `NEVER`，不影响会话历史保存。
- 本示例用于单进程运行。同一数据目录不要由多个应用实例同时写入；需要多实例共享状态时使用 Redis 或 MySQL 示例。
- 删除会话清除展示历史、登记的 Agent 状态和交付附件。工作区、长期记忆及快照沿用框架保留策略。

会话 API、界面交互和容器状态语义见 [MySQL 示例说明](../liteflow-agent-web-container-mysql/README.md)。

## 验证

在示例根目录执行：

```bash
mvn -pl liteflow-agent-web-container-json test
node --test liteflow-agent-web-container-json/src/test/js/*.test.mjs
python3 liteflow-agent-web-container-json/src/test/python/web_layout_fixture.py --port 18937
```

Java 测试使用临时目录验证附件重新打开、冲突、覆盖、身份隔离、下载与删除；普通测试不调用真实模型或 Docker。布局验收页面应显示 `6/6 passed`。

完整验收使用本地模拟模型、真实 HTTP 与 Docker，并使用独立临时数据目录。先构建 JAR，再运行：

```bash
mvn -pl liteflow-agent-web-container-json package
python3 scripts/web_storage_acceptance.py --backend json
```

覆盖流式工具调用、附件交付、重启后历史与文件恢复、分页和删除，日志保存在本模块 `target/storage-acceptance-*`。

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

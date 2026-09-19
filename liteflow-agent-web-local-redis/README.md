# liteflow-agent-web-local-redis

Agent 在宿主机执行的 LiteFlow Agent Web 示例，端口为 **8904**。会话、历史消息、工作区文件、Harness 记忆与附件统一保存在 Redis。执行目录位于配置的 `harness.local.workspace-root` 下。`local` 表示 Agent 使用本地执行后端，Redis 默认通过 Docker Compose 启动。

## 运行方式与能力

应用直接使用 JDK 17 运行。`enableShellTool()` 默认返回 `true`，无需覆盖开启方法。核心配置位于 `src/main/resources/application.yml`：

```yaml
liteflow:
  agent:
    harness:
      filesystem-backend: GUARDED_LOCAL
      local:
        workspace-root: ./data
```

需要关闭某个组件的内置命令工具时，覆盖统一开关：

```java
@Override
protected boolean enableShellTool() {
    return false;
}
```

支持流式聊天、历史会话、Skill 加载、工作区文件读写和 `deliver_artifact` 附件下载。本示例已启用 `execute`，可调用宿主机的 Shell、`python3` 和 `node`，子 Agent 仍默认禁用。Agent 执行无需沙箱镜像；启动本模块的 Redis 容器需要 Docker。

内置与 container 示例相同的 `byted-stock-monitor` Skill，用于查询 A 股价格、涨跌幅和成交量。脚本使用宿主机的 `python3`，需要安装 `requests`（`python3 -m pip install requests`）。页面顶部显示本地模式与存储类型。

## 准备 Redis

在 `liteflow-agent-example` 根目录执行：

```bash
docker compose -f liteflow-agent-web-local-redis/docker-compose.yml up -d --wait
```

Compose 使用 `redis:7.4-alpine`，监听 `127.0.0.1:6379`，与应用默认连接 `redis://localhost:6379/0` 一致。已启用 AOF，数据保存在本模块 Compose 项目的 `redis-data` 卷中。`docker compose -f liteflow-agent-web-local-redis/docker-compose.yml down` 保留数据卷，追加 `-v` 会删除数据。

已有本机或远程 Redis 服务时，可跳过 Compose，直接配置连接：

```bash
export REDIS_URI='redis://localhost:6379/0'
```

独立键前缀为 `liteflow-agent-web-local-redis:`。复用已有 Redis 时，请为该服务配置 AOF 或 RDB 持久化；不要将此数据空间配置为可随意淘汰的缓存。与 `web-container-redis` 模块的 Compose 默认都占用宿主机 6379 端口，不能同时绑定；如需并行运行，可修改其中一个 Compose 的宿主机端口，并同步修改对应的 `REDIS_URI` 或连接配置。

## 命令执行

在启动应用的同一终端中确认 `python3 --version`、`node --version` 可用；IDE 启动时需给进程配置相同的 `PATH`。Linux／macOS 使用 `sh -c`，Windows 使用 `cmd.exe /c`，解释器和依赖使用宿主机已安装的版本。

同一会话的命令在 `harness.local.workspace-root/<应用名>/<原始会话ID>/` 固定目录中运行，不再每次创建和删除临时目录。执行 `pwd` 可看到实际路径；不同应用和会话不会共用该目录。`harness.local.workspace-root` 的相对路径以应用工作目录为基准，也可以配置绝对路径。

命令执行前从当前存储刷新会话文件，执行后将新增、修改和删除写回存储，供 `read_file` 和 `deliver_artifact` 使用。MySQL／Redis 模式以数据库为准，可在本地目录丢失后恢复。请通过文件工具或命令修改持久化文件；手工编辑本地执行缓存不会自动写回数据库。

`harness.shell.mode` 默认是 `WHITELIST`，省略 `harness.shell.whitelist` 时使用包含 Shell、Python、Node、文件操作与构建工具的默认列表。用户指定的列表替换默认列表，显式空列表无效。顶层管道、多命令拼接会被拒绝，多步操作请放入脚本，再用允许的 `python3`、`node` 或 `sh` 执行。`working_directory` 可以指定当前会话目录下已有的子目录。`harness.shell.timeout` 是服务端上限，默认 1 分钟，示例无需显式配置。

命令继承应用进程的系统权限和环境变量。文件和本机空目录可跨命令保留，进程环境与 `cd` 不跨调用保留。文件回写失败时保留执行目录和 `.agentscope/execution.pending` 标记，并阻止后续命令静默覆盖未保存的文件，需先恢复文件再移除标记。Skill 加载结果中的 `Files root` 是会话工作区相对路径，文件工具和 Shell 使用同一路径；完整的 `SKILL.md`、脚本和附件会准备到会话的 `.skills-cache/<来源>/<技能名>/`。

之前使用的 `harness.local-shell-enabled` 已移除，无需同时维护两个启用开关。

## 启动

以下命令在 `liteflow-agent-example` 根目录执行，确认 `mvn -version` 使用 JDK 17。LiteFlow 依赖尚未发布时，先按[根目录说明](../README.md#agentscope-203-与生成文件)安装源码依赖。

```bash
export DEEPSEEK_API_KEY='填写你的 DeepSeek API Key'
docker compose -f liteflow-agent-web-local-redis/docker-compose.yml up -d --wait
mvn -pl liteflow-agent-web-local-redis spring-boot:run
```

访问 [http://localhost:8904](http://localhost:8904)。可通过 `DEEPSEEK_BASE_URL` 和 `DEEPSEEK_MODEL` 调整模型地址和名称，默认值与 Docker 示例相同。也可以将 `web-container-mysql` 模块的 `src/main/resources/application-local.yml` 复制到本模块同名目录，复用模型凭据与配置；其中显式填写的值优先于主配置中的环境变量占位符。该本机配置文件已被 `.gitignore` 排除。

试着提问：“使用 byted-stock-monitor 技能，查询 600519 和 300750 的最新行情，只查询、不推送。”

执行脚本时，使用技能加载结果中的 `Files root` 定位 `scripts/stock_query.py`，传入 `--no-push`，无需配置 OpenClaw 的推送渠道。

刷新页面可查看历史和下载附件；重启应用后，在相同数据库／数据目录和命名空间下仍可继续会话。

## 构建与验证

```bash
mvn -pl liteflow-agent-web-local-redis -am clean package
node --test liteflow-agent-web-local-redis/src/test/js/*.test.mjs
```

单元测试不调用真实模型，也不要求启动数据库。完整的本地执行 HTTP 验收使用本地模拟模型，实际执行 Shell、Python、Node，验证脚本生成文件、读取、附件下载和应用重启恢复：

```bash
python3 scripts/web_local_acceptance.py --backend redis
```

Redis 验收会用本机 `redis-server` 启动专用临时实例。验收数据与日志保存在模块 `target/local-acceptance-*` 下。

会话只按应用名和会话 ID 隔离，不再配置用户。默认每轮额外记忆提取关闭，聊天上下文与历史仍然保存；需要长期记忆提取时可以配置 `liteflow.agent.harness.memory.flush-mode`。

## 工作目录结构

本地执行根目录配置为 `./data`，应用名取 `spring.application.name`，第二层直接使用页面会话的原始 ID：

```text
data/
  liteflow-agent-web-local-redis/
    <会话ID>/
      .skills-cache/
      report.csv
```

应用名与会话 ID 必须是合法的单层目录名，不能包含路径分隔符或 `..` 路径跳转。MySQL／Redis 模式的 SDK 缓存与会话记录工作副本放在临时目录，持久化数据仍在数据库。旧版本含用户和哈希的目录及存储记录不会自动迁移或删除。

验收脚本使用 `scripts/fixtures/skills/local-report` 测试资源，不会调用外部行情接口。

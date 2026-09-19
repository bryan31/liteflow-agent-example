# liteflow-agent-web-container-redis

与 [MySQL 示例](../liteflow-agent-web-container-mysql/README.md) 使用相同的聊天界面、流式事件、Skill、Docker 容器状态和附件下载功能，存储改为 Redis。模块包含完整源码，可以单独构建和启动。

## 启动

需要 JDK 17、Maven、Docker 和本地 `liteflow-agent-sandbox:node22` 镜像。镜像在 LiteFlow 源码仓库执行 `./liteflow-agent/docker/sandbox/build.sh` 构建。

先将 MySQL 模块的 `src/main/resources/application-local.yml` 复制到本模块同名目录，复用模型配置。以下命令在示例仓库根目录执行：

```bash
docker compose -f liteflow-agent-web-container-redis/docker-compose.yml up -d
mvn -pl liteflow-agent-web-container-redis spring-boot:run
```

访问 [http://localhost:8901](http://localhost:8901)。默认模型为 `deepseek-flash`；模型和 API Key 可在本模块的 `src/main/resources/application-local.yml` 中修改，该文件已被忽略。

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

## 存储与沙箱

- 使用 `liteflow-agent-redis`，`liteflow.agent.session-store.type=REDIS`。
- `application.yml` 中直接配置 `uri: "redis://localhost:6379/0"` 和 `key-prefix: "liteflow-agent-web-container-redis:"`。已有 Redis 可以直接修改连接地址，省略 Compose 启动步骤。
- Compose 启用 AOF，并使用 `redis-data` 卷保存数据。普通 `docker compose down` 保留卷；带 `-v` 会删除数据。
- 会话上下文、聊天历史、长期记忆、Harness 归档、业务文件快照与交付附件都存入 Redis。`HarnessStorage` 的工作区记录使用配置前缀下的 `workspace:` 键。
- 不需要本地状态或快照目录，也不要配置 `harness.docker.snapshot-root`。运行命名空间为 `liteflow-agent-web-container-redis`，与其他示例隔离。
- 保留 MySQL 示例的 `SESSION_IDLE` 策略：会话连续调用复用沙箱，空闲 10 分钟后回收，每 30 秒检查一次，最多缓存 8 个沙箱。应用重启后从 Redis 恢复业务文件。
- 每轮自动记忆提取为 `NEVER`，会话历史照常保存。附件不设置文件大小上限，同会话同名交付默认冲突，显式 `force=true` 可覆盖。
- 删除会话会清除展示记录、登记的 Agent 状态和交付附件；工作区、长期记忆及快照沿用框架保留策略。

会话 API、界面交互和容器状态语义见 [MySQL 示例说明](../liteflow-agent-web-container-mysql/README.md)。本模块的 Java 与前端回归均可离线执行，不连接真实 Redis 或模型。

## 验证

在示例根目录执行：

```bash
mvn -pl liteflow-agent-web-container-redis test
node --test liteflow-agent-web-container-redis/src/test/js/*.test.mjs
python3 liteflow-agent-web-container-redis/src/test/python/web_layout_fixture.py --port 18936
```

打开布局脚本输出的地址，页面应显示 `6/6 passed`。

完整验收使用本地模拟模型、真实 HTTP 与 Docker，创建一次性 Redis，不访问既有 Redis 或真实模型。先构建 JAR，再运行：

```bash
mvn -pl liteflow-agent-web-container-redis package
python3 scripts/web_storage_acceptance.py --backend redis
```

需要本地 `redis:7.4-alpine` 与沙箱镜像。验收覆盖流式工具调用、附件交付、重启后历史与文件恢复、分页和删除，日志保存在本模块 `target/storage-acceptance-*`。

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

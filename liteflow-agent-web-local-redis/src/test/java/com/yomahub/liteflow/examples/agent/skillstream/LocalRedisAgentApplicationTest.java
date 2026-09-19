package com.yomahub.liteflow.examples.agent.skillstream;

import com.yomahub.liteflow.property.agent.AgentConfig;
import com.yomahub.liteflow.property.LiteflowConfig;
import com.yomahub.liteflow.springboot4.config.LiteflowPropertyAutoConfiguration;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import com.yomahub.liteflow.property.agent.HarnessConfig;
import com.yomahub.liteflow.property.agent.HarnessMemoryFlushMode;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.io.ClassPathResource;

import java.lang.reflect.Method;
import java.time.Duration;
import java.util.Arrays;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class LocalRedisAgentApplicationTest {

    @Test
    void configUsesRedisStateAndAgentScope2GuardedLocalFilesystem() throws Exception {
        var properties = new YamlPropertySourceLoader()
                .load("skill-stream-example", new ClassPathResource("application.yml")).get(0);

        assertThat(properties.getProperty("spring.application.name"))
                .isEqualTo("liteflow-agent-web-local-redis");
        assertThat(properties.getProperty("liteflow.agent.session-store.type")).isEqualTo("REDIS");
        assertThat(properties.getProperty("liteflow.agent.conversation-history-enabled")).isNull();
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(properties);
        assertThat(properties.getProperty("liteflow.agent.application-name")).isNull();
        assertThat(properties.getProperty("liteflow.agent.execution-timeout")).isNull();
        try (var context = new AnnotationConfigApplicationContext()) {
            context.setEnvironment(environment);
            context.register(LiteflowPropertyAutoConfiguration.class);
            context.refresh();
            AgentConfig agentConfig = context.getBean(LiteflowConfig.class).getAgent();
            assertThat(agentConfig.getSessionStore().getType().name())
                    .isEqualTo(properties.getProperty("liteflow.agent.session-store.type"));
            assertThat(agentConfig.getApplicationName()).isEqualTo(properties.getProperty("spring.application.name"));
            assertThat(agentConfig.getExecutionTimeout()).isEqualTo(Duration.ofMinutes(10));
            assertThat(agentConfig.isConversationHistoryEnabled()).isTrue();
        }
        assertThat(properties.getProperty("liteflow.agent.session-store.redis.uri"))
                .isEqualTo("${REDIS_URI:redis://localhost:6379/0}");
        assertThat(properties.getProperty("liteflow.agent.session-store.redis.key-prefix"))
                .isEqualTo("liteflow-agent-web-local-redis:");
        assertThat(properties.getProperty("liteflow.agent.harness.filesystem-backend"))
                .isEqualTo("GUARDED_LOCAL");
        assertThat(properties.getProperty("liteflow.agent.harness.docker.image")).isNull();
        assertThat(properties.getProperty("liteflow.agent.skills.enabled")).isEqualTo(true);
        assertThat(properties.getProperty("liteflow.agent.skills.path"))
                .isEqualTo("classpath:agent/skills");
        assertThat(properties.getProperty("example.agent.model"))
                .isEqualTo("${DEEPSEEK_MODEL:deepseek-flash}");
        assertThat(properties.getProperty("liteflow.agent.openai-compatible.deepseek.api-key"))
                .isEqualTo("${DEEPSEEK_API_KEY:}");
        assertThat(properties.getProperty("liteflow.agent.openai-compatible.deepseek.base-url"))
                .isEqualTo("${DEEPSEEK_BASE_URL:https://api.deepseek.com/v1}");
    }

    @Test
    void yamlDisablesPerTurnMemoryExtractionThroughFrameworkConfiguration() throws Exception {
        var properties = new YamlPropertySourceLoader()
                .load("memory-mode", new ClassPathResource("application.yml")).get(0);
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(properties);
        HarnessConfig config = Binder.get(environment)
                .bind("liteflow.agent.harness", Bindable.of(HarnessConfig.class)).get();

        assertThat(config.getMemory().getFlushMode()).isEqualTo(HarnessMemoryFlushMode.NEVER);
        assertThat(config.getMemory().getFlushMinGap()).isEqualTo(Duration.ofMinutes(5));
        assertThat(properties.getProperty("liteflow.agent.harness.local-shell-enabled")).isNull();
        assertThat(properties.getProperty("liteflow.agent.harness.shell.mode")).isNull();
        var shell = config.getShell();
        assertThat(shell.getMode()).isEqualTo(com.yomahub.liteflow.property.agent.ShellMode.WHITELIST);
        assertThat(shell.getWhitelist()).contains("sh", "python3", "node");
        assertThat(shell.getTimeout()).isEqualTo(Duration.ofMinutes(1));
        assertThat(properties.getProperty("liteflow.agent.harness.shell.timeout")).isNull();
        assertThat(properties.getProperty("liteflow.agent.harness.local.workspace-root")).isNotNull();
        config.validate();
    }

    @Test
    void omittedMemoryModeAlsoDefaultsToNever() {
        var properties = new MapConfigurationPropertySource(Map.of(
                "liteflow.agent.harness.filesystem-backend", "GUARDED_LOCAL"));
        HarnessConfig config = new Binder(properties)
                .bind("liteflow.agent.harness", Bindable.of(HarnessConfig.class)).get();

        assertThat(config.getMemory().getFlushMode()).isEqualTo(HarnessMemoryFlushMode.NEVER);
    }

    @Test
    void applicationDoesNotPrintAgentStreamEventsDirectly() {
        boolean hasPrintEventMethod = Arrays.stream(LocalRedisAgentApplication.class.getDeclaredMethods())
                .map(Method::getName)
                .anyMatch("printEvent"::equals);

        assertThat(hasPrintEventMethod).isFalse();
    }
}

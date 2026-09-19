package com.yomahub.liteflow.examples.agent.skillstream.chat;

import com.yomahub.liteflow.agent.conversation.AgentConversationConfiguration;
import com.yomahub.liteflow.agent.conversation.AgentConversationService;
import com.yomahub.liteflow.agent.context.InvocationIdentityResolver;
import com.yomahub.liteflow.agent.harness.state.HarnessNamespacedAgentStateStore;
import com.yomahub.liteflow.property.LiteflowConfig;
import com.yomahub.liteflow.property.agent.AgentConfig;
import io.agentscope.core.state.AgentState;
import io.agentscope.core.state.InMemoryAgentStateStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import com.yomahub.liteflow.core.FlowExecutor;

import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;

class ConversationApiTest {
    @TempDir Path root;

    @Test
    void httpLoadsHistoryPagesAndDeletionRemovesTheConversation() throws Exception {
        ChatSessionStore store = new ChatSessionStore();
        String id = store.create("question").id();
        store.addMessage(id, "assistant", "result", "answer");
        ChatController controller = new ChatController(store,
                mock(FlowExecutor.class), new ChatEventMapper(), mock(ArtifactStore.class));
        var mvc = MockMvcBuilders.standaloneSetup(controller).build();
        try {
            mvc.perform(get("/api/chat/sessions/{id}/messages", id).param("limit", "201"))
                    .andExpect(status().isBadRequest());
            mvc.perform(get(
                            "/api/chat/sessions/{id}/messages", id).param("cursor", "1").param("limit", "1"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.items[0].content").value("answer"))
                    .andExpect(jsonPath("$.hasMore").value(false));
            mvc.perform(get("/api/chat/sessions/{id}", id))
                    .andExpect(jsonPath("$.messages.length()").value(2));
            mvc.perform(delete("/api/chat/sessions/{id}", id))
                    .andExpect(status().isOk());
            mvc.perform(get("/api/chat/sessions/{id}", id))
                    .andExpect(status().isNotFound());
        } finally {
            controller.shutdownExecutor();
        }
    }

    @Test
    void springServiceCanBeInjectedAndReadAfterReopenWithoutModelCredentialsOrDocker() {
        LiteflowConfig config = new LiteflowConfig();
        config.setAgent(new AgentConfig());
        config.getAgent().setApplicationName("web-api-test");
        config.getAgent().getSessionStore().setJsonRoot(root.toString());
        String id;
        try (var context = new AnnotationConfigApplicationContext()) {
            context.registerBean(LiteflowConfig.class, () -> config);
            context.register(AgentConversationConfiguration.class);
            context.refresh();
            AgentConversationService service = context.getBean(AgentConversationService.class);
            ChatSessionStore adapter = new ChatSessionStore(service);
            id = adapter.create("first question").id();
            adapter.addMessage(id, "assistant", "trace", "{\"status\":\"已完成\"}");
            adapter.addMessage(id, "assistant", "result", "reply");
            assertThat(adapter.messages(id, 1, 1).items()).hasSize(1);
        }
        try (var reopened = AgentConversationService.open(config.getAgent())) {
            ChatSessionStore adapter = new ChatSessionStore(reopened);
            assertThat(adapter.get(id).messages()).extracting(ChatSessionStore.ChatMessage::content)
                    .containsExactly("first question", "{\"status\":\"已完成\"}", "reply");
            assertThat(adapter.list()).hasSize(1);
        }
    }

    @Test
    void legacyImportPreservesMessagesAndDeletionRemovesHarnessMemoryWithoutReimporting() {
        AgentConfig config = new AgentConfig();
        config.setApplicationName("legacy-web");
        InMemoryAgentStateStore raw = new InMemoryAgentStateStore();
        var oldMessage = new ChatSessionStore.ChatMessage("original-message", "user", "input", "old question", 123);
        raw.save("liteflow-web-ui", "old-session", "chat_session", new ChatSessionStore.ChatSession(
                "old-session", "old title", 100, 200, List.of(oldMessage), List.of("old-skill")));
        var identity = new InvocationIdentityResolver("legacy-web").resolve("old-session", "skillStreamAgent");
        var state = new HarnessNamespacedAgentStateStore(raw, identity.agentNamespace());
        state.save(null, identity.runtimeSessionId(), "agent_state", AgentState.builder().build());
        try (var service = new AgentConversationService(config, raw)) {
            ChatSessionStore adapter = new ChatSessionStore(service);
            LegacyChatSessionImporter.migrate(raw, service);
            LegacyChatSessionImporter.migrate(raw, service);
            assertThat(adapter.get("old-session").messages()).containsExactly(oldMessage);
            assertThat(adapter.get("old-session").loadedSkills()).containsExactly("old-skill");
            adapter.delete("old-session");
            assertThat(state.exists(null, identity.runtimeSessionId())).isFalse();
            LegacyChatSessionImporter.migrate(raw, service);
            assertThat(adapter.list()).isEmpty();
            assertThat(raw.exists("liteflow-web-ui", "old-session")).isTrue();
        }
    }
}

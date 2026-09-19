package com.yomahub.liteflow.examples.agent.skillstream.chat;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yomahub.liteflow.agent.conversation.AgentConversation;
import com.yomahub.liteflow.agent.conversation.AgentConversationConfiguration;
import com.yomahub.liteflow.agent.conversation.AgentConversationMessage;
import com.yomahub.liteflow.agent.conversation.AgentConversationPage;
import com.yomahub.liteflow.agent.conversation.AgentConversationService;
import com.yomahub.liteflow.property.agent.AgentConfig;
import com.yomahub.liteflow.property.LiteflowConfig;
import io.agentscope.core.state.AgentStateStore;
import io.agentscope.core.state.InMemoryAgentStateStore;
import io.agentscope.core.state.State;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** HTTP DTO and display-title adapter. Persistence and state deletion belong to liteflow-agent. */
@Component
@Import(AgentConversationConfiguration.class)
public class ChatSessionStore {

    private static final ObjectMapper JSON = new ObjectMapper();
    private final AgentConversationService conversations;

    @Autowired
    public ChatSessionStore(AgentConversationService conversations, LiteflowConfig property) {
        this(conversations);
        LegacyChatSessionImporter.migrate(property.getAgent(), conversations);
    }

    public ChatSessionStore() {
        this(new InMemoryAgentStateStore());
    }

    ChatSessionStore(AgentStateStore stateStore) {
        this(new AgentConversationService(testConfig(), stateStore));
    }

    ChatSessionStore(AgentConversationService conversations) {
        this.conversations = conversations;
    }

    public ChatSession createBlank(String title) {
        AgentConversation created = conversations.create(UUID.randomUUID().toString(), titleFrom(title), false);
        return toSession(created, List.of());
    }

    public ChatSession create(String firstMessage) {
        ChatSession created = createBlank(firstMessage);
        if (firstMessage != null && !firstMessage.isBlank()) {
            addMessage(created.id(), "user", "input", firstMessage.trim());
        }
        return get(created.id());
    }

    public List<ChatSessionSummary> list() {
        List<ChatSessionSummary> result = new ArrayList<>();
        long cursor = 0;
        AgentConversationPage<AgentConversation> page;
        do {
            page = conversations.list(cursor, 200);
            page.items().forEach(session -> result.add(new ChatSessionSummary(session.id(), session.title(),
                    session.createdAt(), session.updatedAt(), Math.toIntExact(session.messageCount()), loadedSkills(session))));
            cursor = page.nextCursor();
        } while (page.hasMore());
        return List.copyOf(result);
    }

    public ChatSession get(String id) {
        AgentConversation session = require(id);
        List<ChatMessage> messages = new ArrayList<>();
        long cursor = 0;
        AgentConversationPage<AgentConversationMessage> page;
        do {
            page = messages(id, cursor, 200);
            page.items().stream().map(ChatSessionStore::toMessage).forEach(messages::add);
            cursor = page.nextCursor();
        } while (page.hasMore());
        return toSession(session, messages);
    }

    public AgentConversationPage<AgentConversationMessage> messages(String id, long cursor, int limit) {
        return conversations.messages(id, cursor, limit);
    }

    public ChatMessage addMessage(String sessionId, String role, String stage, String content) {
        AgentConversationMessage message = conversations.append(sessionId, role, stage, content);
        if ("user".equals(role) && message.sequence() == 1) {
            AgentConversation session = require(sessionId);
            conversations.update(sessionId, titleFrom(content), session.attributes());
        }
        return toMessage(message);
    }

    public void recordLoadedSkills(String sessionId, List<String> skills) {
        if (skills == null || skills.isEmpty()) {
            return;
        }
        AgentConversation session = require(sessionId);
        LinkedHashSet<String> merged = new LinkedHashSet<>(loadedSkills(session));
        skills.stream().filter(java.util.Objects::nonNull).map(String::trim).filter(s -> !s.isEmpty()).forEach(merged::add);
        Map<String, String> attributes = new java.util.LinkedHashMap<>(session.attributes());
        attributes.put("loadedSkills", encodeSkills(List.copyOf(merged)));
        conversations.update(sessionId, null, attributes);
    }

    public void delete(String id) {
        conversations.delete(id);
    }

    AgentConversation require(String id) {
        return conversations.get(id).orElseThrow(() -> new IllegalArgumentException("Session not found: " + id));
    }

    private static ChatSession toSession(AgentConversation session, List<ChatMessage> messages) {
        return new ChatSession(session.id(), session.title(), session.createdAt(), session.updatedAt(), messages, loadedSkills(session));
    }

    private static ChatMessage toMessage(AgentConversationMessage message) {
        return new ChatMessage(message.id(), message.role(), message.stage(), message.content(), message.timestamp());
    }

    static String encodeSkills(List<String> skills) {
        try {
            return JSON.writeValueAsString(skills);
        } catch (JsonProcessingException failure) {
            throw new IllegalArgumentException("Cannot encode loaded skills", failure);
        }
    }

    private static List<String> loadedSkills(AgentConversation session) {
        try {
            return JSON.readValue(session.attributes().getOrDefault("loadedSkills", "[]"), new TypeReference<>() {});
        } catch (JsonProcessingException failure) {
            throw new IllegalStateException("Invalid loaded skills metadata", failure);
        }
    }

    private static AgentConfig testConfig() {
        AgentConfig config = new AgentConfig();
        config.setApplicationName("web-store-test");
        return config;
    }

    private String titleFrom(String text) {
        if (text == null || text.isBlank()) {
            return "新会话";
        }
        String compact = text.trim().replaceAll("\\s+", " ");
        int first = -1;
        for (String mark : List.of("，", "。", "？", "！", ",", ".", "?", "!")) {
            int index = compact.indexOf(mark);
            if (index > 0 && (first < 0 || index < first)) {
                first = index;
            }
        }
        if (first > 0) {
            compact = compact.substring(0, first);
        }
        return compact.length() <= 20 ? compact : compact.substring(0, 20);
    }

    public record ChatSessionSummary(String id, String title, long createdAt, long updatedAt,
                                     int messageCount, List<String> loadedSkills) {
    }

    /** Also retained as the deserialization shape for the previous example's chat_session entries. */
    public record ChatSession(String id, String title, long createdAt, long updatedAt,
                              List<ChatMessage> messages, List<String> loadedSkills) implements State {
        public ChatSession {
            messages = messages == null ? List.of() : List.copyOf(messages);
            loadedSkills = loadedSkills == null ? List.of() : List.copyOf(loadedSkills);
        }
    }

    public record ChatMessage(String id, String role, String stage, String content, long timestamp) {
    }
}

package com.yomahub.liteflow.examples.agent.skillstream.chat;

import com.yomahub.liteflow.agent.conversation.AgentConversation;
import com.yomahub.liteflow.agent.conversation.AgentConversationMessage;
import com.yomahub.liteflow.agent.conversation.AgentConversationService;
import com.yomahub.liteflow.agent.state.DefaultAgentStateStoreResolver;
import com.yomahub.liteflow.property.agent.AgentConfig;
import io.agentscope.core.state.AgentStateStore;

import java.util.Map;

/** Read-only legacy import. Old entries remain as a backup; deleted IDs are never revived. */
final class LegacyChatSessionImporter {
    private LegacyChatSessionImporter() {
    }

    static void migrate(AgentConfig config, AgentConversationService conversations) {
        try (var resolved = new DefaultAgentStateStoreResolver().resolve(config.getSessionStore())) {
            migrate(resolved.store(), conversations);
        }
    }

    static void migrate(AgentStateStore legacy, AgentConversationService conversations) {
        for (String id : legacy.listSessionIds("liteflow-web-ui")) {
            legacy.get("liteflow-web-ui", id, "chat_session", ChatSessionStore.ChatSession.class).ifPresent(session -> {
                AgentConversation metadata = new AgentConversation(session.id(), session.title(), session.createdAt(),
                        session.updatedAt(), session.messages().size(),
                        Map.of("loadedSkills", ChatSessionStore.encodeSkills(session.loadedSkills())));
                conversations.importIfAbsent(metadata, session.messages().stream()
                        .map(message -> new AgentConversationMessage(0, message.id(), message.role(), message.stage(),
                                message.content(), null, null, message.timestamp())).toList());
                if (conversations.get(session.id()).isPresent()) {
                    conversations.attachAgent(session.id(), "skillStreamAgent");
                }
            });
        }
    }
}

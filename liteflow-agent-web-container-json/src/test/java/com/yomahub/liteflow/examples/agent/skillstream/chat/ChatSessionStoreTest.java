package com.yomahub.liteflow.examples.agent.skillstream.chat;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ChatSessionStoreTest {

    @Test
    void createsAppendsAndDeletesSessions() {
        ChatSessionStore store = new ChatSessionStore();

        ChatSessionStore.ChatSession session = store.create("第一句问题");
        store.addMessage(session.id(), "assistant", "agent", "回答");

        assertThat(store.list()).hasSize(1);
        assertThat(store.get(session.id()).messages())
                .extracting(ChatSessionStore.ChatMessage::content)
                .containsExactly("第一句问题", "回答");

        store.delete(session.id());

        assertThat(store.list()).isEmpty();
    }

    @Test
    void derivesTitleFromPrompt() {
        ChatSessionStore store = new ChatSessionStore();

        ChatSessionStore.ChatSession session = store.create("请帮我分析一下这个技能流式输出过程，越清楚越好。");

        assertThat(session.title()).isEqualTo("请帮我分析一下这个技能流式输出过程");
    }

    @Test
    void persistsLoadedSkillsAlongsideMessages() {
        ChatSessionStore store = new ChatSessionStore();

        ChatSessionStore.ChatSession session = store.createBlank("Skill 会话");
        store.addMessage(session.id(), "user", "input", "查询股票");
        store.recordLoadedSkills(session.id(), java.util.List.of("byted-stock-monitor_classpath-skills"));

        assertThat(store.get(session.id()).loadedSkills())
                .containsExactly("byted-stock-monitor_classpath-skills");
        assertThat(store.list().get(0).loadedSkills())
                .containsExactly("byted-stock-monitor_classpath-skills");
    }
}

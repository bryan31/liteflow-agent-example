package com.yomahub.liteflow.examples.agent.skillstream.chat;

import com.yomahub.liteflow.agent.event.AgentEventTypeMapper;
import com.yomahub.liteflow.agent.event.AgentFlowEventData;
import com.yomahub.liteflow.flow.FlowEvent;
import io.agentscope.core.event.AgentEvent;
import io.agentscope.core.event.ToolCallDeltaEvent;
import io.agentscope.core.event.ToolCallStartEvent;
import io.agentscope.core.event.ToolResultEndEvent;
import io.agentscope.core.message.ToolResultState;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ChatEventMapperTest {

    @Test
    void mapsTypedReasoningToolAndResultEventsToUiStages() {
        ChatEventMapper mapper = new ChatEventMapper();

        ChatStreamEvent reasoning = mapper.fromFlowEvent(
                event(AgentEventTypeMapper.TEXT_DELTA, "想一下", false, null)).orElseThrow();
        ChatStreamEvent action = mapper.fromFlowEvent(event(
                AgentEventTypeMapper.TOOL_CALL_START,
                null,
                false,
                new ToolCallStartEvent("reply-1", "tool-1", "execute"))).orElseThrow();
        ChatStreamEvent result = mapper.fromFlowEvent(
                event(AgentEventTypeMapper.RESULT, "最终回答", true, null)).orElseThrow();

        assertThat(reasoning.stage()).isEqualTo("message");
        assertThat(action.stage()).isEqualTo("action");
        assertThat(action.toolName()).isEqualTo("execute");
        assertThat(result.stage()).isEqualTo("result");
        assertThat(result.done()).isTrue();
    }

    @Test
    void ignoresCompatibilityAliasesThatDuplicateTypedEvents() {
        ChatEventMapper mapper = new ChatEventMapper();

        assertThat(mapper.fromFlowEvent(
                event(AgentEventTypeMapper.REASONING, "重复文本", false, null))).isEmpty();
        assertThat(mapper.fromFlowEvent(
                event(AgentEventTypeMapper.TOOL_RESULT, "重复结果", false, null))).isEmpty();
    }

    @Test
    void exposesTypedToolCallDeltasWithoutDependingOnDeprecatedEvents() {
        ChatEventMapper mapper = new ChatEventMapper();
        ToolCallDeltaEvent source = new ToolCallDeltaEvent(
                "reply-1", "tool-1", "execute", "{\"command\":\"printf ok\"}");

        ChatStreamEvent mapped = mapper.fromFlowEvent(event(
                AgentEventTypeMapper.TOOL_CALL_DELTA, source.getDelta(), false, source)).orElseThrow();

        assertThat(mapped.stage()).isEqualTo("action");
        assertThat(mapped.toolCallId()).isEqualTo("tool-1");
        assertThat(mapped.replyId()).isEqualTo("reply-1");
        assertThat(mapped.toolName()).isEqualTo("execute");
        assertThat(mapped.toolInput()).containsEntry("delta", "{\"command\":\"printf ok\"}");
    }

    @Test
    void mapsTypedToolResultEndToActionDetails() {
        ChatEventMapper mapper = new ChatEventMapper();
        ToolResultEndEvent source = new ToolResultEndEvent(
                "reply-1", "tool-1", "execute", ToolResultState.SUCCESS);

        ChatStreamEvent mapped = mapper.fromFlowEvent(event(
                AgentEventTypeMapper.TOOL_RESULT_END, "工具返回内容", false, source)).orElseThrow();

        assertThat(mapped.stage()).isEqualTo("action");
        assertThat(mapped.toolName()).isEqualTo("execute");
        assertThat(mapped.toolResult()).isEqualTo("工具返回内容");
        assertThat(mapped.toolState()).isEqualTo("success");
    }

    @Test
    void thinkingDeltasKeepTheirBlockIdentityAndAreDistinctFromReplyText() {
        var source = new io.agentscope.core.event.ThinkingBlockDeltaEvent("reply-1", "thinking-1", "先检查");
        ChatStreamEvent mapped = new ChatEventMapper().fromFlowEvent(event(
                AgentEventTypeMapper.THINKING_DELTA, source.getDelta(), false, source)).orElseThrow();
        assertThat(mapped.stage()).isEqualTo("reasoning");
        assertThat(mapped.blockId()).isEqualTo("thinking-1");
        assertThat(mapped.text()).isEqualTo("先检查");
    }

    private FlowEvent event(String type, String text, boolean last, AgentEvent source) {
        Object data = source == null ? null : new AgentFlowEventData(
                source,
                "conv-1",
                "skillStreamAgent",
                "skillStreamChain",
                "skillStreamAgent",
                "request-1",
                "trace-1",
                "task-1",
                "reply-1");
        return FlowEvent.builder()
                .type(type)
                .chainId("skillStreamChain")
                .nodeId("skillStreamAgent")
                .conversationId("conv-1")
                .text(text)
                .last(last)
                .data(data)
                .build();
    }
}

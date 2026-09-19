package com.yomahub.liteflow.examples.agent.skillstream.chat;

import com.yomahub.liteflow.agent.event.AgentEventTypeMapper;
import com.yomahub.liteflow.agent.event.AgentFlowEventData;
import com.yomahub.liteflow.flow.FlowEvent;
import io.agentscope.core.event.AgentEvent;
import io.agentscope.core.event.AgentResultEvent;
import io.agentscope.core.event.TextBlockDeltaEvent;
import io.agentscope.core.event.ThinkingBlockDeltaEvent;
import io.agentscope.core.event.ToolCallDeltaEvent;
import io.agentscope.core.event.ToolCallEndEvent;
import io.agentscope.core.event.ToolCallStartEvent;
import io.agentscope.core.event.ToolResultDataDeltaEvent;
import io.agentscope.core.event.ToolResultEndEvent;
import io.agentscope.core.event.ToolResultStartEvent;
import io.agentscope.core.event.ToolResultTextDeltaEvent;
import io.agentscope.core.message.TextBlock;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Optional;

/** Preserve typed event identity and deltas all the way to the browser. */
@Component
public class ChatEventMapper {

    public Optional<ChatStreamEvent> fromFlowEvent(FlowEvent event) {
        if (ArtifactStore.EVENT_TYPE.equals(event.getType()) && event.getData() instanceof ArtifactInfo artifact) {
            return Optional.of(new ChatStreamEvent("artifact", event.getType(), event.getNodeId(),
                    event.getConversationId(), artifact.fileName(), null, Map.of(), null, false,
                    event.getTimestamp(), null, null, null, null, artifact));
        }
        if (AgentEventTypeMapper.REASONING.equals(event.getType())
                || AgentEventTypeMapper.TOOL_RESULT.equals(event.getType())
                || AgentEventTypeMapper.AGENT_START.equals(event.getType())
                || AgentEventTypeMapper.AGENT_END.equals(event.getType())) {
            return Optional.empty();
        }
        AgentFlowEventData data = event.getData() instanceof AgentFlowEventData value ? value : null;
        AgentEvent source = data == null ? null : data.event();
        String replyId = data == null ? null : data.replyId();
        if (source instanceof AgentResultEvent result && result.getResult() != null) {
            replyId = result.getResult().getId();
        }
        String toolResult = event.getType().startsWith("agent.tool.result") ? event.getText() : null;
        if (source instanceof ToolResultDataDeltaEvent delta && delta.getData() instanceof TextBlock text) {
            toolResult = text.getText();
        }
        return Optional.of(new ChatStreamEvent(
                stage(event.getType()), event.getType(), event.getNodeId(), event.getConversationId(),
                event.getText(), toolName(source),
                AgentEventTypeMapper.TOOL_CALL_DELTA.equals(event.getType()) && event.getText() != null
                        ? Map.of("delta", event.getText()) : Map.of(),
                toolResult, event.isLast() && AgentEventTypeMapper.RESULT.equals(event.getType()),
                event.getTimestamp(), replyId, blockId(source), toolCallId(source),
                source instanceof ToolResultEndEvent end && end.getState() != null ? end.getState().getValue() : null));
    }

    private String blockId(AgentEvent event) {
        if (event instanceof TextBlockDeltaEvent value) return value.getBlockId();
        return event instanceof ThinkingBlockDeltaEvent value ? value.getBlockId() : null;
    }

    private String toolName(AgentEvent event) {
        if (event instanceof ToolCallStartEvent value) return value.getToolCallName();
        if (event instanceof ToolCallDeltaEvent value) return value.getToolCallName();
        if (event instanceof ToolCallEndEvent value) return value.getToolCallName();
        if (event instanceof ToolResultStartEvent value) return value.getToolCallName();
        if (event instanceof ToolResultTextDeltaEvent value) return value.getToolCallName();
        if (event instanceof ToolResultDataDeltaEvent value) return value.getToolCallName();
        return event instanceof ToolResultEndEvent value ? value.getToolCallName() : null;
    }

    private String toolCallId(AgentEvent event) {
        if (event instanceof ToolCallStartEvent value) return value.getToolCallId();
        if (event instanceof ToolCallDeltaEvent value) return value.getToolCallId();
        if (event instanceof ToolCallEndEvent value) return value.getToolCallId();
        if (event instanceof ToolResultStartEvent value) return value.getToolCallId();
        if (event instanceof ToolResultTextDeltaEvent value) return value.getToolCallId();
        if (event instanceof ToolResultDataDeltaEvent value) return value.getToolCallId();
        return event instanceof ToolResultEndEvent value ? value.getToolCallId() : null;
    }

    private String stage(String type) {
        if (AgentEventTypeMapper.ERROR.equals(type)) return "error";
        if (type.startsWith("agent.tool.")) return "action";
        if (AgentEventTypeMapper.RESULT.equals(type)) return "result";
        if (AgentEventTypeMapper.TEXT_DELTA.equals(type)) return "message";
        if (AgentEventTypeMapper.SUMMARY.equals(type)) return "summary";
        return "reasoning";
    }
}

package com.yomahub.liteflow.examples.agent.skillstream.chat;

import java.util.Map;

public record ChatStreamEvent(
        String stage,
        String type,
        String nodeId,
        String conversationId,
        String text,
        String toolName,
        Map<String, Object> toolInput,
        String toolResult,
        boolean done,
        long timestamp,
        String replyId,
        String blockId,
        String toolCallId,
        String toolState,
        ArtifactInfo artifact) {

    public ChatStreamEvent(String stage, String type, String nodeId, String conversationId,
                           String text, String toolName, Map<String, Object> toolInput, String toolResult,
                           boolean done, long timestamp, String replyId, String blockId, String toolCallId, String toolState) {
        this(stage, type, nodeId, conversationId, text, toolName, toolInput, toolResult, done, timestamp,
                replyId, blockId, toolCallId, toolState, null);
    }

    public ChatStreamEvent(String stage, String type, String nodeId, String conversationId,
                           String text, String toolName, Map<String, Object> toolInput, String toolResult,
                           boolean done, long timestamp) {
        this(stage, type, nodeId, conversationId, text, toolName, toolInput, toolResult, done, timestamp,
                null, null, null, null);
    }
}

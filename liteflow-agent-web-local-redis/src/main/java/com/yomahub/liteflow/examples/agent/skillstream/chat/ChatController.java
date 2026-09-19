package com.yomahub.liteflow.examples.agent.skillstream.chat;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yomahub.liteflow.core.ExecuteOption;
import com.yomahub.liteflow.core.FlowExecutor;
import com.yomahub.liteflow.flow.LiteflowResponse;
import jakarta.annotation.PreDestroy;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import com.yomahub.liteflow.agent.conversation.AgentConversationPage;
import com.yomahub.liteflow.agent.conversation.AgentConversationMessage;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@RestController
@RequestMapping("/api/chat/sessions")
public class ChatController {

    private static final String CHAIN_ID = "skillStreamChain";

    private final ChatSessionStore store;
    private final FlowExecutor flowExecutor;
    private final ChatEventMapper eventMapper;
    private final ArtifactStore artifacts;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final ExecutorService executor = Executors.newCachedThreadPool();

    public ChatController(ChatSessionStore store, FlowExecutor flowExecutor, ChatEventMapper eventMapper, ArtifactStore artifacts) {
        this.store = store;
        this.flowExecutor = flowExecutor;
        this.eventMapper = eventMapper;
        this.artifacts = artifacts;
    }

    @PreDestroy
    void shutdownExecutor() {
        executor.shutdownNow();
    }

    @GetMapping
    public List<ChatSessionStore.ChatSessionSummary> sessions() {
        return store.list();
    }

    @PostMapping
    public ChatSessionStore.ChatSession create(@RequestBody(required = false) CreateSessionRequest request) {
        return store.createBlank(request == null ? null : request.title());
    }

    @GetMapping("/{sessionId}")
    public ChatSessionStore.ChatSession session(@PathVariable("sessionId") String sessionId) {
        return store.get(sessionId);
    }

    @GetMapping("/{sessionId}/messages")
    public AgentConversationPage<AgentConversationMessage> messages(
            @PathVariable("sessionId") String sessionId,
            @RequestParam(name = "cursor", defaultValue = "0") long cursor,
            @RequestParam(name = "limit", defaultValue = "100") int limit) {
        if (cursor < 0 || limit < 1 || limit > 200) {
            throw new org.springframework.web.server.ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "cursor must be non-negative and limit must be between 1 and 200");
        }
        return store.messages(sessionId, cursor, limit);
    }

    @DeleteMapping("/{sessionId}")
    public void delete(@PathVariable("sessionId") String sessionId) {
        store.delete(sessionId);
        artifacts.delete(sessionId);
    }

    @GetMapping("/{sessionId}/artifacts/{artifactId}")
    public ResponseEntity<byte[]> artifact(@PathVariable("sessionId") String sessionId,
                                           @PathVariable("artifactId") String artifactId) {
        store.require(sessionId);
        var file = artifacts.get(sessionId, artifactId);
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_OCTET_STREAM)
                .contentLength(file.content().length)
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename(file.fileName(), StandardCharsets.UTF_8).build().toString())
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .header("X-Content-Type-Options", "nosniff")
                .body(file.content());
    }

    @PostMapping(path = "/{sessionId}/messages/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@PathVariable("sessionId") String sessionId, @RequestBody ChatMessageRequest request,
                             HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-cache, no-transform");
        response.setHeader("X-Accel-Buffering", "no");
        SseEmitter emitter = new SseEmitter(0L);
        String prompt = request == null ? "" : request.message();
        if (prompt == null || prompt.isBlank()) {
            sendAndComplete(emitter, "error", Map.of("message", "消息不能为空"));
            return emitter;
        }

        store.addMessage(sessionId, "user", "input", prompt.trim());
        executor.submit(() -> runAgent(sessionId, prompt.trim(), emitter));
        return emitter;
    }

    private void runAgent(String sessionId, String prompt, SseEmitter emitter) {
        long startedAt = System.currentTimeMillis();
        StringBuilder finalReply = new StringBuilder();
        List<ChatStreamEvent> traceEvents = new ArrayList<>();
        try {
            send(emitter, "status", Map.of("message", "started", "startedAt", startedAt));
            LiteflowResponse response = flowExecutor.execute2Resp(
                    CHAIN_ID,
                    prompt,
                    ExecuteOption.of()
                            .conversationId(sessionId)
                            .eventListener(event -> eventMapper.fromFlowEvent(event).ifPresent(streamEvent -> {
                                if ("result".equals(streamEvent.stage()) && streamEvent.text() != null) {
                                    finalReply.setLength(0);
                                    finalReply.append(streamEvent.text());
                                } else {
                                    traceEvents.add(streamEvent);
                                }
                                send(emitter, streamEvent.stage(), streamEvent);
                            })));

            if (!response.isSuccess()) {
                String message = response.getCause() == null ? response.getMessage() : response.getCause().getMessage();
                String error = message == null ? "LiteFlow chain failed" : message;
                store.addMessage(sessionId, "assistant", "trace", tracePayload("失败", traceWithError(traceEvents, error), startedAt));
                send(emitter, "error", Map.of("message", error));
                emitter.complete();
                return;
            }

            Object responseData = response.getSlot().getResponseData();
            recordUsedSkills(sessionId, responseData);
            String reply = finalReply.isEmpty() ? extractReply(responseData) : finalReply.toString();
            store.addMessage(sessionId, "assistant", "trace", tracePayload("已完成", traceEvents, startedAt));
            store.addMessage(sessionId, "assistant", "result", reply);
            send(emitter, "done", Map.of("message", "completed", "reply", reply, "output", responseData,
                    "durationMs", System.currentTimeMillis() - startedAt));
            emitter.complete();
        } catch (Exception e) {
            String message = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            try {
                store.addMessage(sessionId, "assistant", "trace", tracePayload("失败", traceWithError(traceEvents, message), startedAt));
            } catch (RuntimeException persistenceFailure) {
                if (persistenceFailure != e) {
                    e.addSuppressed(persistenceFailure);
                }
            }
            send(emitter, "error", Map.of("message", message));
            emitter.completeWithError(e);
        }
    }

    private String tracePayload(String status, List<ChatStreamEvent> events, long startedAt) {
        try {
            return objectMapper.writeValueAsString(new TraceMessage(status, events, System.currentTimeMillis() - startedAt));
        } catch (JsonProcessingException e) {
            return "{\"status\":\"" + status + "\",\"events\":[]}";
        }
    }

    private List<ChatStreamEvent> traceWithError(List<ChatStreamEvent> traceEvents, String message) {
        List<ChatStreamEvent> events = new ArrayList<>(traceEvents);
        events.add(new ChatStreamEvent("action", "error", null, null, "执行失败：" + message, null, Map.of(), null,
                false, System.currentTimeMillis()));
        return events;
    }

    private String extractReply(Object responseData) {
        if (responseData instanceof Map<?, ?> map) {
            Object reply = map.get("reply");
            return reply == null ? "" : reply.toString();
        }
        return responseData == null ? "" : responseData.toString();
    }

    private void recordUsedSkills(String sessionId, Object responseData) {
        if (!(responseData instanceof Map<?, ?> map) || !(map.get("usedSkills") instanceof List<?> skills)) {
            return;
        }
        store.recordLoadedSkills(sessionId, skills.stream().map(Object::toString).toList());
    }

    private void sendAndComplete(SseEmitter emitter, String event, Object data) {
        send(emitter, event, data);
        emitter.complete();
    }

    private void send(SseEmitter emitter, String event, Object data) {
        try {
            emitter.send(SseEmitter.event().name(event).data(data));
        } catch (IOException ignored) {
            emitter.complete();
        }
    }

    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public Map<String, String> notFound(IllegalArgumentException e) {
        return Map.of("message", e.getMessage());
    }

    public record CreateSessionRequest(String title) {
    }

    public record ChatMessageRequest(String message) {
    }

    public record TraceMessage(String status, List<ChatStreamEvent> events, long durationMs) {
    }
}

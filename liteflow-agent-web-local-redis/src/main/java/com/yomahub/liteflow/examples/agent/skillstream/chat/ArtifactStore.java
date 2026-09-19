package com.yomahub.liteflow.examples.agent.skillstream.chat;

import com.yomahub.liteflow.agent.context.LiteFlowAgentContext;
import com.yomahub.liteflow.agent.harness.storage.HarnessStorage;
import com.yomahub.liteflow.flow.FlowEvent;
import com.yomahub.liteflow.flow.FlowEventPublisher;
import com.yomahub.liteflow.property.LiteflowConfig;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.harness.agent.artifact.ArtifactDeliveryRequest;
import io.agentscope.harness.agent.artifact.ArtifactDeliveryResult;
import io.agentscope.harness.agent.artifact.ArtifactDeliveryTarget;
import io.agentscope.harness.agent.filesystem.remote.store.BaseStore;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/** Delivers workspace files into the same Redis workspace store used by this example. */
@Component
public class ArtifactStore implements ArtifactDeliveryTarget {
    public static final String EVENT_TYPE = "agent.artifact.delivered";

    private final HarnessStorage storage;
    private final BaseStore store;
    private final String namespace;

    @Autowired
    public ArtifactStore(LiteflowConfig property) {
        this(HarnessStorage.open(property.getAgent().getSessionStore()),
                property.getAgent().getApplicationName());
    }

    ArtifactStore(HarnessStorage storage, String namespace) {
        this.storage = Objects.requireNonNull(storage);
        this.store = storage.store();
        this.namespace = Objects.requireNonNull(namespace);
    }

    @Override
    public ArtifactDeliveryResult deliver(RuntimeContext runtimeContext, ArtifactDeliveryRequest request) {
        LiteFlowAgentContext context = runtimeContext == null ? null : runtimeContext.get(LiteFlowAgentContext.class);
        if (context == null || !namespace.equals(context.getNamespace())) {
            return ArtifactDeliveryResult.fail("Artifact delivery requires this application's conversation context");
        }
        String name = request.fileName();
        if (name == null || name.isBlank() || name.equals(".") || name.equals("..")
                || name.contains("/") || name.contains("\\") || name.chars().anyMatch(Character::isISOControl)) {
            return ArtifactDeliveryResult.fail("A plain file name is required");
        }
        byte[] content = request.content();
        if (content == null) {
            return ArtifactDeliveryResult.fail("Artifact content is required");
        }
        String sessionId = context.getConversationId();
        String id = fileId(name);
        String description = request.description() == null ? "" : request.description();
        Map<String, Object> value = Map.of("fileName", name, "description", description,
                "content", Base64.getEncoder().encodeToString(content));
        if (request.force()) {
            store.put(address(sessionId), id, value);
        } else if (!store.putIfVersion(address(sessionId), id, value, 0)) {
            return ArtifactDeliveryResult.conflict("A file with this name already exists in the conversation");
        }
        ArtifactInfo artifact = new ArtifactInfo(id, name, content.length,
                "/api/chat/sessions/" + java.net.URLEncoder.encode(sessionId, StandardCharsets.UTF_8)
                        + "/artifacts/" + id, description);
        FlowEventPublisher.publish(context.getSlot(), FlowEvent.builder()
                .type(EVENT_TYPE).chainId(context.getChainId()).nodeId(context.getNodeId())
                .requestId(context.getRequestId()).conversationId(sessionId).text(name).data(artifact).build());
        return ArtifactDeliveryResult.success("The file is available in the conversation's download list");
    }

    StoredArtifact get(String sessionId, String id) {
        if (id == null || !id.matches("[0-9a-f]{64}")) throw new IllegalArgumentException("Artifact not found");
        var item = store.get(address(sessionId), id);
        if (item == null) throw new IllegalArgumentException("Artifact not found");
        return new StoredArtifact((String) item.value().get("fileName"),
                Base64.getDecoder().decode((String) item.value().get("content")));
    }

    void delete(String sessionId) {
        var address = address(sessionId);
        while (true) {
            var items = store.search(address, 100, 0);
            if (items.isEmpty()) return;
            items.forEach(item -> store.delete(address, item.key()));
        }
    }

    private List<String> address(String sessionId) {
        return List.of("liteflow", namespace, "artifacts-v2", sessionId);
    }

    private static String fileId(String name) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(name.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    @PreDestroy
    public void close() {
        storage.close();
    }

    record StoredArtifact(String fileName, byte[] content) { }
}

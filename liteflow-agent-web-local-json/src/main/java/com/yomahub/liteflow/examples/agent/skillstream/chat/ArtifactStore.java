package com.yomahub.liteflow.examples.agent.skillstream.chat;

import com.yomahub.liteflow.agent.context.LiteFlowAgentContext;
import com.yomahub.liteflow.agent.context.InvocationIdentityResolver;
import com.yomahub.liteflow.flow.FlowEvent;
import com.yomahub.liteflow.flow.FlowEventPublisher;
import com.yomahub.liteflow.property.LiteflowConfig;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.harness.agent.artifact.ArtifactDeliveryRequest;
import io.agentscope.harness.agent.artifact.ArtifactDeliveryResult;
import io.agentscope.harness.agent.artifact.ArtifactDeliveryTarget;
import io.agentscope.core.state.AgentStateStore;
import io.agentscope.core.state.JsonFileAgentStateStore;
import io.agentscope.core.state.State;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Objects;

/** Persists delivered workspace files as JSON in this example's local artifact directory. */
@Component
public class ArtifactStore implements ArtifactDeliveryTarget {
    public static final String EVENT_TYPE = "agent.artifact.delivered";

    private final AgentStateStore store;
    private final String namespace;

    @Autowired
    public ArtifactStore(LiteflowConfig property, @Value("${example.artifacts.root}") String root) {
        this(new JsonFileAgentStateStore(Path.of(root)),
                property.getAgent().getApplicationName());
    }

    ArtifactStore(AgentStateStore store, String namespace) {
        this.store = Objects.requireNonNull(store);
        this.namespace = Objects.requireNonNull(namespace);
    }

    @Override
    public synchronized ArtifactDeliveryResult deliver(RuntimeContext runtimeContext, ArtifactDeliveryRequest request) {
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
        // This single-process example serializes create/overwrite/delete operations.
        if (!request.force() && store.get(null, address(sessionId), id, ArtifactState.class).isPresent()) {
            return ArtifactDeliveryResult.conflict("A file with this name already exists in the conversation");
        }
        store.save(null, address(sessionId), id,
                new ArtifactState(name, description, Base64.getEncoder().encodeToString(content)));
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
        var item = store.get(null, address(sessionId), id, ArtifactState.class)
                .orElseThrow(() -> new IllegalArgumentException("Artifact not found"));
        return new StoredArtifact(item.fileName(), Base64.getDecoder().decode(item.content()));
    }

    synchronized void delete(String sessionId) {
        store.delete(null, address(sessionId));
    }

    private String address(String sessionId) {
        return new InvocationIdentityResolver(namespace).resolve(sessionId, "artifacts-v1").storeSessionId();
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
        store.close();
    }

    public record ArtifactState(String fileName, String description, String content) implements State { }

    record StoredArtifact(String fileName, byte[] content) { }
}

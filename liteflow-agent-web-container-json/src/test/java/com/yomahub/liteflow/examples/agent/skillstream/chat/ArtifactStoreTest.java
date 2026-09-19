package com.yomahub.liteflow.examples.agent.skillstream.chat;

import com.yomahub.liteflow.agent.context.InvocationIdentityResolver;
import com.yomahub.liteflow.agent.context.LiteFlowAgentContext;
import com.yomahub.liteflow.agent.message.AgentOutputSpec;
import com.yomahub.liteflow.core.FlowExecutor;
import com.yomahub.liteflow.flow.FlowEvent;
import com.yomahub.liteflow.flow.FlowEventPublisher;
import com.yomahub.liteflow.slot.Slot;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.harness.agent.artifact.ArtifactDeliveryRequest;
import io.agentscope.core.state.JsonFileAgentStateStore;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ArtifactStoreTest {
    @org.junit.jupiter.api.io.TempDir java.nio.file.Path artifactRoot;
    private final List<FlowEvent> events = new ArrayList<>();

    @Test
    void officialDeliveryToolReadsTheProducedFileAndPublishesADownload(@org.junit.jupiter.api.io.TempDir java.nio.file.Path root) throws Exception {
        java.nio.file.Files.writeString(root.resolve("report.csv"), "name,total\nexample,12", StandardCharsets.UTF_8);
        var filesystem = new io.agentscope.harness.agent.filesystem.local.LocalFilesystem(root);
        var target = store("alice");
        var tool = new io.agentscope.harness.agent.tool.ArtifactDeliveryTool(filesystem, null, target);
        String result = tool.deliverArtifact(context("alice", "conversation"), "report.csv", null, "Report", false);
        assertThat(result).startsWith("Delivered");
        ArtifactInfo artifact = (ArtifactInfo) events.get(0).getData();
        assertThat(target.get("conversation", artifact.id()).content())
                .isEqualTo(java.nio.file.Files.readAllBytes(root.resolve("report.csv")));
    }

    private ArtifactStore store(String user) {
        return new ArtifactStore(new JsonFileAgentStateStore(artifactRoot), "artifact-test-" + user);
    }

    private RuntimeContext context(String user, String session) {
        var identity = new InvocationIdentityResolver("artifact-test-" + user).resolve(session, "agent");
        var slot = new Slot();
        FlowEventPublisher.setListener(slot, events::add);
        var context = new LiteFlowAgentContext(identity, slot, "chain", "agent", "request", "trace",
                Instant.now().plusSeconds(60), AgentOutputSpec.text(), "attachment");
        var runtime = RuntimeContext.builder().sessionId(identity.runtimeSessionId()).build();
        runtime.put(LiteFlowAgentContext.class, context);
        return runtime;
    }

    private ArtifactDeliveryRequest file(String name, String content, boolean force) {
        return new ArtifactDeliveryRequest("/workspace/" + name, content.getBytes(StandardCharsets.UTF_8),
                name, "生成的报告", force);
    }

    @Test
    void deliveryPersistsBytesAndMetadataAcrossReopenAndEnforcesNamesAndIsolation() {
        var alice = store("alice");
        var runtime = context("alice", "conversation-a");
        assertThat(alice.deliver(runtime, file("报告.csv", "first", false)).successful()).isTrue();
        ArtifactInfo artifact = (ArtifactInfo) events.get(0).getData();
        assertThat(artifact.fileName()).isEqualTo("报告.csv");
        assertThat(new ChatEventMapper().fromFlowEvent(events.get(0)).orElseThrow().artifact()).isEqualTo(artifact);
        alice.close();
        var reopened = store("alice");
        assertThat(reopened.get("conversation-a", artifact.id()).content()).isEqualTo("first".getBytes(StandardCharsets.UTF_8));
        assertThat(reopened.deliver(runtime, file("报告.csv", "second", false)).conflict()).isTrue();
        assertThat(events).hasSize(1);
        assertThat(reopened.deliver(runtime, file("报告.csv", "second", true)).successful()).isTrue();
        assertThat(reopened.get("conversation-a", artifact.id()).content()).isEqualTo("second".getBytes(StandardCharsets.UTF_8));
        assertThatThrownBy(() -> reopened.get("conversation-b", artifact.id())).isInstanceOf(IllegalArgumentException.class);
        var bob = store("bob");
        assertThatThrownBy(() -> bob.get("conversation-a", artifact.id())).isInstanceOf(IllegalArgumentException.class);
        assertThat(bob.deliver(context("bob", "conversation-a"), file("报告.csv", "bob", false)).successful()).isTrue();
        reopened.delete("conversation-a");
        assertThatThrownBy(() -> reopened.get("conversation-a", artifact.id())).isInstanceOf(IllegalArgumentException.class);
        assertThat(bob.get("conversation-a", artifact.id()).content()).isEqualTo("bob".getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void invalidContextAndNameCannotPublishOrPersistAnArtifact() {
        var store = store("alice");
        var runtime = context("alice", "conversation");
        assertThat(store.deliver(null, file("report.csv", "one", false)).successful()).isFalse();
        assertThat(store.deliver(context("bob", "conversation"), file("report.csv", "one", false)).successful()).isFalse();
        assertThat(store.deliver(runtime, file("../report.csv", "one", false)).successful()).isFalse();
        assertThat(events).isEmpty();
        assertThat(new JsonFileAgentStateStore(artifactRoot).listSessionIds("alice")).isEmpty();
    }

    @Test
    void filesLargerThanTheFormerLimitCanBeDeliveredAndReadBack() {
        var store = store("alice");
        String content = "x".repeat(11 * 1024 * 1024);
        assertThat(store.deliver(context("alice", "conversation"), file("large.txt", content, false)).successful()).isTrue();
        ArtifactInfo artifact = (ArtifactInfo) events.get(0).getData();
        assertThat(store.get("conversation", artifact.id()).content()).isEqualTo(content.getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void downloadReturnsAnAttachmentAndDeletedOrForeignSessionsCannotReadIt() throws Exception {
        var sessions = new ChatSessionStore();
        String session = sessions.create("生成报告").id();
        var artifacts = store("anonymous");
        assertThat(artifacts.deliver(context("anonymous", session), file("报告.csv", "a,b\n1,2", false)).successful()).isTrue();
        ArtifactInfo artifact = (ArtifactInfo) events.get(0).getData();
        var controller = new ChatController(sessions, mock(FlowExecutor.class), new ChatEventMapper(), artifacts);
        var mvc = MockMvcBuilders.standaloneSetup(controller).build();
        try {
            mvc.perform(get(artifact.downloadUrl())).andExpect(status().isOk())
                    .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                    .andExpect(header().string("Content-Disposition", org.hamcrest.Matchers.startsWith("attachment;")))
                    .andExpect(content().bytes("a,b\n1,2".getBytes(StandardCharsets.UTF_8)));
            mvc.perform(get("/api/chat/sessions/foreign/artifacts/" + artifact.id())).andExpect(status().isNotFound());
            mvc.perform(delete("/api/chat/sessions/" + session)).andExpect(status().isOk());
            mvc.perform(get(artifact.downloadUrl())).andExpect(status().isNotFound());
            assertThatThrownBy(() -> artifacts.get(session, artifact.id())).isInstanceOf(IllegalArgumentException.class);
        } finally {
            controller.shutdownExecutor();
        }
    }
}

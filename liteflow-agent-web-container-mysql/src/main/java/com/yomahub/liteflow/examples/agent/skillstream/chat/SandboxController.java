package com.yomahub.liteflow.examples.agent.skillstream.chat;

import com.yomahub.liteflow.agent.harness.sandbox.AgentSandboxStatus;
import com.yomahub.liteflow.agent.harness.sandbox.AgentSandboxStatusService;
import com.yomahub.liteflow.property.LiteflowConfig;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Adapts the module's read-only sandbox query to the example's conversation API. */
@RestController
@RequestMapping("/api/chat/sessions")
public class SandboxController {
    private final ChatSessionStore sessions;
    private final AgentSandboxStatusService sandboxes;

    @Autowired
    public SandboxController(ChatSessionStore sessions, LiteflowConfig property) {
        this(sessions, new AgentSandboxStatusService(property.getAgent().getApplicationName()));
    }

    SandboxController(ChatSessionStore sessions, AgentSandboxStatusService sandboxes) {
        this.sessions = sessions;
        this.sandboxes = sandboxes;
    }

    @GetMapping("/{sessionId}/sandbox")
    public ResponseEntity<AgentSandboxStatus> status(@PathVariable("sessionId") String sessionId) {
        try {
            sessions.require(sessionId);
        } catch (IllegalArgumentException missing) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "会话不存在", missing);
        }
        return ResponseEntity.ok().header("Cache-Control", "no-store")
                .body(sandboxes.getStatus(sessionId));
    }
}

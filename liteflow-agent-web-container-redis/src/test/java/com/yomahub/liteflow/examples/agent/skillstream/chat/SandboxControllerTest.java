package com.yomahub.liteflow.examples.agent.skillstream.chat;

import com.yomahub.liteflow.agent.harness.sandbox.AgentSandboxStatus;
import com.yomahub.liteflow.agent.harness.sandbox.AgentSandboxStatusService;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class SandboxControllerTest {
    @Test
    void exposesReadOnlyStatusForAnExistingConversationAndRejectsUnknownOrDeletedOnes() throws Exception {
        var sessions = new ChatSessionStore();
        String id = sessions.createBlank("sandbox").id();
        var service = mock(AgentSandboxStatusService.class);
        when(service.getStatus(id)).thenReturn(new AgentSandboxStatus(id, "PROCESS_LOCAL",
                AgentSandboxStatus.State.RUNNING, "abc", "sandbox", "test:latest", true, 123L, 456L, null));
        var mvc = MockMvcBuilders.standaloneSetup(new SandboxController(sessions, service)).build();
        mvc.perform(get("/api/chat/sessions/{id}/sandbox", id))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.state").value("RUNNING"))
                .andExpect(jsonPath("$.containerId").value("abc"))
                .andExpect(jsonPath("$.busy").value(true))
                .andExpect(jsonPath("$.lastActiveAt").value(123));
        mvc.perform(get("/api/chat/sessions/unknown/sandbox")).andExpect(status().isNotFound());
        sessions.delete(id);
        mvc.perform(get("/api/chat/sessions/{id}/sandbox", id)).andExpect(status().isNotFound());
        verify(service, times(1)).getStatus(id);
        verifyNoMoreInteractions(service);
    }
}

package com.yomahub.liteflow.examples.agent.skillstream.cmp;

import com.yomahub.liteflow.agent.harness.component.HarnessAgentComponent;
import io.agentscope.core.permission.PermissionContextState;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;

class SkillStreamAgentCmpTest {

    @Test
    void systemPromptRequestsVisibleReasoningSummaryBeforeToolCalls() {
        TestableSkillStreamAgentCmp cmp = new TestableSkillStreamAgentCmp();

        String prompt = cmp.prompt();

        assertThat(prompt)
                .contains("使用用户提问所用的语言")
                .contains("调用工具前")
                .contains("简短说明")
                .contains("按 Agent 工作流执行技能");
    }

    @Test
    void modelSpecUsesStreamingResponses() {
        TestableSkillStreamAgentCmp cmp = new TestableSkillStreamAgentCmp();
        ReflectionTestUtils.setField(cmp, "modelName", "deepseek-v4-flash");

        assertThat(cmp.modelSpec().getStream()).isTrue();
    }

    @Test
    void componentUsesConfigurationDrivenSkillsAndHarnessDefaultPermissions() {
        TestableSkillStreamAgentCmp cmp = new TestableSkillStreamAgentCmp();

        assertThat(HarnessAgentComponent.class).isAssignableFrom(SkillStreamAgentCmp.class);
        assertThat(cmp.permissions()).isNull();
        assertThat(cmp.shellEnabled()).isTrue();
    }

    private static class TestableSkillStreamAgentCmp extends SkillStreamAgentCmp {
        boolean shellEnabled() { return enableShellTool(); }
        String prompt() {
            return effectiveSystemPrompt();
        }

        com.yomahub.liteflow.agent.model.ModelSpec<?> modelSpec() {
            return model();
        }

        PermissionContextState permissions() {
            return permissionContext();
        }
    }
}

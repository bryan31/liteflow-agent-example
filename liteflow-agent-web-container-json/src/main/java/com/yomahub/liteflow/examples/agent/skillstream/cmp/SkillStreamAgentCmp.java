package com.yomahub.liteflow.examples.agent.skillstream.cmp;

import com.yomahub.liteflow.agent.context.LiteFlowAgentContext;
import com.yomahub.liteflow.agent.harness.component.HarnessAgentComponent;
import com.yomahub.liteflow.agent.model.ModelSpec;
import com.yomahub.liteflow.agent.openai.DeepSeek;
import com.yomahub.liteflow.annotation.LiteflowComponent;
import com.yomahub.liteflow.examples.agent.skillstream.chat.ArtifactStore;
import io.agentscope.core.message.Msg;
import io.agentscope.harness.agent.HarnessAgent;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;

import java.util.LinkedHashMap;
import java.util.Map;

@LiteflowComponent("skillStreamAgent")
public class SkillStreamAgentCmp extends HarnessAgentComponent {

    @Value("${example.agent.model:deepseek-v4-flash}")
    private String modelName;

    @Autowired
    private ArtifactStore artifactStore;

    @Override
    protected HarnessAgent.Builder customizeHarness(HarnessAgent.Builder builder) {
        return builder.artifactDeliveryTarget(artifactStore);
    }

    @Override
    protected ModelSpec<?> model() {
        return DeepSeek.of(modelName).stream(true);
    }

    @Override
    protected String systemPrompt() {
        return "你在 AgentScope 2 Harness Docker 沙箱中工作。按 Agent 工作流执行技能，"
                + "调用工具前使用用户提问所用的语言做简短说明；最终不要输出原始 JSON，"
                + "而要总结其中的数据并条理清晰地展现给用户。"
                + "用户要求生成文件时，将文件写入工作区，再调用 deliver_artifact 交付产物。";
    }

    @Override
    protected String userPrompt(LiteFlowAgentContext context) {
        return this.getRequestData();
    }

    @Override
    protected void handleReply(Msg reply, LiteFlowAgentContext context) {
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("reply", reply == null ? null : reply.getTextContent());
        output.put("usedSkills", context.getUsedSkills());
        getSlot().setResponseData(output);
    }
}

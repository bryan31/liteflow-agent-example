package com.yomahub.liteflow.examples.jev.bool;

import com.yomahub.liteflow.agent.jev.JevBooleanComponent;
import com.yomahub.liteflow.agent.jev.JevNoulResult;
import com.yomahub.liteflow.annotation.LiteflowComponent;

/** Asks one yes/no question per request: the user supplies both the standard and the subject. */
@LiteflowComponent("statementJudge")
public class StatementJudge extends JevBooleanComponent {
    @Override
    protected Object state() {
        return getContextBean(JudgeContext.class).getSubject();
    }

    @Override
    protected String instructions() {
        return getContextBean(JudgeContext.class).getQuestion();
    }

    @Override
    protected void onDecision(JevNoulResult result) {
        getContextBean(JudgeContext.class).setDecision(result);
    }
}

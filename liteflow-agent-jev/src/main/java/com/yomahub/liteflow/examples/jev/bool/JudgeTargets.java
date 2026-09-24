package com.yomahub.liteflow.examples.jev.bool;

import com.yomahub.liteflow.core.NodeComponent;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Fixed branch IDs keep the IF outcome separate from user-supplied question text. */
@Configuration
public class JudgeTargets {
    @Bean("judgeYes") public NodeComponent yes() { return new Verdict(true); }
    @Bean("judgeNo") public NodeComponent no() { return new Verdict(false); }

    public static class Verdict extends NodeComponent {
        private final boolean verdict;

        public Verdict(boolean verdict) { this.verdict = verdict; }

        @Override
        public void process() {
            getContextBean(JudgeContext.class).complete(verdict,
                    verdict ? "判断结果为「是」：内容符合判断标准。" : "判断结果为「否」：内容不符合判断标准。");
        }
    }
}

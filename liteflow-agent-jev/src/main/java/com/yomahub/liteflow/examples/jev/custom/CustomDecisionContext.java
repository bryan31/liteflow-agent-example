package com.yomahub.liteflow.examples.jev.custom;

import com.yomahub.liteflow.agent.jev.JevChoiceResult;

import java.util.List;

/** One immutable input snapshot per execution of the customDecision chain. */
public class CustomDecisionContext {
    public static final int MIN_OPTIONS = 2;
    public static final int MAX_OPTIONS = 8;

    private final String question;
    private final List<Option> options;
    private JevChoiceResult decision;
    private String handledBy;
    private String reply;

    public CustomDecisionContext(String question, List<Option> options) {
        this.question = question;
        this.options = List.copyOf(options);
    }

    public String getQuestion() { return question; }
    public List<Option> getOptions() { return options; }
    public JevChoiceResult getDecision() { return decision; }
    public void setDecision(JevChoiceResult decision) { this.decision = decision; }
    public String getHandledBy() { return handledBy; }
    public String getReply() { return reply; }

    public void complete(String handledBy, String reply) {
        this.handledBy = handledBy;
        this.reply = reply;
    }

    public record Option(String id, String label) { }
}

package com.yomahub.liteflow.examples.jev;

import com.yomahub.liteflow.agent.jev.JevChoiceResult;

/** Each HTTP request owns one context; shared components contain no request state. */
public class SupportContext {
    private final String message;
    private JevChoiceResult decision;
    private String handledBy;
    private String reply;

    public SupportContext(String message) { this.message = message; }
    public String getMessage() { return message; }
    public JevChoiceResult getDecision() { return decision; }
    public void setDecision(JevChoiceResult decision) { this.decision = decision; }
    public String getHandledBy() { return handledBy; }
    public String getReply() { return reply; }

    public void complete(String handledBy, String reply) {
        this.handledBy = handledBy;
        this.reply = reply;
    }
}

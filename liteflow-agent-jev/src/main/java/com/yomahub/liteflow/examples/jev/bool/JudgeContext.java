package com.yomahub.liteflow.examples.jev.bool;

import com.yomahub.liteflow.agent.jev.JevNoulResult;

/** Each HTTP request owns one context; shared components contain no request state. */
public class JudgeContext {
    private final String question;
    private final String subject;
    private JevNoulResult decision;
    private Boolean verdict;
    private String reply;

    public JudgeContext(String question, String subject) {
        this.question = question;
        this.subject = subject;
    }

    public String getQuestion() { return question; }
    public String getSubject() { return subject; }
    public JevNoulResult getDecision() { return decision; }
    public void setDecision(JevNoulResult decision) { this.decision = decision; }
    public Boolean getVerdict() { return verdict; }
    public String getReply() { return reply; }

    public void complete(boolean verdict, String reply) {
        this.verdict = verdict;
        this.reply = reply;
    }
}

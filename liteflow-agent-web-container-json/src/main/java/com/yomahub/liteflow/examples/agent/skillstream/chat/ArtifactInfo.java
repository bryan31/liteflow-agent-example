package com.yomahub.liteflow.examples.agent.skillstream.chat;

/** Browser-facing artifact metadata; file bytes remain in the authoritative store. */
public record ArtifactInfo(String id, String fileName, long size, String downloadUrl, String description) {
}

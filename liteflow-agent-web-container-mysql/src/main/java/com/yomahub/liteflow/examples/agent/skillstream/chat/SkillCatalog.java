package com.yomahub.liteflow.examples.agent.skillstream.chat;

import io.agentscope.core.skill.repository.AgentSkillRepository;
import io.agentscope.core.skill.repository.ClasspathSkillRepository;
import io.agentscope.core.skill.repository.FileSystemSkillRepository;
import com.yomahub.liteflow.springboot4.LiteflowProperty;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;

@Component
public class SkillCatalog {

    private final AgentSkillRepository repository;

    @Autowired
    public SkillCatalog(LiteflowProperty liteflowProperty) {
        this(repositoryFor(liteflowProperty));
    }

    public SkillCatalog() {
        this(repositoryForPath("classpath:agent/skills"));
    }

    private SkillCatalog(AgentSkillRepository repository) {
        this.repository = repository;
    }

    private static AgentSkillRepository repositoryFor(LiteflowProperty liteflowProperty) {
        if (liteflowProperty.getAgent() == null || liteflowProperty.getAgent().getSkills() == null) {
            throw new IllegalStateException("liteflow.agent.skills must be configured");
        }
        return repositoryForPath(liteflowProperty.getAgent().getSkills().getPath());
    }

    private static AgentSkillRepository repositoryForPath(String configuredPath) {
        String path = configuredPath == null || configuredPath.isBlank()
                ? "classpath:agent/skills" : configuredPath.trim();
        try {
            if (path.startsWith("classpath:")) {
                String resourcePath = path.substring("classpath:".length());
                while (resourcePath.startsWith("/")) {
                    resourcePath = resourcePath.substring(1);
                }
                return new ClasspathSkillRepository(resourcePath);
            }
            return new FileSystemSkillRepository(Path.of(path), false);
        } catch (IOException e) {
            throw new IllegalStateException("无法加载 Skill 目录：" + path, e);
        }
    }

    @PreDestroy
    void close() {
        repository.close();
    }

    public List<SkillSummary> list() {
        return repository.getAllSkills().stream()
                .map(skill -> new SkillSummary(skill.getSkillId(), skill.getName(), skill.getDescription(), skill.getSource()))
                .toList();
    }

    public record SkillSummary(String id, String name, String description, String source) {
    }
}

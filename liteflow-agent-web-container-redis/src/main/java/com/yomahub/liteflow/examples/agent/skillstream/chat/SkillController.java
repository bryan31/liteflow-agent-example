package com.yomahub.liteflow.examples.agent.skillstream.chat;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/skills")
public class SkillController {

    private final SkillCatalog skillCatalog;

    public SkillController(SkillCatalog skillCatalog) {
        this.skillCatalog = skillCatalog;
    }

    @GetMapping
    public List<SkillCatalog.SkillSummary> skills() {
        return skillCatalog.list();
    }
}

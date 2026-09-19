package com.yomahub.liteflow.examples.agent.skillstream.chat;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class SkillCatalogTest {

    @Test
    void listsClasspathSkillsWithStableIdsAndDescriptions() {
        SkillCatalog catalog = new SkillCatalog();

        assertThat(catalog.list()).isNotEmpty();
        assertThat(catalog.list().get(0).id()).contains(catalog.list().get(0).name());
        assertThat(catalog.list().get(0).description()).isNotBlank();

        catalog.close();
    }
}

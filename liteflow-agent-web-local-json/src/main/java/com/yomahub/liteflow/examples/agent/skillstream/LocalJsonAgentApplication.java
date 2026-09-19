package com.yomahub.liteflow.examples.agent.skillstream;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;

import java.nio.file.Files;
import java.nio.file.Path;

@SpringBootApplication
public class LocalJsonAgentApplication {

    @Bean
    InitializingBean localWorkspace(@Value("${liteflow.agent.harness.local.workspace-root}") String root) {
        return () -> Files.createDirectories(Path.of(root));
    }

    public static void main(String[] args) {
        SpringApplication.run(LocalJsonAgentApplication.class, args);
    }

}

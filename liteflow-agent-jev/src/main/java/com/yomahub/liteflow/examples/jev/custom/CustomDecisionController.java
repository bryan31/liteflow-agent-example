package com.yomahub.liteflow.examples.jev.custom;

import com.yomahub.liteflow.agent.jev.JevChoiceResult;
import com.yomahub.liteflow.agent.jev.JevInvocationException;
import com.yomahub.liteflow.core.FlowExecutor;
import com.yomahub.liteflow.flow.LiteflowResponse;
import com.yomahub.liteflow.property.LiteflowConfig;
import com.yomahub.liteflow.property.agent.JevConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/api/custom")
public class CustomDecisionController {
    private static final Logger log = LoggerFactory.getLogger(CustomDecisionController.class);

    private final FlowExecutor flowExecutor;
    private final LiteflowConfig liteflowConfig;

    public CustomDecisionController(FlowExecutor flowExecutor, LiteflowConfig liteflowConfig) {
        this.flowExecutor = flowExecutor;
        this.liteflowConfig = liteflowConfig;
    }

    @GetMapping("/config")
    public Config config() {
        JevConfig config = liteflowConfig.getAgent().getJev();
        return new Config(config.getModel(), config.getMinConfidence(), config.getTimeout().toMillis(),
                CustomDecisionContext.MIN_OPTIONS, CustomDecisionContext.MAX_OPTIONS);
    }

    @PostMapping("/evaluate")
    public Result evaluate(@RequestBody Request request) {
        String question = required(request.question(), "问题", 4000);
        if (request.options() == null || request.options().size() < CustomDecisionContext.MIN_OPTIONS
                || request.options().size() > CustomDecisionContext.MAX_OPTIONS) {
            throw badRequest("请提供 2～8 个选项");
        }
        List<CustomDecisionContext.Option> options = new ArrayList<>();
        Set<String> labels = new HashSet<>();
        for (String input : request.options()) {
            String label = required(input, "选项", 80);
            if (!labels.add(label.toLowerCase(Locale.ROOT))) throw badRequest("选项不能重复");
            // The request cannot choose component IDs or submit an EL expression.
            options.add(new CustomDecisionContext.Option("customOption" + (options.size() + 1), label));
        }
        CustomDecisionContext context = new CustomDecisionContext(question, options);
        long started = System.nanoTime();
        LiteflowResponse response = flowExecutor.execute2Resp("customDecision", null, context);
        long elapsed = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
        if (!response.isSuccess()) {
            Throwable cause = response.getCause();
            HttpStatus status = cause instanceof JevInvocationException ? HttpStatus.BAD_GATEWAY
                    : cause instanceof IllegalArgumentException ? HttpStatus.SERVICE_UNAVAILABLE
                    : HttpStatus.INTERNAL_SERVER_ERROR;
            throw new ResponseStatusException(status, "自由决策失败，请检查 Jev 配置或服务状态", cause);
        }
        return new Result(context.getHandledBy(), context.getReply(), context.getDecision(),
                response.getExecuteStepStr(), liteflowConfig.getAgent().getJev().getMinConfidence(),
                elapsed, context.getOptions());
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<ApiError> error(ResponseStatusException error) {
        if (error.getStatusCode().is5xxServerError()) {
            log.error("自由决策请求失败，POST /api/custom/evaluate，status={}", error.getStatusCode().value(), error);
        }
        return ResponseEntity.status(error.getStatusCode()).body(new ApiError(error.getReason()));
    }

    private static String required(String value, String name, int maxLength) {
        if (value == null || value.isBlank()) throw badRequest(name + "不能为空");
        String trimmed = value.strip();
        if (trimmed.length() > maxLength) throw badRequest(name + "不能超过 " + maxLength + " 个字符");
        return trimmed;
    }

    private static ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    public record Request(String question, List<String> options) { }
    public record Config(String model, double minConfidence, long timeoutMillis, int minOptions, int maxOptions) { }
    public record Result(String handledBy, String reply, JevChoiceResult decision, String executionSteps,
                         double minConfidence, long processingTimeMs, List<CustomDecisionContext.Option> options) { }
    public record ApiError(String message) { }
}

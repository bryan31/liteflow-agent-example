package com.yomahub.liteflow.examples.jev.bool;

import com.yomahub.liteflow.agent.jev.JevInvocationException;
import com.yomahub.liteflow.agent.jev.JevNoulResult;
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

import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/api/judge")
public class JudgeController {
    private static final Logger log = LoggerFactory.getLogger(JudgeController.class);

    private final FlowExecutor flowExecutor;
    private final LiteflowConfig liteflowConfig;

    public JudgeController(FlowExecutor flowExecutor, LiteflowConfig liteflowConfig) {
        this.flowExecutor = flowExecutor;
        this.liteflowConfig = liteflowConfig;
    }

    @GetMapping("/config")
    public Config config() {
        JevConfig config = liteflowConfig.getAgent().getJev();
        return new Config(config.getModel(), config.getNoulThreshold(), config.getTimeout().toMillis());
    }

    @PostMapping("/evaluate")
    public Result evaluate(@RequestBody Request request) {
        String question = required(request.question(), "判断标准", 500);
        String subject = required(request.subject(), "判断内容", 4000);
        JudgeContext context = new JudgeContext(question, subject);
        long started = System.nanoTime();
        LiteflowResponse response = flowExecutor.execute2Resp("judge", null, context);
        long elapsed = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
        if (!response.isSuccess()) {
            Throwable cause = response.getCause();
            HttpStatus status = cause instanceof JevInvocationException ? HttpStatus.BAD_GATEWAY
                    : cause instanceof IllegalArgumentException ? HttpStatus.SERVICE_UNAVAILABLE
                    : HttpStatus.INTERNAL_SERVER_ERROR;
            throw new ResponseStatusException(status, "是非判断失败，请检查 Jev 配置或服务状态", cause);
        }
        return new Result(context.getVerdict(), context.getReply(), context.getDecision(),
                response.getExecuteStepStr(), liteflowConfig.getAgent().getJev().getNoulThreshold(), elapsed);
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<ApiError> error(ResponseStatusException error) {
        if (error.getStatusCode().is5xxServerError()) {
            log.error("是非判断请求失败，POST /api/judge/evaluate，status={}", error.getStatusCode().value(), error);
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

    public record Request(String question, String subject) { }
    public record Config(String model, double noulThreshold, long timeoutMillis) { }
    public record Result(boolean verdict, String reply, JevNoulResult decision, String executionSteps,
                         double noulThreshold, long processingTimeMs) { }
    public record ApiError(String message) { }
}

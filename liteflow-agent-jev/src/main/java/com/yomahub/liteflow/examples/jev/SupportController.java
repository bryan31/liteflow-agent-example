package com.yomahub.liteflow.examples.jev;

import com.yomahub.liteflow.agent.jev.JevChoiceResult;
import com.yomahub.liteflow.agent.jev.JevInvocationException;
import com.yomahub.liteflow.examples.jev.cmp.SupportRouter;
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

import java.util.Map;
import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/api/support")
public class SupportController {
    private static final Logger log = LoggerFactory.getLogger(SupportController.class);

    private final FlowExecutor flowExecutor;
    private final LiteflowConfig liteflowConfig;
    private final SupportRouter supportRouter;

    public SupportController(FlowExecutor flowExecutor, LiteflowConfig liteflowConfig, SupportRouter supportRouter) {
        this.flowExecutor = flowExecutor;
        this.liteflowConfig = liteflowConfig;
        this.supportRouter = supportRouter;
    }

    @GetMapping("options")
    public DemoInfo options() {
        JevConfig config = liteflowConfig.getAgent().getJev();
        return new DemoInfo(config.getModel(), config.getMinConfidence(), config.getTimeout().toMillis(),
                supportRouter.choices());
    }

    @PostMapping("/route")
    public RouteResponse route(@RequestBody RouteRequest request) {
        if (request.message() == null || request.message().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "message 不能为空");
        }
        SupportContext context = new SupportContext(request.message());
        long started = System.nanoTime();
        LiteflowResponse response = flowExecutor.execute2Resp("support", null, context);
        long processingTimeMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
        if (!response.isSuccess()) {
            Throwable cause = response.getCause();
            HttpStatus status = cause instanceof JevInvocationException ? HttpStatus.BAD_GATEWAY
                    : cause instanceof IllegalArgumentException ? HttpStatus.SERVICE_UNAVAILABLE
                    : HttpStatus.INTERNAL_SERVER_ERROR;
            throw new ResponseStatusException(status, "售后分流失败，请检查 Jev 配置或服务状态", cause);
        }
        return new RouteResponse(context.getHandledBy(), context.getReply(),
                context.getDecision(), response.getExecuteStepStr(), liteflowConfig.getAgent().getJev().getMinConfidence(),
                processingTimeMs);
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<ApiError> error(ResponseStatusException error) {
        if (error.getStatusCode().is5xxServerError()) {
            log.error("售后分流请求失败，POST /api/support/route，status={}", error.getStatusCode().value(), error);
        }
        return ResponseEntity.status(error.getStatusCode()).body(new ApiError(error.getReason()));
    }

    public record RouteRequest(String message) { }
    public record RouteResponse(String handledBy, String reply, JevChoiceResult decision, String executionSteps,
                                double minConfidence, long processingTimeMs) { }
    public record DemoInfo(String model, double minConfidence, long timeoutMillis,
                           Map<String, String> options) { }
    public record ApiError(String message) { }
}

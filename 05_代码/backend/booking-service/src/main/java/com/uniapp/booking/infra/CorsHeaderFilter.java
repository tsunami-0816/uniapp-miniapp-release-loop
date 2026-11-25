package com.uniapp.booking.infra;

import com.uniapp.booking.config.BookingProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * CORS 头兜底 Filter（第 9 步走查缺陷 F-02 / 2026-11-25）。
 *
 * <p>背景：{@link CorsConfig} 是 MVC 层 CORS（WebMvcConfigurer），只在请求进入 DispatcherServlet
 * 并命中 handler 时才生效。{@link SignatureFilter}（@Order(1)）与 {@link JwtAuthFilter}（@Order(2)）
 * 在 MVC 之前就直接写 401 响应，这些响应不带 Access-Control-Allow-Origin，
 * 浏览器会把跨域 401 判成网络错误，H5 端只能显示「网络不稳定，请重试」，
 * 且无法读取 40101/40103 业务码去清登录态（走查中「我的」「确认这一档」两个现象同源）。
 *
 * <p>本 Filter 置于过滤器链最前（HIGHEST_PRECEDENCE），对所有进入本服务的跨域请求
 * 先按白名单写好 CORS 头，后续任何过滤器或 handler 提前返回时响应都自带 CORS 头；
 * 同时在本层直接应答 OPTIONS 预检，避免预检被鉴权过滤器拦掉。
 * 白名单与 {@link CorsConfig} 共用 booking.cors.allowed-origins，不额外放开任何来源。
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class CorsHeaderFilter extends OncePerRequestFilter {

    private static final String ALLOW_METHODS = "GET, POST, OPTIONS";
    private static final String ALLOW_HEADERS =
            "Authorization, Content-Type, X-Sign, X-Timestamp, X-Nonce, X-Client, X-Idempotency-Key";
    private static final String MAX_AGE = "3600";

    private final String[] allowedOrigins;

    public CorsHeaderFilter(BookingProperties props) {
        this.allowedOrigins = props.getCors().getAllowedOrigins().split(",");
    }

    /** 命中白名单返回请求 Origin（按 Origin 回显，不使用通配符），未命中返回 null。 */
    private String matchOrigin(String origin) {
        if (origin == null || origin.isEmpty()) {
            return null;
        }
        for (String candidate : allowedOrigins) {
            String trimmed = candidate.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            if ("*".equals(trimmed) || trimmed.equals(origin)) {
                return origin;
            }
        }
        return null;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String origin = request.getHeader("Origin");
        String allowed = matchOrigin(origin);

        if (allowed != null) {
            response.setHeader("Access-Control-Allow-Origin", allowed);
            response.setHeader("Vary", "Origin");
            response.setHeader("Access-Control-Allow-Methods", ALLOW_METHODS);
            response.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);
            response.setHeader("Access-Control-Max-Age", MAX_AGE);
        }

        // 跨域预检在本层应答：命中白名单 204，未命中 403；非跨域 OPTIONS 继续走原链路
        if ("OPTIONS".equalsIgnoreCase(request.getMethod()) && origin != null) {
            response.setStatus(allowed != null ? HttpServletResponse.SC_NO_CONTENT : HttpServletResponse.SC_FORBIDDEN);
            return;
        }

        chain.doFilter(request, response);
    }
}

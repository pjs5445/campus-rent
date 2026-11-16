package kr.ac.campusrent.api;

import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import javax.servlet.http.*;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.*;
import org.springframework.web.servlet.config.annotation.*;

@Configuration
public class ApiConfig implements WebMvcConfigurer {
    public static String token(HttpSession session) {
        synchronized(session) {
            if(session.getAttribute("csrf")==null) session.setAttribute("csrf",UUID.randomUUID().toString());
            return (String)session.getAttribute("csrf");
        }
    }
    @Override public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new HandlerInterceptor() {
            @Override public boolean preHandle(HttpServletRequest request,HttpServletResponse response,Object handler) {
                response.setHeader("Cache-Control","no-store");
                response.setHeader("X-Content-Type-Options","nosniff");
                if(!"GET".equals(request.getMethod()) && !"HEAD".equals(request.getMethod())) {
                    HttpSession session=request.getSession(false);
                    String supplied=request.getHeader("X-CSRF-Token");
                    if(session==null || supplied==null || session.getAttribute("csrf")==null || !MessageDigest.isEqual(supplied.getBytes(StandardCharsets.UTF_8), token(session).getBytes(StandardCharsets.UTF_8)))
                        throw new ApiException(403,"세션이 만료되었거나 요청을 확인할 수 없습니다. 새로고침 후 다시 시도해주세요.");
                }
                return true;
            }
        }).addPathPatterns("/api/**");
    }
}

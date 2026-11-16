package kr.ac.campusrent.api;

import static kr.ac.campusrent.api.Json.map;
import java.util.Map;
import javax.servlet.http.HttpServletRequest;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;
import kr.ac.campusrent.auth.AuthService;

@RestController
@RequestMapping("/api")
public class AuthController {
    private final AuthService auth;
    public AuthController(AuthService auth) { this.auth=auth; }
    @GetMapping("/session") public Map<String,Object> session(HttpServletRequest request) {
        return map("user",auth.current(request),"csrfToken",ApiConfig.token(request.getSession()));
    }
    @PostMapping("/auth/signup") public Map<String,Object> signup(@RequestBody JsonNode input,HttpServletRequest request) { return auth.authenticate(input,true,request); }
    @PostMapping("/auth/login") public Map<String,Object> login(@RequestBody JsonNode input,HttpServletRequest request) { return auth.authenticate(input,false,request); }
    @PostMapping("/auth/logout") public Map<String,Object> logout(HttpServletRequest request) { request.getSession().invalidate(); return map("status","saved"); }
}

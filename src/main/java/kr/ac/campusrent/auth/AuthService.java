package kr.ac.campusrent.auth;

import kr.ac.campusrent.api.*;
import static kr.ac.campusrent.api.Json.*;
import java.util.*;
import javax.servlet.http.*;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {
    private final JdbcTemplate db;
    private final String dummyHash = Passwords.hash(UUID.randomUUID().toString());
    public AuthService(JdbcTemplate db) { this.db=db; }
    public Map<String,Object> current(HttpServletRequest request) {
        HttpSession session=request.getSession(false);
        if(session==null || session.getAttribute("userId")==null) return null;
        List<Map<String,Object>> rows=db.queryForList("SELECT USER_ID, EMAIL, USER_NAME, ROLE_CODE FROM APP_USER WHERE USER_ID=?",session.getAttribute("userId"));
        return rows.isEmpty()?null:publicUser(rows.get(0));
    }
    public Map<String,Object> required(HttpServletRequest request) {
        Map<String,Object> user=current(request);
        if(user==null) throw new ApiException(401,"로그인이 필요합니다.");
        return user;
    }
    @Transactional
    public Map<String,Object> authenticate(JsonNode input, boolean signup, HttpServletRequest request) {
        String email=text(input,"email",254).toLowerCase(Locale.ROOT);
        String password=input.path("password").asText("");
        ApiException.require(email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+") && !password.isEmpty() && password.length()<=128,"이메일 또는 비밀번호 입력을 확인해주세요.");
        List<Map<String,Object>> rows=db.queryForList("SELECT * FROM APP_USER WHERE EMAIL=?",email);
        Map<String,Object> row;
        if(signup) {
            String name=text(input,"name",50);
            ApiException.require(!name.isEmpty() && password.length()>=8 && password.matches("(?s).*[a-zA-Z].*") && password.matches("(?s).*\\d.*"),"이름과 비밀번호 규칙(8자 이상 영문·숫자)을 확인해주세요.");
            if(!rows.isEmpty()) throw new ApiException(409,"이미 등록된 이메일입니다.");
            long id=db.queryForObject("SELECT SEQ_APP_USER.NEXTVAL FROM DUAL",Long.class);
            db.update("INSERT INTO APP_USER(USER_ID,EMAIL,PASSWORD,USER_NAME,ROLE_CODE,CREATED_AT) VALUES(?,?,?,?, 'student', SYSTIMESTAMP)",id,email,Passwords.hash(password),name);
            row=map("USER_ID",id,"EMAIL",email,"USER_NAME",name,"ROLE_CODE","student");
        } else {
            String stored=rows.isEmpty()?dummyHash:(String)rows.get(0).get("PASSWORD");
            if(!Passwords.matches(password,stored) || rows.isEmpty()) throw new ApiException(401,"이메일 또는 비밀번호를 확인해주세요.");
            row=rows.get(0);
        }
        HttpSession session=request.getSession();
        request.changeSessionId();
        session.setAttribute("userId",id(row.get("USER_ID")));
        return publicUser(row);
    }
    private Map<String,Object> publicUser(Map<String,Object> row) {
        return map("id",String.valueOf(row.get("USER_ID")),"email",row.get("EMAIL"),"name",row.get("USER_NAME"),"role",row.get("ROLE_CODE"));
    }
}

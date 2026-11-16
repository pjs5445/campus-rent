package kr.ac.campusrent;

import static kr.ac.campusrent.api.Json.map;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;

/** Real HTTP cookies and committed writes, followed by login through a fresh session. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties="debug=false")
class OracleHttpIT {
    @Autowired TestRestTemplate http; @Autowired JdbcTemplate db;
    class Client {
        String cookie="",csrf="";
        JsonNode request(String path,Object body) {
            HttpHeaders headers=new HttpHeaders();headers.setContentType(MediaType.APPLICATION_JSON);
            if(!cookie.isEmpty())headers.set("Cookie",cookie);
            if(body!=null)headers.set("X-CSRF-Token",csrf);
            ResponseEntity<JsonNode> response=http.exchange(path,body==null?HttpMethod.GET:HttpMethod.POST,new HttpEntity<>(body,headers),JsonNode.class);
            assertEquals(HttpStatus.OK,response.getStatusCode(),String.valueOf(response.getBody()));
            for(String value:response.getHeaders().getOrDefault("Set-Cookie",Collections.emptyList()))if(value.startsWith("JSESSIONID="))cookie=value.split(";")[0];
            JsonNode result=response.getBody();if(result.has("csrfToken"))csrf=result.path("csrfToken").asText();return result;
        }
    }
    @Test void savedRequestSurvivesLogoutAndNewHttpSession() {
        String email="http-it-"+UUID.randomUUID()+"@example.invalid",password="HttpPersistence93!";
        Long user=null;
        try {
            Client first=new Client();first.request("/api/session",null);String anonymousCookie=first.cookie;
            JsonNode created=first.request("/api/auth/signup",map("email",email,"password",password,"name","HTTP 검증"));
            user=Long.valueOf(created.path("id").asText());assertNotEquals(anonymousCookie,first.cookie);
            JsonNode state=first.request("/api/requests",map("type","create","record",map("items",Arrays.asList(map("id","E1","condition",map("start","2099-12-01T14:00","end","2099-12-01T16:00","people",1,"use",""))))));
            String number=state.path("records").get(0).path("number").asText();
            assertEquals(1,db.queryForObject("SELECT COUNT(*) FROM RENT_REQUEST WHERE APPLICANT_ID=? AND REQUEST_NO=?",Integer.class,user,number));
            first.request("/api/auth/logout",map());
            Client second=new Client();assertTrue(second.request("/api/session",null).path("user").isNull());
            second.request("/api/auth/login",map("email",email,"password",password));
            assertEquals(number,second.request("/api/requests",null).path("records").get(0).path("number").asText());
            assertEquals(12,second.request("/api/resources",null).size());
        } finally {
            if(user!=null) {
                db.update("DELETE FROM REQUEST_STATUS_LOG WHERE REQUEST_ITEM_ID IN (SELECT I.REQUEST_ITEM_ID FROM REQUEST_ITEM I JOIN RENT_REQUEST R ON R.REQUEST_ID=I.REQUEST_ID WHERE R.APPLICANT_ID=?)",user);
                db.update("DELETE FROM REQUEST_ITEM WHERE REQUEST_ID IN (SELECT REQUEST_ID FROM RENT_REQUEST WHERE APPLICANT_ID=?)",user);
                db.update("DELETE FROM RENT_REQUEST WHERE APPLICANT_ID=?",user);
                db.update("DELETE FROM APP_USER WHERE USER_ID=? AND EMAIL=?",user,email);
            }
        }
    }
}

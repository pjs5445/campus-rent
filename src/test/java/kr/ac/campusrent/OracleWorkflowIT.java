package kr.ac.campusrent;

import static kr.ac.campusrent.api.Json.map;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import java.util.*;
import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.*;
import org.springframework.transaction.annotation.Transactional;
import kr.ac.campusrent.auth.Passwords;

/** Real Oracle workflow tests. All fixture DML is rolled back; sequence gaps are expected. */
@SpringBootTest(properties="debug=false")
@AutoConfigureMockMvc
@Transactional
class OracleWorkflowIT {
    @Autowired MockMvc mvc; @Autowired ObjectMapper json; @Autowired JdbcTemplate db;
    private final String password="WorkflowTest927!";
    class Client {
        MockHttpSession session=new MockHttpSession(); String csrf;
        Client() throws Exception {csrf=getJson("/api/session",this).path("csrfToken").asText();}
    }
    private JsonNode getJson(String path,Client c) throws Exception {
        MvcResult result=mvc.perform(get(path).session(c.session)).andReturn();
        assertEquals(200,result.getResponse().getStatus(),result.getResponse().getContentAsString());
        return json.readTree(result.getResponse().getContentAsString());
    }
    private JsonNode postJson(String path,Object body,Client c,int status) throws Exception {
        MvcResult result=mvc.perform(post(path).session(c.session).header("X-CSRF-Token",c.csrf).contentType("application/json").content(json.writeValueAsBytes(body))).andReturn();
        assertEquals(status,result.getResponse().getStatus(),result.getResponse().getContentAsString());
        return json.readTree(result.getResponse().getContentAsString());
    }
    private Client student() throws Exception {
        Client c=new Client();postJson("/api/auth/signup",map("name","통합검증","email","it-"+UUID.randomUUID()+"@example.invalid","password",password,"role","admin"),c,200);return c;
    }
    private Client administrator() throws Exception {
        Client c=new Client();c.session.setAttribute("userId",db.queryForObject("SELECT MIN(USER_ID) FROM APP_USER WHERE ROLE_CODE='admin'",Long.class));return c;
    }
    private JsonNode create(Client c,String key,String date,int status) throws Exception {
        return postJson("/api/requests",map("type","create","actor",map("id","fake","role","admin"),"record",map("userId","fake","number","client-number","items",Arrays.asList(map("id",key,"name","forged","condition",map("start",date+"T14:00","end",date+"T16:00","people",2,"use","팀 회의"))))),c,status);
    }
    private Map<String,Object> action(JsonNode record,String type,String to,int equipmentVersion) {
        JsonNode item=record.path("items").get(0);
        return map("type",type,"number",record.path("number").asText(),"itemId",item.path("id").asText(),"expectedVersion",item.path("version").asInt(),"expectedEquipmentVersion",equipmentVersion,"from",item.path("stage").asText(),"to",to,"memo","통합검증 확인","confirmed",true);
    }
    private JsonNode record(JsonNode state,String number) {
        for(JsonNode r:state.path("records"))if(r.path("number").asText().equals(number))return r;
        throw new AssertionError("Record missing");
    }
    @Test void membershipSessionOwnershipAndForgery() throws Exception {
        Client c=student(),other=student(),guest=new Client();
        JsonNode user=getJson("/api/session",c).path("user");assertEquals("student",user.path("role").asText());
        postJson("/api/selection",map("selected",map("E1",map("start","2099-10-01T14:00","end","2099-10-01T16:00","people",1,"use",""))),c,200);
        assertTrue(getJson("/api/selection",c).path("selected").has("E1"));
        assertEquals(0,getJson("/api/selection",other).path("selected").size());
        String hash=db.queryForObject("SELECT PASSWORD FROM APP_USER WHERE USER_ID=?",String.class,Long.parseLong(user.path("id").asText()));
        assertNotEquals(password,hash);assertTrue(Passwords.matches(password,hash));assertFalse(Passwords.matches("incorrect",hash));
        JsonNode receipt=create(c,"E1","2099-10-01",200);
        JsonNode created=receipt.path("records").get(0);
        assertEquals(created.path("number").asText(),receipt.path("createdNumber").asText());
        assertNotEquals("client-number",receipt.path("createdNumber").asText());
        assertTrue(created.path("number").asText().startsWith("CR-"));assertNotEquals("forged",created.path("items").get(0).path("name").asText());
        assertEquals(user.path("id").asText(),created.path("userId").asText());
        assertEquals(0,getJson("/api/requests",other).path("records").size());
        assertEquals(0,getJson("/api/requests",guest).path("records").size());
        postJson("/api/requests",action(created,"transition","cancelled",0),other,403);
        postJson("/api/requests",action(created,"transition","approved",0),c,403);
        postJson("/api/requests",action(created,"transition","cancelled",0),guest,401);
        assertEquals(403,mvc.perform(post("/api/requests").session(c.session).contentType("application/json").content("{}")).andReturn().getResponse().getStatus());
        postJson("/api/requests",action(created,"transition","cancelled",0),c,200);
        postJson("/api/auth/logout",map(),c,200);
        c=new Client();assertTrue(getJson("/api/session",c).path("user").isNull());
        JsonNode logged=postJson("/api/auth/login",map("email",user.path("email").asText(),"password",password),c,200);
        assertEquals(user.path("id").asText(),logged.path("id").asText());
        assertTrue(getJson("/api/selection",c).path("selected").has("E1"));
        assertEquals("cancelled",getJson("/api/requests",c).path("records").get(0).path("items").get(0).path("stage").asText());
    }
    @Test void equipmentCheckoutPartialReturnAndMaintenancePersist() throws Exception {
        Client student=student(),admin=administrator();
        JsonNode r=create(student,"E1","2099-10-02",200).path("records").get(0);String number=r.path("number").asText();
        Map<String,Object> approve=action(r,"transition","approved",0);
        r=record(postJson("/api/requests",approve,admin,200),number);
        postJson("/api/requests",approve,admin,409);
        Map<String,Object> checkout=action(r,"checkout",null,0);List<Map<String,Object>> rows=new ArrayList<>();
        for(JsonNode component:r.path("items").get(0).path("components"))rows.add(map("componentId",component.path("componentId").asText(),"quantity",component.path("requiredQuantity").asInt(),"condition","normal","confirmed",true,"note",""));
        checkout.put("rows",rows);r=record(postJson("/api/requests",checkout,admin,200),number);
        assertTrue(r.path("items").get(0).has("checkoutSnapshot"));
        r=record(postJson("/api/requests",action(r,"transition","return_requested",0),student,200),number);
        Map<String,Object> inspect=action(r,"inspect_return",null,0);rows=new ArrayList<>();boolean first=true;
        for(JsonNode component:r.path("items").get(0).path("checkoutSnapshot").path("components")) { rows.add(map("componentId",component.path("componentId").asText(),"quantity",first?0:component.path("deliveredQuantity").asInt(),"condition","normal","confirmed",true,"note",""));first=false; }
        inspect.put("rows",rows);r=record(postJson("/api/requests",inspect,admin,200),number);
        assertEquals("return_held",r.path("items").get(0).path("stage").asText());
        postJson("/api/requests",action(r,"maintenance_complete",null,1),admin,400);
        inspect=action(r,"inspect_return",null,1);rows=new ArrayList<>();first=true;
        for(JsonNode component:r.path("items").get(0).path("checkoutSnapshot").path("components")){ rows.add(map("componentId",component.path("componentId").asText(),"quantity",first?component.path("deliveredQuantity").asInt():0,"condition","normal","confirmed",true,"note",""));first=false; }
        inspect.put("rows",rows);r=record(postJson("/api/requests",inspect,admin,200),number);
        assertEquals("returned",r.path("items").get(0).path("stage").asText());assertEquals(2,r.path("items").get(0).path("returnInspections").size());
        JsonNode state=postJson("/api/requests",action(r,"maintenance_complete",null,1),admin,200);
        assertEquals("normal",state.path("equipmentStates").path("E1").path("status").asText());
        assertEquals("returned",record(getJson("/api/requests",student),number).path("items").get(0).path("stage").asText());
        assertTrue(db.queryForObject("SELECT COUNT(*) FROM RETURN_COMPONENT",Integer.class)>0);
    }
    @Test void facilityOverlapRejectionUsageAndInvalidTimes() throws Exception {
        Client student=student(),other=student(),admin=administrator();
        JsonNode a=create(student,"F1","2099-10-03",200).path("records").get(0),b=create(other,"F1","2099-10-03",200).path("records").get(0);
        String number=a.path("number").asText();a=record(postJson("/api/requests",action(a,"transition","approved",0),admin,200),number);
        postJson("/api/requests",action(b,"transition","approved",0),admin,409);
        Map<String,Object> reject=action(b,"transition","rejected",0);postJson("/api/requests",reject,admin,400);reject.put("reason","일정 중복");postJson("/api/requests",reject,admin,200);
        a=record(postJson("/api/requests",action(a,"transition","collected",0),admin,200),number);
        a=record(postJson("/api/requests",action(a,"transition","returned",0),admin,200),number);
        assertNotNull(a.path("items").get(0).get("endedAt"));
        assertEquals(1,db.queryForObject("SELECT COUNT(*) FROM FACILITY_USAGE WHERE REQUEST_ITEM_ID IN (SELECT REQUEST_ITEM_ID FROM REQUEST_ITEM WHERE REQUEST_ID=(SELECT REQUEST_ID FROM RENT_REQUEST WHERE REQUEST_NO=?)) AND ENDED_AT IS NOT NULL",Integer.class,number));
        create(student,"F1","2000-01-01",400);
    }
}

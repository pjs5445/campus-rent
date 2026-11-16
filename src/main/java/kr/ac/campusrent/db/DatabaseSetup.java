package kr.ac.campusrent.db;

import java.nio.charset.StandardCharsets;
import java.util.*;
import com.fasterxml.jackson.databind.*;
import kr.ac.campusrent.auth.Passwords;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StreamUtils;

/** Explicit, one-time initialization of an empty schema. Never drops existing objects. */
@Component
@Profile("db-setup")
public class DatabaseSetup implements CommandLineRunner {
    private final JdbcTemplate db; private final Environment env; private final TransactionTemplate tx;
    private final ObjectMapper mapper;
    public DatabaseSetup(JdbcTemplate db,Environment env,TransactionTemplate tx,ObjectMapper mapper) { this.db=db;this.env=env;this.tx=tx;this.mapper=mapper; }
    @Override public void run(String... args) throws Exception {
        String email=env.getRequiredProperty("CAMPUS_ADMIN_EMAIL");
        String password=env.getRequiredProperty("CAMPUS_ADMIN_PASSWORD");
        if(password.length()<16) throw new IllegalStateException("Configure a strong local admin password before setup");
        String sql=StreamUtils.copyToString(new ClassPathResource("db/schema-oracle.sql").getInputStream(),StandardCharsets.UTF_8);
        sql=sql.replaceAll("(?m)^--.*$","");
        List<String> statements=new ArrayList<>();
        for(String statement:sql.split(";")) if(!statement.trim().isEmpty()) statements.add(statement.trim());
        Integer existing=db.queryForObject("SELECT COUNT(*) FROM USER_OBJECTS WHERE OBJECT_TYPE IN ('TABLE','SEQUENCE')",Integer.class);
        if(existing!=0) {
            if(!env.getProperty("campus.setup.resume",Boolean.class,false)) throw new IllegalStateException("Setup requires an empty schema. Existing objects have been preserved.");
            // Resume only this DDL's empty, partially initialized schema after an interrupted setup.
            for(String table:db.queryForList("SELECT TABLE_NAME FROM USER_TABLES",String.class)) {
                String definition=statements.stream().filter(s->s.startsWith("CREATE TABLE "+table+" (")).findFirst().orElseThrow(()->new IllegalStateException("Unknown table; setup refused"));
                if(db.queryForObject("SELECT COUNT(*) FROM "+table,Integer.class)!=0) throw new IllegalStateException("Existing data; setup refused");
                Set<String> expected=new HashSet<>();
                for(String line:definition.split("\\n")) if(line.trim().matches("[A-Z_]+ (NUMBER|VARCHAR2|CHAR|TIMESTAMP).*")) expected.add(line.trim().split(" ")[0]);
                if(!expected.equals(new HashSet<>(db.queryForList("SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME=?",String.class,table)))) throw new IllegalStateException("Column mismatch; setup refused");
            }
        }
        for(String statement:statements) {
            for(int attempt=0;;attempt++) {
                try { if(!exists(statement)) db.execute(statement); break; }
                catch(org.springframework.dao.DataAccessResourceFailureException e) { if(attempt>=2)throw e; }
            }
        }
        JsonNode seed=mapper.readTree(new ClassPathResource("db/catalog-seed.json").getInputStream());
        tx.execute(status->{ seed(seed,email,password); return null; });
        System.out.println("Schema ready: 26 tables, 17 sequences; administrator and 12 demo resources saved. Credentials are not logged.");
    }
    private boolean exists(String sql) {
        String[] words=sql.split("\\s+");
        if(words[0].equals("ALTER")) return db.queryForObject("SELECT COUNT(*) FROM USER_CONSTRAINTS WHERE CONSTRAINT_NAME=? AND TABLE_NAME=?",Integer.class,words[5],words[2])>0;
        return db.queryForObject("SELECT COUNT(*) FROM USER_OBJECTS WHERE OBJECT_NAME=? AND OBJECT_TYPE=?",Integer.class,words[2],words[1])>0;
    }
    private long next(String table) { return db.queryForObject("SELECT SEQ_"+table+".NEXTVAL FROM DUAL",Long.class); }
    private void seed(JsonNode seed,String email,String password) {
        long admin=next("APP_USER");
        db.update("INSERT INTO APP_USER VALUES(?,?,?,?,?,SYSTIMESTAMP)",admin,email,Passwords.hash(password),"관리자","admin");
        Map<String,Long> purposes=new HashMap<>(),types=new HashMap<>(),equipment=new HashMap<>();
        for(JsonNode p:seed.path("purposes")) { long id=next("USE_PURPOSE"); purposes.put(p.asText(),id); db.update("INSERT INTO USE_PURPOSE VALUES(?,?,?,?,?)",id,"PURPOSE_"+id,p.asText(),null,"Y"); }
        for(JsonNode r:seed.path("resources")) {
            if(r.path("kind").asText().equals("장비")) {
                String category=r.path("category").asText();
                if(!types.containsKey(category)) { long id=next("EQUIPMENT_TYPE");types.put(category,id); db.update("INSERT INTO EQUIPMENT_TYPE VALUES(?,?,?,?)",id,category,category,"Y"); }
                long model=next("EQUIPMENT_MODEL"),id=next("EQUIPMENT"); equipment.put(r.path("id").asText(),id);
                db.update("INSERT INTO EQUIPMENT_MODEL VALUES(?,?,?,?,?,?)",model,types.get(category),r.path("model").asText(),r.path("model").asText(),null,"Y");
                int order=0;
                for(JsonNode spec:r.path("specs")) { long sid=next("SPEC_ITEM");db.update("INSERT INTO SPEC_ITEM VALUES(?,?,?,?,?)",sid,types.get(category),"사양 "+(++order),null,order); db.update("INSERT INTO MODEL_SPEC VALUES(?,?,?,?,?)",model,sid,spec.asText(),null,"confirmed"); }
                db.update("INSERT INTO EQUIPMENT VALUES(?,?,?,?,?,?,?,?,?,?,SYSTIMESTAMP)",id,model,r.path("code").asText(),r.path("name").asText(),r.path("location").asText(),null,"Y",r.path("status").asText().equals("정상")?"normal":"inspection","Y",0);
                order=0;
                for(JsonNode c:r.path("components")) db.update("INSERT INTO EQUIPMENT_COMPONENT VALUES(?,?,?,?,?,?,?)",next("EQUIPMENT_COMPONENT"),id,c.path("name").asText(),c.path("requiredQuantity").asInt(),c.path("body").asBoolean()?"Y":"N",c.path("required").asBoolean()?"Y":"N",++order);
            } else {
                long id=next("FACILITY"); List<String> contents=new ArrayList<>();r.path("contents").forEach(c->contents.add(c.asText()));
                db.update("INSERT INTO FACILITY VALUES(?,?,?,?,?,?,?,?,?,?,?)",id,r.path("code").asText(),r.path("name").asText(),r.path("category").asText(),r.path("location").asText(),r.path("capacity").asInt(),String.join(" · ",contents),"Y","normal","Y",0);
                for(int day=1;day<=7;day++) db.update("INSERT INTO FACILITY_HOURS VALUES(?,?,?,?)",id,day,"09:00","20:00");
                for(JsonNode use:r.path("allowedUses")) db.update("INSERT INTO FACILITY_PURPOSE VALUES(?,?)",id,purposes.get(use.asText()));
            }
        }
        for(JsonNode r:seed.path("resources")) for(JsonNode alt:r.path("alternatives")) db.update("INSERT INTO EQUIPMENT_ALTERNATIVE VALUES(?,?,?,?,?,?,SYSTIMESTAMP)",equipment.get(r.path("id").asText()),equipment.get(alt.asText()),"동일 품목 대체 후보","사양과 구성품 차이를 확인하세요.","Y",admin);
        for(Map.Entry<String,Long> p:purposes.entrySet()) {
            db.update("INSERT INTO PURPOSE_KEYWORD VALUES(?,?,?,?,?,?,?)",next("PURPOSE_KEYWORD"),p.getValue(),p.getKey(),"contains","include",1,"Y");
            for(Map.Entry<String,Long> t:types.entrySet()) {
                boolean video=p.getKey().contains("촬영"),projector=p.getKey().equals("발표 연습")&&t.getKey().equals("프로젝터");
                if((video&&!t.getKey().equals("프로젝터"))||projector) db.update("INSERT INTO PURPOSE_EQUIPMENT_RULE VALUES(?,?,?,?,?)",p.getValue(),t.getValue(),projector?"optional":"required",p.getKey()+"에 사용하는 "+t.getKey(),1);
            }
        }
    }
}

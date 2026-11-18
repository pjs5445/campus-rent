package kr.ac.campusrent.rental;

import static kr.ac.campusrent.api.Json.*;
import static kr.ac.campusrent.api.ApiException.require;
import static kr.ac.campusrent.rental.CatalogService.local;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import java.util.stream.Collectors;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import kr.ac.campusrent.api.ApiException;

@Service
public class RentalService {
    private final JdbcTemplate db; private final CatalogService catalog;
    public RentalService(JdbcTemplate db,CatalogService catalog) { this.db=db;this.catalog=catalog; }
    private long next(String table) { return db.queryForObject("SELECT SEQ_"+table+".NEXTVAL FROM DUAL",Long.class); }
    private Timestamp now() { return Timestamp.valueOf(LocalDateTime.now(ZoneId.of("Asia/Seoul"))); }
    private long userId(Map<String,Object> user) { return Long.parseLong((String)user.get("id")); }
    private boolean admin(Map<String,Object> user) { return "admin".equals(user.get("role")); }
    private String resourceKey(Map<String,Object> row) { return row.get("ITEM_KIND").toString()+(row.get("EQUIPMENT_ID")==null?row.get("FACILITY_ID"):row.get("EQUIPMENT_ID")); }
    private void lockResource(String key) {
        long id=CatalogService.number(key);
        List<Map<String,Object>> rows=db.queryForList(key.startsWith("E")?"SELECT EQUIPMENT_ID FROM EQUIPMENT WHERE EQUIPMENT_ID=? FOR UPDATE WAIT 10":"SELECT FACILITY_ID FROM FACILITY WHERE FACILITY_ID=? FOR UPDATE WAIT 10",id);
        if(rows.isEmpty()) throw new ApiException(404,"자원을 찾을 수 없습니다.");
    }
    private Map<String,Object> condition(Map<String,Object> row) {
        String purpose="";
        if(row.get("PURPOSE_ID")!=null) purpose=db.queryForObject("SELECT PURPOSE_NAME FROM USE_PURPOSE WHERE PURPOSE_ID=?",String.class,row.get("PURPOSE_ID"));
        return map("start",local(row.get("USE_START_AT")),"end",local(row.get("USE_END_AT")),"people",row.get("PEOPLE_COUNT")==null?1:row.get("PEOPLE_COUNT"),"use",purpose);
    }
    private Map<String,Object> parseCondition(JsonNode input) {
        try {
            LocalDateTime start=LocalDateTime.parse(text(input,"start",30)),end=LocalDateTime.parse(text(input,"end",30));
            require(end.isAfter(start),"종료 시간은 시작 시간 이후여야 합니다.");
            return map("USE_START_AT",Timestamp.valueOf(start),"USE_END_AT",Timestamp.valueOf(end),"PEOPLE_COUNT",integer(input,"people",1,999),"PURPOSE_ID",purpose(text(input,"use",50)));
        } catch(java.time.format.DateTimeParseException e) { throw new ApiException(400,"이용 날짜와 시간을 확인해주세요."); }
    }
    private Long purpose(String name) {
        if(name.isEmpty()) return null;
        List<Long> values=db.queryForList("SELECT PURPOSE_ID FROM USE_PURPOSE WHERE PURPOSE_NAME=? AND ENABLED_YN='Y'",Long.class,name);
        require(values.size()==1,"등록된 이용 목적을 선택해주세요.");return values.get(0);
    }
    private void available(String key,Map<String,Object> c,Long exclude) {
        Map<String,Object> r=catalog.find(key);
        require(Boolean.TRUE.equals(r.get("rentable")) && "정상".equals(r.get("status")),"현재 운영 상태로는 이용할 수 없습니다.");
        Timestamp start=(Timestamp)c.get("USE_START_AT"),end=(Timestamp)c.get("USE_END_AT");
        require(start.after(now()),"시작 시간은 현재보다 이후여야 합니다.");
        long resource=CatalogService.number(key);
        String field=key.startsWith("E")?"EQUIPMENT_ID":"FACILITY_ID";
        Integer overlaps=db.queryForObject("SELECT COUNT(*) FROM REQUEST_ITEM WHERE "+field+"=? AND STATUS_CODE IN ('approved','collected','return_requested','return_held','returned') AND USE_START_AT<? AND USE_END_AT>? AND REQUEST_ITEM_ID<>?",Integer.class,resource,end,start,exclude==null?-1:exclude);
        if(overlaps>0) throw new ApiException(409,"이미 승인된 신청과 이용 기간이 겹칩니다.");
        if(key.startsWith("F")) {
            require(id(c.get("PEOPLE_COUNT"))<=id(r.get("capacity")),"시설 수용 인원을 초과했습니다.");
            require(c.get("PURPOSE_ID")!=null && db.queryForObject("SELECT COUNT(*) FROM FACILITY_PURPOSE WHERE FACILITY_ID=? AND PURPOSE_ID=?",Integer.class,resource,c.get("PURPOSE_ID"))==1,"시설의 허용 목적을 선택해주세요.");
            LocalDateTime s=start.toLocalDateTime(),e=end.toLocalDateTime();
            List<Map<String,Object>> hours=db.queryForList("SELECT OPEN_TIME,CLOSE_TIME FROM FACILITY_HOURS WHERE FACILITY_ID=? AND WEEKDAY_NO=?",resource,s.getDayOfWeek().getValue());
            require(!hours.isEmpty() && s.toLocalDate().equals(e.toLocalDate()),"시설 운영일과 당일 이용 시간을 확인해주세요.");
            require(!s.toLocalTime().isBefore(LocalTime.parse((String)hours.get(0).get("OPEN_TIME"))) && !e.toLocalTime().isAfter(LocalTime.parse((String)hours.get(0).get("CLOSE_TIME"))),"시설 운영 시간 내에서 신청해주세요.");
            require(db.queryForObject("SELECT COUNT(*) FROM FACILITY_BLOCK WHERE FACILITY_ID=? AND BLOCK_START_AT<? AND BLOCK_END_AT>?",Integer.class,resource,end,start)==0,"시설 이용 제한 시간입니다.");
        } else require(db.queryForObject("SELECT COUNT(*) FROM REQUEST_ITEM WHERE EQUIPMENT_ID=? AND STATUS_CODE='return_held'",Integer.class,resource)==0,"미반환 구성품 확인이 필요합니다.");
    }
    public Map<String,Object> state(Map<String,Object> user) {
        List<Map<String,Object>> records=new ArrayList<>();
        Map<String,Map<String,Object>> resources=catalog.resources().stream().collect(Collectors.toMap(r->(String)r.get("id"),r->r));
        if(user!=null) {
            List<Map<String,Object>> requests=admin(user)?db.queryForList("SELECT * FROM RENT_REQUEST ORDER BY REQUEST_ID DESC"):db.queryForList("SELECT * FROM RENT_REQUEST WHERE APPLICANT_ID=? ORDER BY REQUEST_ID DESC",userId(user));
            for(Map<String,Object> request:requests) {
                List<Map<String,Object>> items=new ArrayList<>();
                for(Map<String,Object> row:db.queryForList("SELECT * FROM REQUEST_ITEM WHERE REQUEST_ID=? ORDER BY ITEM_NO",request.get("REQUEST_ID"))) {
                    Map<String,Object> item=new LinkedHashMap<>(resources.getOrDefault(resourceKey(row),map("id",resourceKey(row),"name","등록 자원","kind","E".equals(row.get("ITEM_KIND"))?"장비":"시설","code",resourceKey(row))));
                    item.putAll(map("version",row.get("ROW_VERSION"),"stage",row.get("STATUS_CODE"),"condition",condition(row),"updatedAt",local(row.get("UPDATED_AT"))));
                    for(Map<String,Object> log:db.queryForList("SELECT L.*,U.USER_NAME,U.ROLE_CODE FROM REQUEST_STATUS_LOG L JOIN APP_USER U ON U.USER_ID=L.CHANGED_BY WHERE L.REQUEST_ITEM_ID=? ORDER BY L.STATUS_LOG_ID",row.get("REQUEST_ITEM_ID"))) {
                        String status=(String)log.get("TO_STATUS");
                        Map<String,String> names=new HashMap<>();names.put("approved","approved");names.put("rejected","rejected");names.put("cancelled","cancelled");names.put("collected","collected");names.put("return_requested","returnRequested");names.put("returned","returned");
                        String prefix=names.get(status);
                        if(prefix!=null) {item.put(prefix+"At",local(log.get("CHANGED_AT")));item.put(prefix+"By",map("id",log.get("CHANGED_BY").toString(),"role",log.get("ROLE_CODE"),"name",log.get("USER_NAME")));}
                        if("rejected".equals(status)) item.put("rejectionReason",log.get("REASON_TEXT"));
                    }
                    if("F".equals(row.get("ITEM_KIND"))) {
                        item.put("startedAt",item.get("collectedAt"));item.put("startedBy",item.get("collectedBy"));item.put("endedAt",item.get("returnedAt"));item.put("endedBy",item.get("returnedBy"));
                    } else addInspection(item,row,request.get("REQUEST_NO").toString());
                    items.add(item);
                }
                records.add(map("number",request.get("REQUEST_NO"),"userId",request.get("APPLICANT_ID").toString(),"createdAt",local(request.get("REQUESTED_AT")),"condition",items.isEmpty()?null:items.get(0).get("condition"),"items",items));
            }
        }
        return map("status","saved","records",records,"equipmentStates",catalog.equipmentStates());
    }
    public Map<String,Object> selection(Map<String,Object> user) {
        Map<String,Object> selected=new LinkedHashMap<>();
        if(user!=null) for(Map<String,Object> row:db.queryForList("SELECT * FROM SELECTION_ITEM WHERE USER_ID=? ORDER BY SELECTION_ITEM_ID",userId(user))) selected.put(resourceKey(row),condition(row));
        return map("selected",selected);
    }
    @Transactional
    public Map<String,Object> saveSelection(JsonNode input,Map<String,Object> user) {
        JsonNode selected=input.path("selected");require(selected.isObject()&&selected.size()<=20,"선택 목록을 확인해주세요.");
        db.queryForObject("SELECT USER_ID FROM APP_USER WHERE USER_ID=? FOR UPDATE WAIT 10",Long.class,userId(user));
        List<Map<String,Object>> values=new ArrayList<>();
        Iterator<Map.Entry<String,JsonNode>> fields=selected.fields();
        while(fields.hasNext()) {
            Map.Entry<String,JsonNode> entry=fields.next();String key=entry.getKey();catalog.find(key);
            Map<String,Object> c=parseCondition(entry.getValue());c.put("key",key);values.add(c);
        }
        db.update("DELETE FROM SELECTION_ITEM WHERE USER_ID=?",userId(user));
        for(Map<String,Object> c:values) {
            String key=(String)c.get("key");
            db.update("INSERT INTO SELECTION_ITEM VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",next("SELECTION_ITEM"),userId(user),key.substring(0,1),key.startsWith("E")?CatalogService.number(key):null,key.startsWith("F")?CatalogService.number(key):null,c.get("USE_START_AT"),c.get("USE_END_AT"),c.get("PEOPLE_COUNT"),c.get("PURPOSE_ID"),"direct",null,now());
        }
        return selection(user);
    }
    private void addInspection(Map<String,Object> item,Map<String,Object> row,String number) {
        List<Map<String,Object>> checkouts=db.queryForList("SELECT * FROM EQUIPMENT_CHECKOUT WHERE REQUEST_ITEM_ID=?",row.get("REQUEST_ITEM_ID"));
        if(checkouts.isEmpty()) return;
        Map<String,Object> out=checkouts.get(0);Object id=out.get("CHECKOUT_ID");
        List<Map<String,Object>> components=new ArrayList<>();
        for(Map<String,Object> c:db.queryForList("SELECT * FROM CHECKOUT_COMPONENT WHERE CHECKOUT_ID=? ORDER BY COMPONENT_SEQ",id)) components.add(map("componentId",c.get("COMPONENT_SEQ").toString(),"name",c.get("COMPONENT_NAME"),"requiredQuantity",c.get("REQUIRED_QTY"),"deliveredQuantity",c.get("DELIVERED_QTY"),"body","Y".equals(c.get("BODY_YN")),"required","Y".equals(c.get("REQUIRED_YN")),"condition",c.get("OUT_CONDITION"),"note",c.get("NOTE_TEXT"),"confirmed",true));
        item.put("checkoutSnapshot",map("recordNumber",number,"itemId",item.get("id"),"resourceId",item.get("id"),"resourceCode",out.get("ASSET_CODE_SNAPSHOT"),"resourceName",out.get("EQUIPMENT_NAME_SNAPSHOT"),"source",out.get("SOURCE_CODE"),"registeredAt",local(out.get("REGISTERED_AT")),"checkoutAt",local(out.get("ACTUAL_CHECKOUT_AT")),"registeredBy",map("id",out.get("REGISTERED_BY").toString(),"role","admin"),"components",components));
        List<Map<String,Object>> rounds=new ArrayList<>();Map<String,Integer> totals=new HashMap<>();Set<String> damaged=new HashSet<>();
        for(Map<String,Object> round:db.queryForList("SELECT * FROM RETURN_INSPECTION WHERE CHECKOUT_ID=? ORDER BY INSPECTION_ROUND",id)) {
            List<Map<String,Object>> outcomes=new ArrayList<>();
            for(Map<String,Object> c:components) {
                String cid=(String)c.get("componentId");
                List<Map<String,Object>> returned=db.queryForList("SELECT * FROM RETURN_COMPONENT WHERE CHECKOUT_ID=? AND INSPECTION_ROUND=? AND COMPONENT_SEQ=?",id,round.get("INSPECTION_ROUND"),Long.parseLong(cid));
                Map<String,Object> ret=returned.isEmpty()?Collections.emptyMap():returned.get(0);
                int added=ret.isEmpty()?0:((Number)ret.get("RETURNED_QTY")).intValue(),total=totals.getOrDefault(cid,0)+added;totals.put(cid,total);
                if("damaged".equals(ret.get("RETURN_CONDITION")) || "damaged".equals(c.get("condition"))) damaged.add(cid);
                outcomes.add(map("componentId",cid,"name",c.get("name"),"addedQuantity",added,"cumulativeQuantity",total,"missingQuantity",((Number)c.get("deliveredQuantity")).intValue()-total,"damaged",damaged.contains(cid),"note",ret.get("NOTE_TEXT"),"checkedThisRound",!ret.isEmpty()));
            }
            String outcome="held".equals(round.get("OUTCOME_CODE"))?"return_held":"returned";
            rounds.add(map("round",round.get("INSPECTION_ROUND"),"at",local(round.get("INSPECTED_AT")),"actor",map("id",round.get("INSPECTED_BY").toString(),"role","admin"),"outcome",outcome,"reason",round.get("HOLD_REASON"),"memo",round.get("NOTE_TEXT"),"rows",outcomes));
            if(outcome.equals("return_held")) item.put("returnHoldReason",round.get("HOLD_REASON"));else item.remove("returnHoldReason");
        }
        item.put("returnInspections",rounds);
    }
    @Transactional
    public Map<String,Object> change(JsonNode input,Map<String,Object> user) {
        String type=text(input,"type",30);
        if(type.equals("create")) {
            String number=create(input.path("record"),user);
            Map<String,Object> result=state(user);
            result.put("createdNumber",number);
            return result;
        }
        String number=text(input,"number",30),key=text(input,"itemId",20);
        lockResource(key);
        String field=key.startsWith("E")?"EQUIPMENT_ID":"FACILITY_ID";
        List<Map<String,Object>> found=db.queryForList("SELECT I.*,R.APPLICANT_ID FROM REQUEST_ITEM I JOIN RENT_REQUEST R ON R.REQUEST_ID=I.REQUEST_ID WHERE R.REQUEST_NO=? AND I."+field+"=? FOR UPDATE OF I.ROW_VERSION WAIT 10",number,CatalogService.number(key));
        if(found.size()!=1) throw new ApiException(404,"신청을 찾을 수 없습니다.");
        Map<String,Object> item=found.get(0);
        if(!admin(user) && id(item.get("APPLICANT_ID"))!=userId(user)) throw new ApiException(403,"본인의 신청만 변경할 수 있습니다.");
        if(id(item.get("ROW_VERSION"))!=integer(input,"expectedVersion",0,Integer.MAX_VALUE) || !item.get("STATUS_CODE").equals(text(input,"from",20))) throw new ApiException(409,"신청 상태가 변경되었습니다. 새로고침 후 다시 확인해주세요.");
        if(type.equals("transition")) transition(item,key,text(input,"to",20),text(input,"reason",1000),user);
        else inspect(item,key,type,input,user);
        return state(user);
    }
    private String create(JsonNode record,Map<String,Object> user) {
        require(!admin(user),"학생 계정으로 신청해주세요.");
        JsonNode items=record.path("items");require(items.isArray()&&items.size()>0&&items.size()<=20,"신청 항목을 확인해주세요.");
        Set<String> keys=new TreeSet<>();for(JsonNode item:items) require(keys.add(text(item,"id",20)),"동일 자원은 한 번만 신청할 수 있습니다.");
        keys.forEach(this::lockResource);
        long request=next("RENT_REQUEST");Timestamp time=now();
        String number="CR-"+String.format("%010d",request);
        db.update("INSERT INTO RENT_REQUEST VALUES(?,?,?,?)",request,number,userId(user),time);
        int order=0;
        for(JsonNode item:items) {
            String key=text(item,"id",20);Map<String,Object> c=parseCondition(item.has("condition")?item.get("condition"):record.path("condition"));available(key,c,null);
            long id=next("REQUEST_ITEM");
            db.update("INSERT INTO REQUEST_ITEM VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",id,request,++order,key.substring(0,1),key.startsWith("E")?CatalogService.number(key):null,key.startsWith("F")?CatalogService.number(key):null,c.get("USE_START_AT"),c.get("USE_END_AT"),c.get("PEOPLE_COUNT"),c.get("PURPOSE_ID"),"direct",null,"pending",0,time);
            log(id,null,"pending",userId(user),null,time);
        }
        return number;
    }
    private void transition(Map<String,Object> item,String key,String to,String reason,Map<String,Object> user) {
        String from=(String)item.get("STATUS_CODE");boolean equipment=key.startsWith("E");
        boolean allowed=admin(user)?from.equals("pending")&&(to.equals("approved")||to.equals("rejected")) || !equipment&&(from.equals("approved")&&to.equals("collected")||from.equals("collected")&&to.equals("returned")):
                from.equals("pending")&&to.equals("cancelled") || equipment&&from.equals("collected")&&to.equals("return_requested");
        if(!allowed) throw new ApiException(403,"현재 역할과 상태에서는 처리할 수 없습니다.");
        require(!to.equals("rejected")||!reason.isEmpty(),"거절 사유를 입력해주세요.");
        if(to.equals("approved")) available(key,item,id(item.get("REQUEST_ITEM_ID")));
        Timestamp time=now();
        if(to.equals("collected")) {
            operational(key);unoccupied(key,id(item.get("REQUEST_ITEM_ID")));
            db.update("INSERT INTO FACILITY_USAGE VALUES(?,?, 'F',?,?,NULL,NULL,NULL)",next("FACILITY_USAGE"),item.get("REQUEST_ITEM_ID"),time,userId(user));
        }
        if(to.equals("returned")) db.update("UPDATE FACILITY_USAGE SET ENDED_AT=?,ENDED_BY=? WHERE REQUEST_ITEM_ID=? AND ENDED_AT IS NULL",time,userId(user),item.get("REQUEST_ITEM_ID"));
        update(item,to,userId(user),reason,time);
    }
    private void operational(String key) {
        Map<String,Object> resource=catalog.find(key);require(Boolean.TRUE.equals(resource.get("rentable"))&&"정상".equals(resource.get("status")),"현재 운영 상태로는 출고 또는 이용 시작을 할 수 없습니다.");
    }
    private void unoccupied(String key,long item) {
        String field=key.startsWith("E")?"EQUIPMENT_ID":"FACILITY_ID";
        require(db.queryForObject("SELECT COUNT(*) FROM REQUEST_ITEM WHERE "+field+"=? AND REQUEST_ITEM_ID<>? AND STATUS_CODE IN ('collected','return_requested','return_held')",Integer.class,CatalogService.number(key),item)==0,"이전 이용 또는 반납 확인이 완료되지 않았습니다.");
    }
    private void log(long item,String from,String to,long actor,String reason,Timestamp time) {
        db.update("INSERT INTO REQUEST_STATUS_LOG VALUES(?,?,?,?,?,?,?)",next("REQUEST_STATUS_LOG"),item,from,to,actor,time,reason);
    }
    private void update(Map<String,Object> item,String to,long actor,String reason,Timestamp time) {
        int count=db.update("UPDATE REQUEST_ITEM SET STATUS_CODE=?,ROW_VERSION=ROW_VERSION+1,UPDATED_AT=? WHERE REQUEST_ITEM_ID=? AND ROW_VERSION=?",to,time,item.get("REQUEST_ITEM_ID"),item.get("ROW_VERSION"));
        if(count!=1) throw new ApiException(409,"신청 상태가 변경되었습니다.");
        log(id(item.get("REQUEST_ITEM_ID")),(String)item.get("STATUS_CODE"),to,actor,reason,time);
    }
    private Map<String,JsonNode> rows(JsonNode input) {
        JsonNode rows=input.path("rows");require(rows.isArray()&&rows.size()>0&&rows.size()<=100,"모든 구성품 확인 결과를 입력해주세요.");
        Map<String,JsonNode> result=new LinkedHashMap<>();
        for(JsonNode r:rows) {
            String id=text(r,"componentId",20),condition=text(r,"condition",10),note=text(r,"note",500);
            require(result.put(id,r)==null && !id.isEmpty(),"중복되거나 잘못된 구성품입니다.");integer(r,"quantity",0,99999);
            require(r.path("confirmed").isBoolean()&&r.path("confirmed").asBoolean()&&(condition.equals("normal")||condition.equals("damaged")),"구성품 수량과 상태 확인이 필요합니다.");
            require(!condition.equals("damaged")||!note.isEmpty(),"손상 내용을 입력해주세요.");
        }
        return result;
    }
    private void equipmentState(Map<String,Object> item,Map<String,Object> equipment,String status,String reason,String action,long actor,Timestamp time) {
        db.update("UPDATE EQUIPMENT SET OPERATING_STATUS=?,ROW_VERSION=ROW_VERSION+1 WHERE EQUIPMENT_ID=?",status,equipment.get("EQUIPMENT_ID"));
        db.update("INSERT INTO EQUIPMENT_CHECK_LOG VALUES(?,?,?,?,?,?,?,?,?)",next("EQUIPMENT_CHECK_LOG"),equipment.get("EQUIPMENT_ID"),item.get("REQUEST_ITEM_ID"),action,equipment.get("OPERATING_STATUS"),status,reason,actor,time);
    }
    private void inspect(Map<String,Object> item,String key,String type,JsonNode input,Map<String,Object> user) {
        if(!admin(user)||!key.startsWith("E")) throw new ApiException(403,"장비 검수는 관리자만 처리할 수 있습니다.");
        Map<String,Object> equipment=db.queryForMap("SELECT * FROM EQUIPMENT WHERE EQUIPMENT_ID=?",CatalogService.number(key));
        if(id(equipment.get("ROW_VERSION"))!=integer(input,"expectedEquipmentVersion",0,Integer.MAX_VALUE)) throw new ApiException(409,"장비 상태가 변경되었습니다.");
        String from=(String)item.get("STATUS_CODE"),memo=text(input,"memo",1000);Timestamp time=now();long actor=userId(user);
        if(type.equals("maintenance_required")||type.equals("maintenance_complete")) {
            require(input.path("confirmed").asBoolean(false)&&!memo.isEmpty(),"실제 점검 확인과 메모를 입력해주세요.");
            if(type.equals("maintenance_complete")) {
                require("inspection".equals(equipment.get("OPERATING_STATUS")),"점검 중인 장비만 완료할 수 있습니다.");
                unoccupied(key,-1);require("Y".equals(equipment.get("LEND_ALLOWED_YN")),"기본 대여 허용 상태를 확인해주세요.");
            }
            equipmentState(item,equipment,type.equals("maintenance_complete")?"normal":"inspection",memo,type.equals("maintenance_complete")?"completed":"required",actor,time);
            update(item,from,actor,memo,time);return;
        }
        if(type.equals("checkout")) {
            require(from.equals("approved"),"승인된 장비만 출고할 수 있습니다.");operational(key);unoccupied(key,id(item.get("REQUEST_ITEM_ID")));
            require(db.queryForObject("SELECT COUNT(*) FROM EQUIPMENT_CHECKOUT WHERE REQUEST_ITEM_ID=?",Integer.class,item.get("REQUEST_ITEM_ID"))==0,"출고 기준은 다시 생성할 수 없습니다.");
            List<Map<String,Object>> definitions=db.queryForList("SELECT * FROM EQUIPMENT_COMPONENT WHERE EQUIPMENT_ID=? ORDER BY DISPLAY_ORDER,COMPONENT_ID",CatalogService.number(key));Map<String,JsonNode> rows=rows(input);
            require(!definitions.isEmpty()&&definitions.stream().anyMatch(c->"Y".equals(c.get("BODY_YN")))&&rows.size()==definitions.size(),"본체를 포함한 모든 구성품을 확인해주세요.");
            long checkout=next("EQUIPMENT_CHECKOUT");
            db.update("INSERT INTO EQUIPMENT_CHECKOUT VALUES(?,?, 'E',?,?,?,?,?,?)",checkout,item.get("REQUEST_ITEM_ID"),equipment.get("ASSET_CODE"),equipment.get("EQUIPMENT_NAME"),"registered-checkout",time,time,actor);
            int order=0;
            for(Map<String,Object> c:definitions) {
                JsonNode row=rows.get(c.get("COMPONENT_ID").toString());require(row!=null,"구성품 확인이 누락되었습니다.");
                require(integer(row,"quantity",0,99999)==id(c.get("REQUIRED_QTY"))&&"normal".equals(text(row,"condition",10)),"고정 세트의 전체 수량을 정상 상태로 출고해야 합니다.");
                db.update("INSERT INTO CHECKOUT_COMPONENT VALUES(?,?,?,?,?,?,?,?,?)",checkout,++order,c.get("COMPONENT_NAME"),c.get("REQUIRED_QTY"),row.path("quantity").asInt(),c.get("BODY_YN"),c.get("REQUIRED_YN"),"normal",text(row,"note",500));
            }
            update(item,"collected",actor,memo,time);return;
        }
        require(type.equals("inspect_return"),"지원하지 않는 처리입니다.");
        require(from.equals("return_requested")||from.equals("return_held"),"반납 신청 또는 보류 상태에서 검수해주세요.");
        List<Long> ids=db.queryForList("SELECT CHECKOUT_ID FROM EQUIPMENT_CHECKOUT WHERE REQUEST_ITEM_ID=?",Long.class,item.get("REQUEST_ITEM_ID"));require(ids.size()==1,"출고 기준이 필요합니다.");long checkout=ids.get(0);
        List<Map<String,Object>> components=db.queryForList("SELECT * FROM CHECKOUT_COMPONENT WHERE CHECKOUT_ID=? ORDER BY COMPONENT_SEQ",checkout);Map<String,JsonNode> rows=rows(input);
        require(rows.size()==components.size(),"모든 구성품의 이번 반환 결과를 입력해주세요.");
        int round=db.queryForObject("SELECT NVL(MAX(INSPECTION_ROUND),0)+1 FROM RETURN_INSPECTION WHERE CHECKOUT_ID=?",Integer.class,checkout);require(round<=999,"반납 확인 회차 한도를 초과했습니다.");
        boolean missing=false,damaged=false;List<String> reasons=new ArrayList<>();
        for(Map<String,Object> c:components) {
            JsonNode row=rows.get(c.get("COMPONENT_SEQ").toString());require(row!=null,"출고 기준 밖 구성품이거나 확인이 누락되었습니다.");
            int previous=db.queryForObject("SELECT NVL(SUM(RETURNED_QTY),0) FROM RETURN_COMPONENT WHERE CHECKOUT_ID=? AND COMPONENT_SEQ=?",Integer.class,checkout,c.get("COMPONENT_SEQ"));
            long outstanding=id(c.get("DELIVERED_QTY"))-previous-integer(row,"quantity",0,99999);require(outstanding>=0,"누적 반환 수량이 출고 수량을 초과합니다.");
            if(outstanding>0){missing=true;reasons.add(c.get("COMPONENT_NAME")+" "+outstanding+"개 부족");}
            boolean broken="damaged".equals(text(row,"condition",10))||"damaged".equals(c.get("OUT_CONDITION"))||db.queryForObject("SELECT COUNT(*) FROM RETURN_COMPONENT WHERE CHECKOUT_ID=? AND COMPONENT_SEQ=? AND RETURN_CONDITION='damaged'",Integer.class,checkout,c.get("COMPONENT_SEQ"))>0;
            if(broken){damaged=true;reasons.add(c.get("COMPONENT_NAME")+" 손상");}
        }
        String reason=String.join(" · ",reasons);require(reason.length()<=1000,"검수 사유가 너무 깁니다.");
        db.update("INSERT INTO RETURN_INSPECTION VALUES(?,?,?,?,?,?,?)",checkout,round,actor,time,missing?"held":"returned",reason,memo);
        for(Map<String,Object> c:components) {JsonNode row=rows.get(c.get("COMPONENT_SEQ").toString());db.update("INSERT INTO RETURN_COMPONENT VALUES(?,?,?,?,?,?)",checkout,round,c.get("COMPONENT_SEQ"),row.path("quantity").asInt(),text(row,"condition",10),text(row,"note",500));}
        if(missing||damaged) equipmentState(item,equipment,"inspection",reason,"return_inspection",actor,time);
        update(item,missing?"return_held":"returned",actor,reason,time);
    }
}

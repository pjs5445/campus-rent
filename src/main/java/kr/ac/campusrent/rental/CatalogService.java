package kr.ac.campusrent.rental;

import java.util.*;
import static kr.ac.campusrent.api.Json.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import kr.ac.campusrent.api.ApiException;

@Service
public class CatalogService {
    private final JdbcTemplate db;
    public CatalogService(JdbcTemplate db) { this.db=db; }
    public static String key(String kind,Object id) { return kind+id; }
    public static long number(String key) {
        ApiException.require(key!=null && key.matches("[EF][1-9][0-9]{0,9}"),"자원 ID를 확인해주세요.");
        return Long.parseLong(key.substring(1));
    }
    public Map<String,Object> find(String key) {
        number(key);
        return resources().stream().filter(r->key.equals(r.get("id"))).findFirst().orElseThrow(()->new ApiException(404,"자원을 찾을 수 없습니다."));
    }
    public List<Map<String,Object>> resources() {
        List<Map<String,Object>> result=new ArrayList<>();
        List<Map<String,Object>> componentRows=db.queryForList("SELECT * FROM EQUIPMENT_COMPONENT ORDER BY DISPLAY_ORDER,COMPONENT_ID");
        List<Map<String,Object>> alternativeRows=db.queryForList("SELECT * FROM EQUIPMENT_ALTERNATIVE WHERE ENABLED_YN='Y'");
        List<Map<String,Object>> specRows=db.queryForList("SELECT S.MODEL_ID,S.SPEC_VALUE FROM MODEL_SPEC S JOIN SPEC_ITEM I ON I.SPEC_ITEM_ID=S.SPEC_ITEM_ID ORDER BY I.DISPLAY_ORDER");
        List<Map<String,Object>> purposeRows=db.queryForList("SELECT F.FACILITY_ID,P.PURPOSE_NAME FROM FACILITY_PURPOSE F JOIN USE_PURPOSE P ON P.PURPOSE_ID=F.PURPOSE_ID WHERE P.ENABLED_YN='Y' ORDER BY P.PURPOSE_ID");
        List<Map<String,Object>> hourRows=db.queryForList("SELECT * FROM FACILITY_HOURS ORDER BY WEEKDAY_NO");
        for(Map<String,Object> row:db.queryForList("SELECT E.*, M.MODEL_NAME,T.CATEGORY_LABEL FROM EQUIPMENT E JOIN EQUIPMENT_MODEL M ON M.MODEL_ID=E.MODEL_ID JOIN EQUIPMENT_TYPE T ON T.TYPE_ID=M.TYPE_ID WHERE T.ENABLED_YN='Y' ORDER BY E.EQUIPMENT_ID")) {
            Object id=row.get("EQUIPMENT_ID");
            List<Map<String,Object>> components=new ArrayList<>(); List<String> contents=new ArrayList<>();
            for(Map<String,Object> c:matching(componentRows,"EQUIPMENT_ID",id)) {
                components.add(map("componentId",c.get("COMPONENT_ID").toString(),"name",c.get("COMPONENT_NAME"),"requiredQuantity",c.get("REQUIRED_QTY"),"body","Y".equals(c.get("BODY_YN")),"required","Y".equals(c.get("REQUIRED_YN"))));
                contents.add(c.get("COMPONENT_NAME")+" "+c.get("REQUIRED_QTY")+"개");
            }
            List<String> alternatives=new ArrayList<>();
            matching(alternativeRows,"SOURCE_EQUIPMENT_ID",id).forEach(a->alternatives.add(key("E",a.get("TARGET_EQUIPMENT_ID"))));
            List<String> specs=matching(specRows,"MODEL_ID",row.get("MODEL_ID")).stream().map(s->String.valueOf(s.get("SPEC_VALUE"))).collect(java.util.stream.Collectors.toList());
            String category=(String)row.get("CATEGORY_LABEL");
            result.add(map("id",key("E",id),"name",row.get("EQUIPMENT_NAME"),"code",row.get("ASSET_CODE"),"kind","장비","category",category,"model",row.get("MODEL_NAME"),"specs",specs,"contents",contents,"components",components,"alternatives",alternatives,"location",row.get("STORAGE_LOCATION"),"rentable","Y".equals(row.get("LEND_ALLOWED_YN")),"status","normal".equals(row.get("OPERATING_STATUS"))?"정상":"점검","icon",category.equals("카메라")?"ff97a.svg":category.equals("마이크")?"054e2.svg":"1eae3.svg"));
        }
        for(Map<String,Object> row:db.queryForList("SELECT * FROM FACILITY ORDER BY FACILITY_ID")) {
            Object id=row.get("FACILITY_ID");
            List<String> uses=matching(purposeRows,"FACILITY_ID",id).stream().map(p->(String)p.get("PURPOSE_NAME")).collect(java.util.stream.Collectors.toList());
            Map<String,Object> hours=new LinkedHashMap<>();
            for(Map<String,Object> h:matching(hourRows,"FACILITY_ID",id)) hours.put(h.get("WEEKDAY_NO").toString(),Arrays.asList(h.get("OPEN_TIME"),h.get("CLOSE_TIME")));
            result.add(map("id",key("F",id),"name",row.get("FACILITY_NAME"),"code",row.get("FACILITY_CODE"),"kind","시설","category",row.get("FACILITY_TYPE"),"model","시설","capacity",row.get("CAPACITY"),"allowedUses",uses,"specs",Arrays.asList("수용 "+row.get("CAPACITY")+"명","공간 전체 예약"),"contents",Arrays.asList(String.valueOf(row.get("FIXED_EQUIPMENT_INFO")).split(" · ")),"location",row.get("LOCATION_TEXT"),"rentable","Y".equals(row.get("USE_ALLOWED_YN")),"status","normal".equals(row.get("OPERATING_STATUS"))?"정상":"점검","icon","b46a5.svg","operatingHours",hours.values().stream().findFirst().orElse(Arrays.asList("00:00","00:00")),"weeklyHours",hours,"alternatives",Collections.emptyList()));
        }
        return result;
    }
    private List<Map<String,Object>> matching(List<Map<String,Object>> rows,String column,Object value) {
        return rows.stream().filter(row->row.get(column).toString().equals(value.toString())).collect(java.util.stream.Collectors.toList());
    }
    public List<Map<String,Object>> reservations() {
        List<Map<String,Object>> result=new ArrayList<>();
        for(Map<String,Object> row:db.queryForList("SELECT ITEM_KIND,EQUIPMENT_ID,FACILITY_ID,USE_START_AT,USE_END_AT FROM REQUEST_ITEM WHERE STATUS_CODE IN ('approved','collected','return_requested','return_held','returned')")) result.add(map("resourceId",key((String)row.get("ITEM_KIND"),row.get("EQUIPMENT_ID")==null?row.get("FACILITY_ID"):row.get("EQUIPMENT_ID")),"start",local(row.get("USE_START_AT")),"end",local(row.get("USE_END_AT")),"approved",true,"reason","승인된 신청과 이용 기간이 겹칩니다."));
        for(Map<String,Object> row:db.queryForList("SELECT * FROM FACILITY_BLOCK")) result.add(map("resourceId",key("F",row.get("FACILITY_ID")),"start",local(row.get("BLOCK_START_AT")),"end",local(row.get("BLOCK_END_AT")),"approved",true,"reason","시설 이용 제한 시간입니다."));
        return result;
    }
    public static String local(Object timestamp) { return timestamp==null?null:((java.sql.Timestamp)timestamp).toLocalDateTime().toString(); }
    public Map<String,Object> equipmentStates() {
        Map<String,Object> states=new LinkedHashMap<>();
        for(Map<String,Object> row:db.queryForList("SELECT EQUIPMENT_ID,OPERATING_STATUS,ROW_VERSION FROM EQUIPMENT")) states.put(key("E",row.get("EQUIPMENT_ID")),map("status",row.get("OPERATING_STATUS"),"version",row.get("ROW_VERSION"),"reason","장비 운영 상태","events",Collections.emptyList()));
        return states;
    }
}

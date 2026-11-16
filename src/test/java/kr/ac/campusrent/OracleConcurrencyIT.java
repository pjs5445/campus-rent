package kr.ac.campusrent;

import static kr.ac.campusrent.api.Json.*;
import static org.junit.jupiter.api.Assertions.*;
import java.sql.Timestamp;
import java.util.*;
import java.util.concurrent.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import kr.ac.campusrent.rental.RentalService;
import kr.ac.campusrent.api.ApiException;

/** Uses isolated fixture IDs and removes only its own committed test data in finally. */
@SpringBootTest(properties="debug=false")
class OracleConcurrencyIT {
    @Autowired JdbcTemplate db; @Autowired RentalService rentals; @Autowired ObjectMapper json;
    private long next(String table) { return db.queryForObject("SELECT SEQ_"+table+".NEXTVAL FROM DUAL",Long.class); }
    @Test void simultaneousApprovalAllowsOnlyOneReservation() throws Exception {
        long facility=next("FACILITY"),user=next("APP_USER"),r1=next("RENT_REQUEST"),r2=next("RENT_REQUEST"),i1=next("REQUEST_ITEM"),i2=next("REQUEST_ITEM");
        long admin=db.queryForObject("SELECT MIN(USER_ID) FROM APP_USER WHERE ROLE_CODE='admin'",Long.class),purpose=db.queryForObject("SELECT MIN(PURPOSE_ID) FROM USE_PURPOSE",Long.class);
        String prefix="IT-"+UUID.randomUUID().toString().substring(0,8);
        ExecutorService pool=Executors.newFixedThreadPool(2);
        try {
            db.update("INSERT INTO APP_USER VALUES(?,?,?,?,?,SYSTIMESTAMP)",user,prefix+"@example.invalid","not-a-login-hash","동시성검증","student");
            db.update("INSERT INTO FACILITY VALUES(?,?,?,?,?,?,?,?,?,?,?)",facility,prefix,"동시성 검증 전용","회의실","테스트",5,null,"Y","normal","Y",0);
            for(int day=1;day<=7;day++)db.update("INSERT INTO FACILITY_HOURS VALUES(?,?,?,?)",facility,day,"09:00","20:00");
            db.update("INSERT INTO FACILITY_PURPOSE VALUES(?,?)",facility,purpose);
            long[] requests={r1,r2},items={i1,i2};
            for(int n=0;n<2;n++){
                db.update("INSERT INTO RENT_REQUEST VALUES(?,?,?,SYSTIMESTAMP)",requests[n],prefix+"-"+n,user);
                db.update("INSERT INTO REQUEST_ITEM VALUES(?,?,1,'F',NULL,?,?,?,?,?,'direct',NULL,'pending',0,SYSTIMESTAMP)",items[n],requests[n],facility,Timestamp.valueOf("2099-11-01 14:00:00"),Timestamp.valueOf("2099-11-01 16:00:00"),2,purpose);
            }
            CountDownLatch start=new CountDownLatch(1);List<Future<Integer>> results=new ArrayList<>();
            for(int n=0;n<2;n++){
                final String number=prefix+"-"+n;
                results.add(pool.submit(()->{start.await();try{rentals.change(json.valueToTree(map("type","transition","number",number,"itemId","F"+facility,"expectedVersion",0,"from","pending","to","approved")),map("id",Long.toString(admin),"role","admin"));return 200;}catch(ApiException e){return e.status;}}));
            }
            start.countDown();List<Integer> statuses=new ArrayList<>();for(Future<Integer> result:results)statuses.add(result.get(45,TimeUnit.SECONDS));Collections.sort(statuses);
            assertEquals(Arrays.asList(200,409),statuses);
            assertEquals(1,db.queryForObject("SELECT COUNT(*) FROM REQUEST_ITEM WHERE FACILITY_ID=? AND STATUS_CODE='approved'",Integer.class,facility));
        } finally {
            pool.shutdown();if(!pool.awaitTermination(45,TimeUnit.SECONDS)){pool.shutdownNow();throw new AssertionError("Concurrent test workers did not finish; fixture cleanup must be reviewed");}
            db.update("DELETE FROM REQUEST_STATUS_LOG WHERE REQUEST_ITEM_ID IN (?,?)",i1,i2);
            db.update("DELETE FROM REQUEST_ITEM WHERE REQUEST_ITEM_ID IN (?,?)",i1,i2);
            db.update("DELETE FROM RENT_REQUEST WHERE REQUEST_ID IN (?,?)",r1,r2);
            db.update("DELETE FROM FACILITY_PURPOSE WHERE FACILITY_ID=?",facility);
            db.update("DELETE FROM FACILITY_HOURS WHERE FACILITY_ID=?",facility);
            db.update("DELETE FROM FACILITY WHERE FACILITY_ID=?",facility);
            db.update("DELETE FROM APP_USER WHERE USER_ID=?",user);
        }
    }
}

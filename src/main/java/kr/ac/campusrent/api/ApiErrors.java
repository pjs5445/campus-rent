package kr.ac.campusrent.api;

import static kr.ac.campusrent.api.Json.map;
import java.util.Map;
import org.springframework.dao.*;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;

@RestControllerAdvice
public class ApiErrors {
    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Map<String,Object>> business(ApiException e) { return response(e.status,e.getMessage()); }
    @ExceptionHandler(DuplicateKeyException.class)
    public ResponseEntity<Map<String,Object>> duplicate() { return response(409,"이미 처리되었거나 등록된 정보입니다. 최신 상태를 확인해주세요."); }
    @ExceptionHandler({HttpMessageNotReadableException.class, IllegalArgumentException.class})
    public ResponseEntity<Map<String,Object>> invalid() { return response(400,"요청 형식을 확인해주세요."); }
    @ExceptionHandler(DataAccessException.class)
    public ResponseEntity<Map<String,Object>> database() { return response(503,"데이터를 처리하지 못했습니다. 잠시 후 다시 시도해주세요."); }
    private ResponseEntity<Map<String,Object>> response(int status,String message) { return ResponseEntity.status(status).body(map("message",message,"status",status==409?"conflict":"failed")); }
}

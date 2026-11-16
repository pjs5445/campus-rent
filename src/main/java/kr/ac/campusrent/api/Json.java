package kr.ac.campusrent.api;

import java.util.*;
import com.fasterxml.jackson.databind.JsonNode;

public final class Json {
    private Json() {}
    public static Map<String,Object> map(Object... pairs) {
        Map<String,Object> result = new LinkedHashMap<>();
        for (int i=0;i<pairs.length;i+=2) result.put((String)pairs[i], pairs[i+1]);
        return result;
    }
    public static String text(JsonNode node, String key, int limit) {
        JsonNode value = node.path(key);
        ApiException.require(value.isMissingNode() || value.isNull() || value.isTextual(), "문자열 입력을 확인해주세요.");
        String result = value.asText("").trim();
        ApiException.require(result.length() <= limit, "입력 길이가 허용 범위를 초과했습니다.");
        return result;
    }
    public static int integer(JsonNode node, String key, int min, int max) {
        JsonNode value = node.path(key);
        ApiException.require(value.isIntegralNumber() && value.canConvertToInt(), "정수 입력을 확인해주세요.");
        int result = value.intValue();
        ApiException.require(result >= min && result <= max, "숫자 입력 범위를 확인해주세요.");
        return result;
    }
    public static long id(Object value) { return ((Number)value).longValue(); }
}

package kr.ac.campusrent.api;

import java.util.*;
import javax.servlet.http.HttpServletRequest;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;
import kr.ac.campusrent.auth.AuthService;
import kr.ac.campusrent.rental.*;

@RestController
@RequestMapping("/api")
public class RentalController {
    private final AuthService auth; private final RentalService rentals; private final CatalogService catalog;
    public RentalController(AuthService auth,RentalService rentals,CatalogService catalog) { this.auth=auth;this.rentals=rentals;this.catalog=catalog; }
    @GetMapping("/resources") public List<Map<String,Object>> resources() { return catalog.resources(); }
    @GetMapping("/availability") public List<Map<String,Object>> availability() { return catalog.reservations(); }
    @GetMapping("/requests") public Map<String,Object> requests(HttpServletRequest request) { return rentals.state(auth.current(request)); }
    @PostMapping("/requests") public Map<String,Object> change(@RequestBody JsonNode input,HttpServletRequest request) { return rentals.change(input,auth.required(request)); }
    @GetMapping("/selection") public Map<String,Object> selection(HttpServletRequest request) { return rentals.selection(auth.current(request)); }
    @PostMapping("/selection") public Map<String,Object> selection(@RequestBody JsonNode input,HttpServletRequest request) { return rentals.saveSelection(input,auth.required(request)); }
}

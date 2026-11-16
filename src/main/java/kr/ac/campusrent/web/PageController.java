package kr.ac.campusrent.web;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/** Serves the existing browser demo; business APIs are not implemented here. */
@Controller
public class PageController {
    @GetMapping({"/", "/equipment", "/facilities", "/purpose", "/records", "/history", "/admin"})
    public String index() {
        return "index";
    }
}

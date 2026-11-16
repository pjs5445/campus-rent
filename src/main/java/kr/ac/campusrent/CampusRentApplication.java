package kr.ac.campusrent;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class CampusRentApplication {
    public static void main(String[] args) {
        org.springframework.context.ConfigurableApplicationContext context = SpringApplication.run(CampusRentApplication.class, args);
        if (java.util.Arrays.asList(context.getEnvironment().getActiveProfiles()).contains("db-setup")) context.close();
    }
}

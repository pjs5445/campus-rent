import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpExchange;
import java.net.InetSocketAddress;
import java.nio.file.*;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.Executors;

/** Local UI preview only. No Spring, authentication or database endpoints. */
public class PreviewServer {
    public static void main(String[] args) throws Exception {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 8080;
        Path root = Paths.get(args.length > 1 ? args[1] : ".").toRealPath();
        Path assets = root.resolve("src/main/resources/static").toRealPath();
        Path template = root.resolve("src/main/resources/templates/index.html");
        Set<String> routes = new HashSet<>(Arrays.asList("/", "/equipment", "/facilities", "/purpose", "/records", "/history", "/admin"));
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        server.createContext("/", exchange -> {
            try {
                if (!Arrays.asList("GET", "HEAD").contains(exchange.getRequestMethod())) {
                    exchange.getResponseHeaders().set("Allow", "GET, HEAD");
                    exchange.sendResponseHeaders(405, -1); return;
                }
                String uri = exchange.getRequestURI().getPath();
                Path file = routes.contains(uri) ? template : assets.resolve(uri.substring(1)).normalize();
                if (!routes.contains(uri) && (!file.startsWith(assets) || !Files.isRegularFile(file) || !file.toRealPath().startsWith(assets))) {
                    exchange.sendResponseHeaders(404, -1); return;
                }
                String name = file.getFileName().toString();
                String mime = name.endsWith(".html") ? "text/html; charset=utf-8" :
                    name.endsWith(".js") ? "text/javascript; charset=utf-8" :
                    name.endsWith(".css") ? "text/css; charset=utf-8" :
                    name.endsWith(".svg") ? "image/svg+xml" :
                    name.endsWith(".ttf") ? "font/ttf" : "application/octet-stream";
                exchange.getResponseHeaders().set("Content-Type", mime);
                exchange.getResponseHeaders().set("Cache-Control", "no-store");
                exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
                if (exchange.getRequestMethod().equals("HEAD")) { exchange.sendResponseHeaders(200, -1); return; }
                byte[] bytes = Files.readAllBytes(file);
                exchange.sendResponseHeaders(200, bytes.length);
                exchange.getResponseBody().write(bytes);
            } catch (IOException e) {
                System.err.println("Preview request failed: " + e.getMessage());
            } finally { exchange.close(); }
        });
        server.setExecutor(Executors.newFixedThreadPool(4));
        server.start();
        System.out.println("CampusRent UI preview: http://127.0.0.1:" + port);
        System.out.println("Stop with Ctrl+C. UI demo only; no server authentication or Oracle connection.");
    }
}

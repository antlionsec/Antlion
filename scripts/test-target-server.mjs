// Tiny local test target for verifying vulnerability scanners end-to-end.
// - GET /?q=<value>  → reflects the value unescaped (XSS bug; also a juicy
//                       parameter for cariddi's endpoint hunt)
// - GET /admin/      → directory listing-ish page (nikto bait) with a leaked
//                       AWS key in an HTML comment (cariddi secrets bait)
// - GET /debug/      → PHP warning + stack trace page (cariddi errors bait)
// - Server header    → verbose banner (nikto + whatweb bait)
// - Homepage         → email + HTML comment (cariddi info bait)
import http from "node:http";

const PORT = Number(process.argv[2] || 9999);

http
  .createServer((req, res) => {
    // nikto hammers this server with malformed paths — never let a parse
    // error kill the process, or subsequent tools get connection-refused.
    try {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      if (url.pathname === "/admin/") {
        res.writeHead(200, { "Content-Type": "text/html", Server: "Apache/2.4.7 (Unix) OpenSSL/1.0.1" });
        res.end(
          "<html><body><h1>Index of /admin</h1><a href='/admin/.env'>.env</a>" +
            "<!-- backup key: AKIAIOSFODNN7EXAMPLE --></body></html>",
        );
        return;
      }
      if (url.pathname === "/debug/") {
        res.writeHead(200, { "Content-Type": "text/html", Server: "Apache/2.4.7 (Unix) OpenSSL/1.0.1" });
        res.end(
          "<html><body><h1>Debug</h1>" +
            "<p>PHP Warning: mysql_connect(): Access denied for user 'root'@'localhost'</p>" +
            "<p>Stack trace: #0 /var/www/html/index.php(12): mysqli_connect()</p>" +
            "</body></html>",
        );
        return;
      }
      const q = url.searchParams.get("q") || "";
      res.writeHead(200, { "Content-Type": "text/html", Server: "Apache/2.4.7 (Unix) OpenSSL/1.0.1", "X-Powered-By": "PHP/5.3.3" });
      res.end(
        `<html><body><h1>Test</h1><div>You searched for: ${q}</div>` +
          "<!-- rendered by app v1.2.3 --><p>Questions? webmaster@test-target.local</p>" +
          "<a href='/admin/'>Admin</a> <a href='/debug/'>Debug</a></body></html>",
      );
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("bad request");
    }
  })
  .listen(PORT, "::", () => console.log(`test target on http://[::1]:${PORT} and http://127.0.0.1:${PORT} (dual-stack)`));

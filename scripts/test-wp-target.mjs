// Minimal WordPress-emulating test target for verifying CMS scanners
// (wpscan / whatweb) end-to-end. Emulates just enough of a WordPress 6.2 site
// for real fingerprinting: generator meta, wp-content/wp-includes paths,
// wp-login.php, readme.html, RSS feed, REST root, xmlrpc.php, debug.log.
import http from "node:http";

const PORT = Number(process.argv[2] || 9997);
const HOST = `http://127.0.0.1:${PORT}`;

const HTML = `<!DOCTYPE html>
<html lang="en-US">
<head>
<meta name="generator" content="WordPress 6.2">
<link rel="stylesheet" href="/wp-content/themes/twentytwentyone/style.css">
<link rel="alternate" type="application/rss+xml" title="Test WP &raquo; Feed" href="${HOST}/feed/">
<script src="/wp-includes/js/jquery/jquery.min.js"></script>
<script src="/wp-content/plugins/contact-form-7/includes/js/scripts.js"></script>
</head>
<body class="home blog">
<h1>My WordPress Test Site</h1>
<p>Welcome to our blog. Contact us at admin@wp-test.local.</p>
</body>
</html>`;

const LOGIN = `<!DOCTYPE html>
<html lang="en-US">
<head><title>Log In &lsaquo; Test WP &mdash; WordPress</title></head>
<body class="login login-login wp-core-ui">
<h1><a href="https://wordpress.org/">Powered by WordPress</a></h1>
<form name="loginform" id="loginform" action="${HOST}/wp-login.php" method="post">
<input type="text" name="log" id="user_login">
<input type="password" name="pwd" id="user_pass">
<input type="submit" name="wp-submit" id="wp-submit" value="Log In">
</form>
</body></html>`;

const README = `<!DOCTYPE html>
<html>
<head><title>WordPress &#8250; ReadMe</title></head>
<body>
<h1 id="logo"><img alt="WordPress" src="wp-admin/images/wordpress-logo.png"></h1>
<p style="text-align: center">Semantic Personal Publishing Platform</p>
<h1>First Steps</h1>
<p>Welcome. WordPress is a very special project to me.</p>
<h1>Requirements</h1>
<ul><li>PHP version 7.0 or greater.</li><li>MySQL version 5.7 or greater.</li></ul>
</body>
</html>`;

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
<title>Test WP</title>
<link>${HOST}/</link>
<description>Just another WordPress site</description>
<generator>https://wordpress.org/?v=6.2</generator>
<item><title>Hello world</title><link>${HOST}/hello-world/</link></item>
</channel>
</rss>`;

const REST = JSON.stringify({
  name: "Test WP",
  description: "Just another WordPress site",
  url: `${HOST}/`,
  namespaces: ["oembed/1.0", "wp/v2"],
  routes: { "/": [], "/wp/v2": [], "/wp/v2/posts": [] },
});

const STYLE = `/*
Theme Name: Twenty Twenty-One
Theme URI: https://wordpress.org/themes/twentytwentyone/
Author: the WordPress team
Version: 1.7
Requires at least: 5.3
*/
body { font-family: sans-serif; }`;

const PLUGIN_README = `=== Contact Form 7 ===
Contributors: takayukister
Tags: contact, form
Requires at least: 5.5
Tested up to: 6.2
Stable tag: 5.7.7
Just another contact form plugin.`;

const DEBUG_LOG = `[15-Apr-2023 09:12:33 UTC] PHP Notice:  Undefined index: page in /var/www/html/wp-content/plugins/contact-form-7/includes/controller.php on line 123
[15-Apr-2023 09:12:41 UTC] PHP Warning:  mysqli_query(): (HY000/2006): MySQL server has gone away in /var/www/html/wp-includes/wp-db.php on line 2056`;

http
  .createServer((req, res) => {
    try {
      const url = new URL(req.url, HOST);
      const p = url.pathname.replace(/\/+$/, "") || "/";
      const headers = {
        "Content-Type": "text/html; charset=UTF-8",
        Server: "Apache/2.4.41 (Ubuntu)",
        "X-Powered-By": "PHP/7.4.3",
        Link: `<${HOST}/wp-json/>; rel="https://api.w.org/"`,
      };
      const send = (body, type = "text/html", extra = {}) =>
        res.writeHead(200, { ...headers, "Content-Type": type, ...extra }).end(body);

      if (p === "/") return send(HTML);
      if (p === "/wp-login.php") return send(LOGIN);
      if (p === "/readme.html")
        return send(README, "text/html; charset=UTF-8");
      if (p === "/feed") return send(FEED, "application/rss+xml; charset=UTF-8");
      if (p === "/wp-json") return send(REST, "application/json; charset=UTF-8");
      if (p === "/wp-content/themes/twentytwentyone/style.css")
        return send(STYLE, "text/css; charset=UTF-8");
      if (p === "/wp-content/plugins/contact-form-7/readme.txt")
        return send(PLUGIN_README, "text/plain; charset=UTF-8");
      if (p === "/wp-content/debug.log")
        return send(DEBUG_LOG, "text/plain; charset=UTF-8");
      if (p === "/wp-content/uploads")
        return send("<h1>Index of /wp-content/uploads/</h1><ul><li>2023/</li></ul>");
      if (p === "/wp-content" || p === "/wp-includes")
        return send(`<h1>Index of ${p}/</h1>`);
      if (p === "/xmlrpc.php")
        return res
          .writeHead(405, { ...headers, Allow: "POST" })
          .end("XML-RPC server accepts POST requests only.");
      res.writeHead(404, headers).end("<h1>404 Not Found</h1>");
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain" }).end("bad request");
    }
  })
  .listen(PORT, "::", () =>
    console.log(`fake wordpress target on http://[::1]:${PORT} and http://127.0.0.1:${PORT}`),
  );

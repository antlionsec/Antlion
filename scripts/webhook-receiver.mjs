// Local webhook receiver for end-to-end notification testing.
// Listens on 3999, logs every POST body to stdout + /tmp/webhook-received.log
import http from "node:http";
import fs from "node:fs";

const LOG = "/tmp/webhook-received.log";
fs.writeFileSync(LOG, "");

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const entry = `--- ${new Date().toISOString()} ${req.method} ${req.url}\n${body}\n`;
    fs.appendFileSync(LOG, entry);
    console.log(entry);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"ok":true}');
  });
});

server.listen(3999, "127.0.0.1", () => console.log("receiver on http://127.0.0.1:3999/hook"));

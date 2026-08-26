// Minimal real SMTP server for verifying Antlion's email notification hooks.
// Implements enough of RFC 5321 (EHLO/MAIL/RCPT/DATA/QUIT/RSET/NOOP) for
// nodemailer to complete a full conversation. Received messages are appended
// to /tmp/antlion-smtp-inbox.jsonl.
//
// Usage: node scripts/smtp-test-server.mjs [port]
import net from "node:net";
import fs from "node:fs";

const PORT = parseInt(process.argv[2] || "2525", 10);
const OUT = "/tmp/antlion-smtp-inbox.jsonl";
fs.writeFileSync(OUT, ""); // fresh inbox per run

const server = net.createServer((socket) => {
  let state = "greet"; // greet -> ehlo -> mail -> rcpt -> data-collect
  let envelope = { from: null, to: [], timestamp: null };
  let dataLines = [];

  const reply = (line) => socket.write(line + "\r\n");
  reply("220 localhost Antlion test SMTP ready");

  socket.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    if (state === "data-collect") {
      // Accumulate raw DATA payload until <CRLF>.<CRLF>
      dataLines.push(text);
      const tail = dataLines.join("");
      const terminator = /\r\n\.\r\n$/.test(tail) || tail.endsWith("\r\n.\r\n");
      if (terminator || tail.trimEnd().endsWith(".")) {
        const raw = dataLines.join("");
        const body = raw.replace(/\r\n\.\r\n$/, "").replace(/(^|\r\n)\.\./g, "$1.");
        const record = {
          ...envelope,
          raw: body,
          timestamp: new Date().toISOString(),
        };
        fs.appendFileSync(OUT, JSON.stringify(record) + "\n");
        console.log(`[smtp] got mail from=${envelope.from} to=${envelope.to.join(",")} bytes=${body.length}`);
        dataLines = [];
        state = "ehlo";
        reply("250 OK — message accepted");
      }
      return;
    }

    for (const line of text.split("\r\n")) {
      const cmd = line.trim();
      if (!cmd) continue;
      const verb = cmd.split(/[\s:]/)[0].toUpperCase();
      switch (verb) {
        case "EHLO":
        case "HELO":
          state = "ehlo";
          envelope = { from: null, to: [] };
          reply("250-localhost greets you");
          reply("250-8BITMIME");
          reply("250-SIZE 10485760");
          reply("250 OK");
          break;
        case "MAIL":
          envelope.from = cmd.replace(/^MAIL FROM:\s*/i, "").replace(/[<>]/g, "") || null;
          state = "mail";
          reply("250 OK");
          break;
        case "RCPT":
          envelope.to.push(cmd.replace(/^RCPT TO:\s*/i, "").replace(/[<>]/g, ""));
          state = "rcpt";
          reply("250 OK");
          break;
        case "DATA":
          if (state !== "rcpt" && state !== "mail") {
            reply("503 Need MAIL before DATA");
            break;
          }
          state = "data-collect";
          dataLines = [];
          reply("354 End data with <CR><LF>.<CR><LF>");
          break;
        case "QUIT":
          reply("221 Bye");
          socket.end();
          break;
        case "RSET":
        case "NOOP":
          reply("250 OK");
          break;
        default:
          reply("502 Command not implemented");
      }
    }
  });

  socket.on("error", (e) => console.error(`[smtp] socket error: ${e.message}`));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[smtp] test server listening on 127.0.0.1:${PORT}, inbox: ${OUT}`);
});

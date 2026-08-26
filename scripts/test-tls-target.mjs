// Local HTTPS test target for TLS scanner verification.
// Deliberately weak config: TLS1.0 enabled, self-signed cert.
import https from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.argv[2] || 8443);
const dir = mkdtempSync(join(tmpdir(), "tls-target-"));

execFileSync("openssl", [
  "req", "-x509", "-newkey", "rsa:2048", "-nodes",
  "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
  "-subj", "/CN=localtest.me", "-days", "2",
]);

const srv = https.createServer(
  { key: join(dir, "key.pem") ? undefined : undefined, cert: undefined },
  () => {},
);
// Node needs the key material loaded; re-create with explicit options:
import { readFileSync } from "node:fs";
const srv2 = https.createServer(
  {
    key: readFileSync(join(dir, "key.pem")),
    cert: readFileSync(join(dir, "cert.pem")),
    // deliberately permissive legacy TLS (SECLEVEL=0 lets OpenSSL 3 accept TLS1.0)
    minVersion: "TLSv1",
    maxVersion: "TLSv1.2",
    ciphers: "DEFAULT@SECLEVEL=0",
  },
  (req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body>secure test</body></html>");
  },
);
srv.close();
srv2.listen(PORT, "::", () => console.log(`TLS test target on https://localtest.me:${PORT} (TLS1.0-1.2, self-signed)`));

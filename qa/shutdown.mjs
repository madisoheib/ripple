// Graceful-shutdown raw-wire test.
// Asserts on SIGTERM: (1) every client gets a proper close frame with code
// 1001 (not an abrupt 1006 TCP cut), (2) a message enqueued just before the
// signal is still delivered BEFORE the close (FIFO flush), (3) the process
// exits 0 within the drain timeout.
// Usage: node shutdown.mjs /path/to/resonance [conns]   (default 5)
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PusherServer from "pusher";
import WebSocket from "ws";

const BIN = process.argv[2] || "./target/release/resonance";
const CONNS = Number(process.argv[3] || process.env.CONNS || 5);
const APP = { id: "app1", key: "resonance-key", secret: "resonance-secret" };

const dir = mkdtempSync(join(tmpdir(), "res-shutdown-"));
const cfg = join(dir, "resonance.toml");
writeFileSync(cfg, `
[server]
host = "127.0.0.1"
port = 8099
shutdown_timeout_s = 20
[[apps]]
id = "${APP.id}"
key = "${APP.key}"
secret = "${APP.secret}"
`);

const server = new PusherServer({ appId: APP.id, key: APP.key, secret: APP.secret, host: "127.0.0.1", port: "8099", useTLS: false });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(BIN, ["start", "--config", cfg], { stdio: ["ignore", "pipe", "pipe"] });
let exitCode = null;
const procExit = new Promise((res) => proc.on("exit", (c) => { exitCode = c; res(c); }));
await wait(700);

console.log(`connecting ${CONNS} clients...`);
const clients = [];
for (let i = 0; i < CONNS; i += 500) {
  const batch = [];
  for (let j = i; j < Math.min(i + 500, CONNS); j++) {
    const ws = new WebSocket(`ws://127.0.0.1:8099/app/${APP.key}?protocol=7`);
    const c = { ws, established: false, gotEvent: false, closeCode: null, orderOk: null };
    ws.on("message", (buf) => {
      const f = JSON.parse(buf.toString());
      if (f.event === "pusher:connection_established") c.established = true;
      if (f.event === "pusher_internal:subscription_succeeded") c.subscribed = true;
      if (f.event === "flush-test") c.gotEvent = true;
    });
    ws.on("close", (code) => {
      c.closeCode = code;
      c.orderOk = c.gotEvent; // was the in-flight message delivered before close?
    });
    batch.push(c);
    clients.push(c);
  }
  await Promise.all(batch.map((c) => new Promise((res) => {
    const iv = setInterval(() => { if (c.established) { clearInterval(iv); res(); } }, 20);
    setTimeout(() => { clearInterval(iv); res(); }, 10000);
  })));
}
const up = clients.filter((c) => c.established).length;
console.log(`${up}/${CONNS} connected`);

// subscribe all to the flush channel
clients.forEach((c) => c.ws.send(JSON.stringify({ event: "pusher:subscribe", data: { channel: "flush" } })));
await wait(CONNS > 1000 ? 3000 : 500);

// enqueue one event, then SIGTERM immediately — it must arrive before the close
const t0 = Date.now();
await server.trigger("flush", "flush-test", { seq: 1 });
proc.kill("SIGTERM");

const code = await Promise.race([procExit, wait(25000).then(() => "timeout")]);
const shutdownMs = Date.now() - t0;
await wait(500); // let close events land

const closed1001 = clients.filter((c) => c.closeCode === 1001).length;
const abrupt = clients.filter((c) => c.closeCode === 1006).length;
const flushed = clients.filter((c) => c.orderOk).length;

console.log(`process exit: ${code} (${shutdownMs} ms after SIGTERM)`);
console.log(`close 1001: ${closed1001}/${up} | abrupt 1006: ${abrupt} | in-flight msg delivered before close: ${flushed}/${up}`);

const pass = code === 0 && closed1001 === up && abrupt === 0 && flushed === up && shutdownMs < 21000;
console.log(pass ? "SHUTDOWN TEST PASS" : "SHUTDOWN TEST FAIL");
process.exit(pass ? 0 : 1);

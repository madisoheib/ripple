// Proves the client companion (ripple-resume.js) actually recovers missed
// events across a reconnect, exercising its real code — seq tracking + resume
// emission — against a live server. pusher-js's node build uses a bundled
// WebSocket, so we drive the companion through the same public wrapper a
// browser uses: install it onto a target holding `ws`, open connections via
// the wrapped constructor, and simulate pusher-js's reconnect (a brand-new
// socket) to confirm module-scope seq state survives.
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PusherServer from "pusher";
import WebSocket from "ws";
import { installRippleResume } from "../ripple-laravel/resources/js/ripple-resume.js";

const APP = { id: "app1", key: "ripple-key", secret: "ripple-secret" };
const dir = mkdtempSync(join(tmpdir(), "res-companion-"));
const cfg = join(dir, "ripple.toml");
writeFileSync(cfg, `
[server]
host = "127.0.0.1"
port = 8097
[[apps]]
id = "${APP.id}"
key = "${APP.key}"
secret = "${APP.secret}"
history_size = 50
`);

const server = new PusherServer({ appId: APP.id, key: APP.key, secret: APP.secret, host: "127.0.0.1", port: "8097", useTLS: false });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Install the companion onto a browser-like target that exposes `ws`.
const target = { WebSocket };
installRippleResume(target);
const WrappedWS = target.WebSocket;

// A pusher-js-like connection: emits decoded events (seq stripped, like Echo)
// but the wrapped socket underneath handles seq/resume transparently.
function connect() {
  const ws = new WrappedWS(`ws://127.0.0.1:8097/app/${APP.key}?protocol=7`);
  const events = []; // decoded, seq-stripped — what an app handler sees
  ws.addEventListener("message", (evt) => {
    const m = JSON.parse(evt.data);
    if (m.event && !m.event.startsWith("pusher") && !m.event.startsWith("ripple:")) {
      events.push({ event: m.event, channel: m.channel, data: JSON.parse(m.data) });
    }
    ws.__ready = ws.__ready || m.event === "pusher:connection_established";
    if (m.event === "pusher_internal:subscription_succeeded") ws.__subbed = true;
  });
  return { ws, events };
}
const ready = (c) => new Promise((res) => { const i = setInterval(() => { if (c.ws.__ready) { clearInterval(i); res(); } }, 10); });
const subbed = (c) => new Promise((res) => { c.ws.__subbed = false; const i = setInterval(() => { if (c.ws.__subbed) { clearInterval(i); res(); } }, 10); });

const proc = spawn("../target/release/ripple", ["start", "--config", cfg], { stdio: "ignore" });
await wait(700);

let pass = true;
function check(cond, label) { console.log(`  ${cond ? "✓" : "✗"} ${label}`); if (!cond) pass = false; }

// 1. connect + subscribe, receive a live event (companion learns seq=1)
const c1 = connect();
await ready(c1);
c1.ws.send(JSON.stringify({ event: "pusher:subscribe", data: { channel: "room" } }));
await subbed(c1);
await server.trigger("room", "msg", JSON.stringify({ n: 1 }));
await wait(300);
check(c1.events.some((e) => e.event === "msg" && e.data.n === 1), "live event received before disconnect");

// 2. DISCONNECT (drop the socket) and publish while offline
c1.ws.close();
await wait(200);
await server.trigger("room", "msg", JSON.stringify({ n: 2 }));
await server.trigger("room", "msg", JSON.stringify({ n: 3 }));

// 3. RECONNECT — brand-new socket, like pusher-js. Companion must resume from
//    module-scope seq and replay 2 & 3 through the normal event path.
const c2 = connect();
await ready(c2);
c2.ws.send(JSON.stringify({ event: "pusher:subscribe", data: { channel: "room" } }));
await subbed(c2);
await wait(400);
check(c2.events.some((e) => e.event === "msg" && e.data.n === 2), "missed event #2 replayed after reconnect");
check(c2.events.some((e) => e.event === "msg" && e.data.n === 3), "missed event #3 replayed after reconnect");
check(!c2.events.some((e) => e.data.n === 1), "already-seen event #1 NOT re-delivered");

c2.ws.close();
proc.kill("SIGTERM");
console.log(pass ? "\nCOMPANION TEST PASS" : "\nCOMPANION TEST FAIL");
process.exit(pass ? 0 : 1);

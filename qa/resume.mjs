// Session-resume extension + per-app limits, raw-wire.
// Spawns a local server with history_size=5, max_messages_per_second=15,
// max_presence_members=2, then verifies:
//  1. broadcast frames carry a monotonically increasing `seq`
//  2. a reconnecting client replays exactly the missed events (FIFO order)
//  3. a gap beyond the ring buffer yields resonance:resume_failed
//  4. presence roster capped at 2 unique users (3rd gets 4100)
//  5. app publish quota: burst of 30 triggers -> some 429s
// Usage: node resume.mjs /path/to/resonance
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PusherServer from "pusher";
import WebSocket from "ws";

const BIN = process.argv[2] || "./target/release/resonance";
const APP = { id: "app1", key: "resonance-key", secret: "resonance-secret" };

const dir = mkdtempSync(join(tmpdir(), "res-resume-"));
const cfg = join(dir, "resonance.toml");
writeFileSync(cfg, `
[server]
host = "127.0.0.1"
port = 8098
[[apps]]
id = "${APP.id}"
key = "${APP.key}"
secret = "${APP.secret}"
history_size = 5
max_messages_per_second = 15
max_presence_members = 2
`);

const server = new PusherServer({ appId: APP.id, key: APP.key, secret: APP.secret, host: "127.0.0.1", port: "8098", useTLS: false });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function client() {
  const ws = new WebSocket(`ws://127.0.0.1:8098/app/${APP.key}?protocol=7`);
  const frames = [];
  const c = {
    ws, frames, socketId: null,
    send: (o) => ws.send(JSON.stringify(o)),
    waitFor: (pred, label, ms = 4000) => new Promise((res, rej) => {
      const hit = frames.find(pred);
      if (hit) return res(hit);
      const iv = setInterval(() => {
        const h = frames.find(pred);
        if (h) { clearInterval(iv); clearTimeout(t); res(h); }
      }, 15);
      const t = setTimeout(() => { clearInterval(iv); rej(new Error(`timeout: ${label}`)); }, ms);
    }),
  };
  ws.on("message", (buf) => {
    const f = JSON.parse(buf.toString());
    if (f.event === "pusher:connection_established") c.socketId = JSON.parse(f.data).socket_id;
    frames.push(f);
  });
  return new Promise((res) => ws.on("open", () => {
    const iv = setInterval(() => { if (c.socketId) { clearInterval(iv); res(c); } }, 10);
  }));
}

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(true); console.log(`  ✓ ${name}`); }
  catch (e) { results.push(false); console.log(`  ✗ ${name}: ${e.message}`); }
}

const proc = spawn(BIN, ["start", "--config", cfg], { stdio: "ignore" });
await wait(700);

await step("frames carry increasing seq", async () => {
  const a = await client();
  a.send({ event: "pusher:subscribe", data: { channel: "hist" } });
  await a.waitFor((f) => f.event === "pusher_internal:subscription_succeeded", "sub");
  await server.trigger("hist", "ev", JSON.stringify({ n: 1 }));
  await server.trigger("hist", "ev", JSON.stringify({ n: 2 }));
  const f1 = await a.waitFor((f) => f.event === "ev" && f.seq === 1, "seq1");
  const f2 = await a.waitFor((f) => f.event === "ev" && f.seq === 2, "seq2");
  if (!f1 || !f2) throw new Error("missing seq frames");
  a.ws.close();
  globalThis._lastSeq = 2;
});

await step("reconnect replays missed events in order", async () => {
  // channel currently at seq=2; publish 2 more while nobody listens
  await wait(200);
  await server.trigger("hist", "ev", JSON.stringify({ n: 3 }));
  await server.trigger("hist", "ev", JSON.stringify({ n: 4 }));
  const b = await client();
  b.send({ event: "pusher:subscribe", data: { channel: "hist" } });
  await b.waitFor((f) => f.event === "pusher_internal:subscription_succeeded", "resub");
  b.send({ event: "resonance:resume", data: { channel: "hist", last_seq: 2 } });
  const ok = await b.waitFor((f) => f.event === "resonance:resume_ok", "resume_ok");
  const d = JSON.parse(ok.data);
  if (d.replayed !== 2 || d.current_seq !== 4) throw new Error(`bad resume: ${ok.data}`);
  const r3 = b.frames.find((f) => f.event === "ev" && f.seq === 3);
  const r4 = b.frames.find((f) => f.event === "ev" && f.seq === 4);
  if (!r3 || !r4) throw new Error("replayed frames missing");
  if (b.frames.indexOf(r3) > b.frames.indexOf(r4)) throw new Error("out of order");
  b.ws.close();
});

await step("gap beyond ring buffer -> resume_failed", async () => {
  // ring size 5, seq is 4; push 6 more (seq 5..10) -> oldest kept is 6
  for (let i = 5; i <= 10; i++) await server.trigger("hist", "ev", JSON.stringify({ n: i }));
  const c = await client();
  c.send({ event: "pusher:subscribe", data: { channel: "hist" } });
  await c.waitFor((f) => f.event === "pusher_internal:subscription_succeeded", "sub");
  c.send({ event: "resonance:resume", data: { channel: "hist", last_seq: 2 } });
  const fail = await c.waitFor((f) => f.event === "resonance:resume_failed", "resume_failed");
  if (JSON.parse(fail.data).reason !== "history_gap") throw new Error(fail.data);
  c.ws.close();
});

await step("presence roster capped at 2 unique users", async () => {
  const members = [];
  for (const uid of ["u1", "u2", "u3"]) {
    const c = await client();
    const auth = server.authorizeChannel(c.socketId, "presence-cap", { user_id: uid });
    c.send({ event: "pusher:subscribe", data: { channel: "presence-cap", auth: auth.auth, channel_data: auth.channel_data } });
    members.push(c);
  }
  await members[0].waitFor((f) => f.event === "pusher_internal:subscription_succeeded", "m1");
  await members[1].waitFor((f) => f.event === "pusher_internal:subscription_succeeded", "m2");
  const err = await members[2].waitFor((f) => f.event === "pusher:error", "cap error");
  if (JSON.parse(err.data).code !== 4100) throw new Error(err.data);
  members.forEach((m) => m.ws.close());
});

await step("app publish quota: burst -> 429s", async () => {
  let rejected = 0;
  const jobs = [];
  for (let i = 0; i < 30; i++) {
    jobs.push(server.trigger("quota", "x", "{}").catch((e) => {
      if (String(e).includes("429")) rejected++;
    }));
  }
  await Promise.all(jobs);
  if (rejected === 0) throw new Error("no 429 in a 30-message burst against a 15/s quota");
});

proc.kill("SIGTERM");
const fails = results.filter((r) => !r).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);

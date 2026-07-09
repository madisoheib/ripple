// Raw-wire protocol/behaviour tests: things the happy-path lib test can't easily
// reach — sender exclusion, unsubscribe, slow-consumer kill, fan-out, errors.
// REST triggers still go through the real `pusher` lib (correct signing).
import PusherServer from "pusher";
import WebSocket from "ws";

const HOST = process.env.RESONANCE_HOST || "127.0.0.1";
const PORT = Number(process.env.RESONANCE_PORT || 8080);
const APP = { id: "app1", key: "resonance-key", secret: "resonance-secret" };

const server = new PusherServer({
  appId: APP.id, key: APP.key, secret: APP.secret,
  host: HOST, port: String(PORT), useTLS: false,
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const safeParse = (s) => { try { return JSON.parse(s); } catch { return s; } };

function client() {
  const ws = new WebSocket(`ws://${HOST}:${PORT}/app/${APP.key}?protocol=7&client=raw&version=1`);
  const frames = [];
  const waiters = [];
  let opened = false, openErr = null;
  const openWaiters = [];
  ws.on("open", () => { opened = true; openWaiters.forEach((w) => w.res()); });
  ws.on("error", (e) => { openErr = e; openWaiters.forEach((w) => w.rej(e)); });
  ws.on("message", (buf) => {
    const f = JSON.parse(buf.toString());
    f.parsed = f.data !== undefined ? safeParse(f.data) : undefined;
    frames.push(f);
    for (const w of [...waiters]) {
      if (w.pred(f)) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.t); w.resolve(f); }
    }
  });
  const api = {
    ws, frames,
    open: () => new Promise((res, rej) => {
      if (opened) return res();
      if (openErr) return rej(openErr);
      const t = setTimeout(() => rej(new Error("open timeout")), 3000);
      openWaiters.push({ res: () => { clearTimeout(t); res(); }, rej: (e) => { clearTimeout(t); rej(e); } });
    }),
    send: (o) => ws.send(JSON.stringify(o)),
    waitFor: (pred, label = "", ms = 3000) => new Promise((res, rej) => {
      const hit = frames.find(pred);
      if (hit) return res(hit);
      const t = setTimeout(() => {
        const i = waiters.findIndex((x) => x.t === t);
        if (i >= 0) waiters.splice(i, 1);
        rej(new Error(`timeout: ${label}`));
      }, ms);
      waiters.push({ pred, resolve: res, t });
    }),
    has: (pred) => frames.some(pred),
    close: () => ws.close(),
  };
  return api;
}

async function establish(c) {
  await c.open();
  const est = await c.waitFor((f) => f.event === "pusher:connection_established", "connection_established");
  return est;
}

const results = [];
async function step(name, fn) {
  try { await fn(); results.push([name, true]); console.log(`  ✓ ${name}`); }
  catch (e) { results.push([name, false]); console.log(`  ✗ ${name}: ${e.message}`); }
}

async function main() {
  await step("handshake: connection_established with string-encoded data", async () => {
    const c = client();
    const est = await establish(c);
    if (typeof est.data !== "string") throw new Error("data must be a JSON-encoded string (double-encoding)");
    if (!est.parsed.socket_id || !est.parsed.activity_timeout) throw new Error("missing socket_id/activity_timeout");
    c.close();
  });

  await step("pusher:ping -> pusher:pong", async () => {
    const c = client();
    await establish(c);
    c.send({ event: "pusher:ping" });
    await c.waitFor((f) => f.event === "pusher:pong", "pong");
    c.close();
  });

  await step("private subscribe with bad auth -> pusher:error 4009", async () => {
    const c = client();
    await establish(c);
    c.send({ event: "pusher:subscribe", data: { channel: "private-x", auth: "resonance-key:deadbeef" } });
    const err = await c.waitFor((f) => f.event === "pusher:error", "error");
    if (err.parsed.code !== 4009) throw new Error(`expected 4009, got ${err.parsed.code}`);
    if (c.has((f) => f.event === "pusher_internal:subscription_succeeded")) throw new Error("must not subscribe");
    c.close();
  });

  await step("sender exclusion: trigger with socket_id skips the sender", async () => {
    const a = client(); const b = client();
    const ea = await establish(a); await establish(b);
    for (const c of [a, b]) {
      c.send({ event: "pusher:subscribe", data: { channel: "excl" } });
      await c.waitFor((f) => f.event === "pusher_internal:subscription_succeeded" && f.channel === "excl", "sub");
    }
    await server.trigger("excl", "evt", { hi: 1 }, { socket_id: ea.parsed.socket_id });
    await b.waitFor((f) => f.event === "evt" && f.channel === "excl", "b receives");
    await wait(200);
    if (a.has((f) => f.event === "evt")) throw new Error("sender A should have been excluded");
    a.close(); b.close();
  });

  await step("unsubscribe stops delivery", async () => {
    const c = client();
    await establish(c);
    c.send({ event: "pusher:subscribe", data: { channel: "u" } });
    await c.waitFor((f) => f.event === "pusher_internal:subscription_succeeded" && f.channel === "u", "sub");
    c.send({ event: "pusher:unsubscribe", data: { channel: "u" } });
    await wait(100);
    await server.trigger("u", "evt", { x: 1 });
    await wait(400);
    if (c.has((f) => f.event === "evt")) throw new Error("received after unsubscribe");
    c.close();
  });

  await step("fan-out: 1 event -> 30 subscribers", async () => {
    const clients = Array.from({ length: 30 }, () => client());
    await Promise.all(clients.map(establish));
    await Promise.all(clients.map(async (c) => {
      c.send({ event: "pusher:subscribe", data: { channel: "fan" } });
      await c.waitFor((f) => f.event === "pusher_internal:subscription_succeeded" && f.channel === "fan", "sub");
    }));
    await server.trigger("fan", "boom", { seq: 7 });
    await Promise.all(clients.map((c) => c.waitFor((f) => f.event === "boom" && f.parsed.seq === 7, "recv", 4000)));
    clients.forEach((c) => c.close());
  });

  await step("slow-consumer kill: stalled reader is disconnected under flood", async () => {
    const c = client();
    await establish(c);
    c.send({ event: "pusher:subscribe", data: { channel: "flood" } });
    await c.waitFor((f) => f.event === "pusher_internal:subscription_succeeded" && f.channel === "flood", "sub");
    const closed = new Promise((res) => c.ws.on("close", () => res(true)));
    c.ws._socket.pause(); // stop draining TCP -> kernel buffers then mpsc fill up
    const big = "x".repeat(10000);
    // Enough volume (~15MB) to overflow loopback socket buffers so the server's
    // writer blocks, its bounded mpsc(64) fills, try_send fails -> kill.
    await Promise.allSettled(
      Array.from({ length: 1500 }, (_, i) => server.trigger("flood", "spam", { i, big }))
    );
    c.ws._socket.resume(); // now node can process the FIN and emit 'close'
    const killed = await Promise.race([closed, wait(4000).then(() => false)]);
    if (!killed) throw new Error("slow consumer was not disconnected");
  });

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });

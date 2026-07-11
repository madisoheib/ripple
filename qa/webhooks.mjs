// Webhook verification: local HTTP receiver + real client actions, asserts
// channel_occupied/vacated + member_added/removed arrive with a valid
// X-Pusher-Signature (HMAC-SHA256 of the raw body).
// Requires: server running with webhook_url=http://127.0.0.1:9999 (see run block below).
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import PusherServer from "pusher";
import WebSocket from "ws";

const APP = { id: "app1", key: "ripple-key", secret: "ripple-secret" };
const server = new PusherServer({ appId: APP.id, key: APP.key, secret: APP.secret, host: "127.0.0.1", port: "8080", useTLS: false });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const received = [];
const hook = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const sig = createHmac("sha256", APP.secret).update(body).digest("hex");
    const ok = req.headers["x-pusher-signature"] === sig && req.headers["x-pusher-key"] === APP.key;
    for (const ev of JSON.parse(body).events) received.push({ ...ev, sig_ok: ok });
    res.writeHead(200); res.end("{}");
  });
});
hook.listen(9999);

function rawClient() {
  const ws = new WebSocket(`ws://127.0.0.1:8080/app/${APP.key}?protocol=7`);
  return new Promise((resolve) => {
    let socketId;
    ws.on("message", (buf) => {
      const f = JSON.parse(buf.toString());
      if (f.event === "pusher:connection_established") { socketId = JSON.parse(f.data).socket_id; resolve({ ws, socketId }); }
    });
  });
}

const has = (name, extra = {}) =>
  received.some((e) => e.name === name && e.sig_ok && Object.entries(extra).every(([k, v]) => e[k] === v));

async function main() {
  // public channel occupied/vacated
  const a = await rawClient();
  a.ws.send(JSON.stringify({ event: "pusher:subscribe", data: { channel: "wh-test" } }));
  await wait(400);
  a.ws.send(JSON.stringify({ event: "pusher:unsubscribe", data: { channel: "wh-test" } }));
  await wait(400);

  // presence member_added/removed
  const b = await rawClient();
  const auth = server.authorizeChannel(b.socketId, "presence-wh", { user_id: "u1" });
  b.ws.send(JSON.stringify({ event: "pusher:subscribe", data: { channel: "presence-wh", auth: auth.auth, channel_data: auth.channel_data } }));
  await wait(400);
  b.ws.close(); // disconnect entirely -> member_removed + vacated
  await wait(600);

  const checks = [
    ["channel_occupied", { channel: "wh-test" }],
    ["channel_vacated", { channel: "wh-test" }],
    ["channel_occupied", { channel: "presence-wh" }],
    ["member_added", { channel: "presence-wh", user_id: "u1" }],
    ["member_removed", { channel: "presence-wh", user_id: "u1" }],
    ["channel_vacated", { channel: "presence-wh" }],
  ];
  let fails = 0;
  for (const [name, extra] of checks) {
    const ok = has(name, extra);
    console.log(`  ${ok ? "✓" : "✗"} ${name} ${JSON.stringify(extra)}`);
    if (!ok) fails++;
  }
  a.ws.close(); hook.close();
  console.log(`\n${checks.length - fails}/${checks.length} webhooks verified (all signatures checked)`);
  process.exit(fails ? 1 : 0);
}

main();

// Host-side subscriber: connects to resonance (mapped :8080) via real pusher-js,
// subscribes to the public channel the Laravel event broadcasts on, and exits 0
// when the event arrives. Resolves module deps from ../node_modules.
import PusherPkg from "pusher-js";
import WebSocket from "ws";

const Pusher = PusherPkg.Pusher || PusherPkg.default || PusherPkg;
globalThis.WebSocket = WebSocket;

const client = new Pusher("resonance-key", {
  wsHost: "127.0.0.1", wsPort: 8080, forceTLS: false,
  disableStats: true, enabledTransports: ["ws"], cluster: "mt1",
});

const timeout = setTimeout(() => { console.error("TIMEOUT waiting for event"); process.exit(1); }, 30000);

client.connection.bind("connected", () => console.log("subscriber connected", client.connection.socket_id));
const ch = client.subscribe("test-channel");
ch.bind("pusher:subscription_succeeded", () => console.log("READY"));
ch.bind("ping", (data) => {
  clearTimeout(timeout);
  console.log("RECEIVED ping:", JSON.stringify(data));
  if (data && data.msg === "hello-from-laravel") { console.log("PASS"); process.exit(0); }
  console.error("bad payload"); process.exit(1);
});

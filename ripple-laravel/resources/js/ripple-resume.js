// ripple-resume — client companion for the session-resume extension.
//
// pusher-js and Laravel Echo strip unknown frame fields during decode, so the
// per-channel `seq` never reaches your event handlers. This wraps the global
// WebSocket to (1) remember the highest seq seen per channel and (2) send
// `ripple:resume` right after each (re)subscription succeeds — replaying
// exactly the events missed during a disconnect. Transparent to Echo/pusher-js.
//
// Usage (before `new Echo(...)` / `new Pusher(...)`):
//   import { installRippleResume } from "./ripple-resume.js";
//   installRippleResume();
//
// Then use Echo normally. On reconnect, missed events are re-delivered through
// your existing channel bindings — no other code change.
export function installRippleResume(target = globalThis) {
  const Native = target.WebSocket;
  if (!Native || Native.__rippleWrapped) return; // idempotent

  // Module-scope, NOT per-socket: pusher-js opens a fresh WebSocket on every
  // reconnect, so per-instance state would reset exactly when resume is needed.
  // The server keeps seq monotonic per channel across the disconnect, so a
  // channel-keyed map is what survives.
  const lastSeq = Object.create(null); // channel -> highest seq seen

  function RippleWebSocket(url, protocols) {
    const ws = new Native(url, protocols);

    ws.addEventListener("message", (evt) => {
      let m;
      try { m = JSON.parse(evt.data); } catch { return; }

      // Track seq on every broadcast frame.
      if (m.channel && typeof m.seq === "number") {
        if (!(m.channel in lastSeq) || m.seq > lastSeq[m.channel]) {
          lastSeq[m.channel] = m.seq;
        }
      }

      // On a successful (re)subscribe, ask the server for anything we missed.
      if (m.event === "pusher_internal:subscription_succeeded" && m.channel) {
        const since = lastSeq[m.channel];
        if (since !== undefined && ws.readyState === Native.OPEN) {
          ws.send(JSON.stringify({
            event: "ripple:resume",
            data: { channel: m.channel, last_seq: since },
          }));
        }
      }
    });

    return ws;
  }

  RippleWebSocket.prototype = Native.prototype;
  RippleWebSocket.CONNECTING = Native.CONNECTING;
  RippleWebSocket.OPEN = Native.OPEN;
  RippleWebSocket.CLOSING = Native.CLOSING;
  RippleWebSocket.CLOSED = Native.CLOSED;
  RippleWebSocket.__rippleWrapped = true;

  target.WebSocket = RippleWebSocket;
}

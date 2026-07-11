# Session resume

Standard Pusher drops every message sent while a client is disconnected — a
mobile network blip or a deploy silently loses events. Resonance can replay
them. It's an **opt-in extension** that stays fully compatible with Pusher
clients (the extra `seq` field is ignored by clients that don't understand it).

## Enable it

Set `history_size` on the app in the server config:

```toml
[[apps]]
id = "app1"
key = "..."
secret = "..."
history_size = 100   # keep the last 100 events per channel for replay
```

## How it works

- Every broadcast frame on that app carries an extra top-level `seq` (a
  monotonically increasing per-channel counter).
- The server keeps the last `history_size` frames per channel in a ring buffer.
- After reconnecting, the client resubscribes (re-authenticating for
  private/presence channels — the signature is checked exactly as on first
  subscribe) and sends:

  ```json
  {"event":"resonance:resume","data":{"channel":"orders","last_seq":42}}
  ```

  The server replays every buffered event with `seq > 42`, in order, then
  sends `resonance:resume_ok` `{replayed, current_seq}`. If the gap is larger
  than the buffer it sends `resonance:resume_failed` `{reason:"history_gap"}`
  and the client should refetch state from your API.

**Security:** resume is refused (`4009`) unless the current connection is
already subscribed to the channel. Since the `socket_id` changes on
reconnect, this forces a fresh signed subscribe first — a client can never
read a private channel's history without authorization.

## Client companion (Laravel Echo / pusher-js)

pusher-js and Echo strip the `seq` field before your handlers see it, so a
small companion tracks it and emits the resume automatically. Copy
[`resonance-laravel/resources/js/resonance-resume.js`](../resonance-laravel/resources/js/resonance-resume.js)
into your app and install it **before** creating Echo:

```js
import { installResonanceResume } from "./resonance-resume.js";
import Echo from "laravel-echo";
import Pusher from "pusher-js";

installResonanceResume();           // wraps window.WebSocket

window.Pusher = Pusher;
window.Echo = new Echo({
    broadcaster: "pusher",
    key: import.meta.env.VITE_RESONANCE_KEY,
    wsHost: import.meta.env.VITE_RESONANCE_HOST,
    wsPort: import.meta.env.VITE_RESONANCE_PORT,
    forceTLS: false,
    enabledTransports: ["ws", "wss"],
});

// Nothing else changes — after a reconnect, missed events arrive through your
// normal listeners:
Echo.channel("orders").listen("OrderShipped", (e) => console.log(e));
```

The companion is ~40 lines, has no dependencies, and is idempotent. It stores
the highest `seq` per channel at module scope so the state survives the
brand-new WebSocket pusher-js opens on each reconnect.

## Memory budget (read before setting `history_size` high)

The buffer is bounded per app by:

```
history_size × (live channels) × (max message size)
```

`max_message_size_kb` defaults to 10 KB. So `history_size = 100` across 1,000
active channels is up to **~1 GB** for that app in the worst case (every slot
full of max-size messages). Size it against your real message sizes and
channel fan-out, or cap channels with `max_channels`. Typical chat/notification
payloads are a few hundred bytes, making the realistic figure far smaller —
but the ceiling is what you must provision for.

# Running behind a reverse proxy

Ripple serves WebSocket and the REST API on a single port, which keeps the
proxy config minimal. The only requirement is forwarding the WebSocket
upgrade headers.

## nginx

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name ws.example.com;

    ssl_certificate     /etc/letsencrypt/live/ws.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ws.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # WebSockets are long-lived: without this nginx cuts idle
        # connections after 60s. Set above ripple's activity_timeout.
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

## Caddy

Caddy upgrades WebSockets automatically — no special directives:

```caddyfile
ws.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

TLS is provisioned automatically via Let's Encrypt.

## Notes

- Alternatively skip the proxy entirely: ripple serves TLS natively —
  add a `[tls]` table with `cert`/`key` PEM paths to the config.
- Point clients at the proxy: `wsHost`/`wsPort` in Echo/pusher-js, and
  `RIPPLE_HOST`/`RIPPLE_PORT`/`RIPPLE_SCHEME=https` in Laravel.
- Deploys are seamless: on SIGTERM ripple stops accepting, sends every
  client a `1001 Going Away` close frame (after flushing in-flight
  messages) and drains within `shutdown_timeout_s` (default 30 s). Pusher
  clients reconnect automatically to the new instance.
- Raise `ulimit -n` (`LimitNOFILE=` under systemd) to at least 2× your
  target connection count; ripple warns at boot when the limit is low.

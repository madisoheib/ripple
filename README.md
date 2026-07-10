# Resonance

**Self-hosted, Pusher-compatible WebSocket server for the PHP ecosystem — a single static binary.**

[![CI](https://github.com/madisoheib/wrs-php/actions/workflows/ci.yml/badge.svg)](https://github.com/madisoheib/wrs-php/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/madisoheib/wrs-php)](https://github.com/madisoheib/wrs-php/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Resonance speaks the Pusher Channels protocol, so every existing client works
unchanged: **Laravel Echo**, **pusher-js**, **pusher-php-server**, mobile SDKs.
No Redis, no Node, no PHP extensions — download one binary and run it.

```bash
./resonance start --config resonance.toml
```

## Why

| | Pusher / Ably | Laravel Reverb | Soketi | **Resonance** |
|---|---|---|---|---|
| Self-hosted | ❌ SaaS | ✅ | ✅ | ✅ |
| Runtime needed | — | PHP (+ ext-ev beyond ~1k conns) | Node.js | **none** |
| Uses all CPU cores | — | ❌ single core | ❌ single core/worker | ✅ |
| Install | account | composer + ext tuning | npm | **one binary** |

Measured on the same host, same scenario, 1 000 connections
(scripts in [`qa/bench/`](qa/bench), reproduce before quoting):

| Metric | Resonance | Reverb (tuned¹) |
|---|---|---|
| Idle memory | **17 MiB** (~16 KB/conn) | 55 MiB (~22 KB/conn) |
| Fan-out latency p50 / p99 | **21 / 27 ms** | 39 / 45 ms |
| CPU @ 20k deliveries/s | **22 %** | 35 % |
| Sustained p50 | **8.5 ms** | 13.9 ms |
| Slow consumer | disconnected, memory bounded | unbounded buffering |
| Stock install beyond 1k conns | ✅ | ❌ dies (stream_select fd cap) |

¹ *Reverb required `ext-ev`, `memory_limit=-1` and connection-limit tuning to
complete the 5k test; Resonance ran stock. Numbers are relative to this
hardware — run the benchmark on yours.*

## Quick start

### 1. Get the binary

Download from [Releases](https://github.com/madisoheib/wrs-php/releases)
(Linux x86_64/ARM64 — fully static musl, macOS Intel/Apple Silicon, Windows),
or with Docker:

```bash
docker run -p 8080:8080 ghcr.io/madisoheib/wrs-php:latest
```

Or build from source: `cargo build --release`.

### 2. Configure

```toml
# resonance.toml
[server]
host = "0.0.0.0"
port = 8080

[[apps]]
id = "app1"
key = "my-key"
secret = "my-secret"

[limits]
max_message_size_kb = 10
activity_timeout_s = 120
max_channels_per_connection = 100
```

Every value can be overridden by environment (`RESONANCE_HOST`, `RESONANCE_PORT`).

### 3. Point your app at it

**Laravel** — use [`resonance/resonance-laravel`](https://github.com/madisoheib/resonance-laravel):

```bash
composer require resonance/resonance-laravel
php artisan resonance:install   # downloads the right binary for your OS/arch
php artisan resonance:start
```

**Any PHP** — `pusher-php-server` already speaks the protocol:

```php
$pusher = new Pusher\Pusher('my-key', 'my-secret', 'app1', [
    'host' => '127.0.0.1', 'port' => 8080, 'scheme' => 'http',
]);
$pusher->trigger('my-channel', 'my-event', ['hello' => 'world']);
```

**Browser** — Laravel Echo / pusher-js with `wsHost`/`wsPort` pointed at the server.

## Protocol support

- WebSocket handshake, `pusher:connection_established`, ping/pong, protocol error codes
- Public and private channels (HMAC auth, constant-time verification)
- REST `POST /apps/{app_id}/events` with the full Pusher auth scheme
  (`auth_signature`, `auth_timestamp` ±600 s anti-replay, mandatory `body_md5`)
- Sender exclusion via `socket_id`
- Slow-consumer protection: bounded per-connection buffers, non-blocking fan-out,
  laggards are disconnected instead of degrading everyone else
- Dead-connection eviction (server ping after `activity_timeout`, 30 s grace)

Presence channels, client events and webhooks are on the [roadmap](project.md).

## Deployment

Run behind any reverse proxy — one port serves both WebSocket and the REST API:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

Raise `ulimit -n` to at least 2× your target connection count.

## Development

```bash
cargo test                                   # protocol + signature unit tests
cd qa && npm install
node e2e.mjs                                 # end-to-end with real pusher-js/pusher libs
node protocol.mjs                            # raw-wire protocol behaviours
qa/laravel/run.sh                            # real Laravel app broadcast in Docker
qa/bench/run.sh                              # benchmark vs Reverb, same harness
```

Full technical specification: [`project.md`](project.md) (French).

## License

[MIT](LICENSE)

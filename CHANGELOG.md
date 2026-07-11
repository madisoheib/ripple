# Changelog

All notable changes to Ripple are documented here. The project follows
[Semantic Versioning](https://semver.org). Dates are UTC.

> Ripple was developed under the working name **resonance**; the `v0.1.0`–`v0.6.0`
> release binaries and the pre-rename Laravel package (`resonance/resonance-laravel`)
> use the old name. From the first post-rename release, everything is `ripple`.

## Unreleased

### Changed
- **Renamed the project to Ripple** (crate/binary `ripple`, env `RIPPLE_*`,
  artisan `ripple:*`, Prometheus `ripple_*`, protocol extension `ripple:resume`,
  PHP namespace `Ripple\Laravel`, package `ripple/ripple-laravel`). The old
  `resonance` name collided with existing PHP realtime projects.

### Added
- `SECURITY.md` disclosure policy and `CHANGELOG.md`.

## v0.6.0

### Added
- **Session resume** (opt-in, Pusher-compatible): per-channel `seq` + ring
  buffer (`history_size`), authorization-safe replay after reconnect, and a
  ~40-line Echo/pusher-js companion. `docs/session-resume.md`.
- **Per-app multi-tenant limits**: `max_messages_per_second` (REST → 429 with
  `Retry-After`), `max_channels`, `max_presence_members`.

## v0.5.0

### Added
- **Graceful shutdown**: SIGTERM/SIGINT stops accepting, flushes in-flight
  messages, sends `1001 Going Away` to every client, drains within
  `shutdown_timeout_s` (default 30 s). Verified at 10k active connections.
- Boot warning when `ulimit -n` would cap the connection target.
- `docs/reverse-proxy.md` (nginx + Caddy), server-side fan-out distribution
  metric, published Linux benchmark (`bench/RESULTS.md`).

### Fixed
- Accept backlog raised from the std default of 128 to 8192 (SYN drops under
  reconnect storms).

## v0.4.0

### Added
- Native TLS via rustls/ring (`[tls]` config), musl-static-safe.
- Prometheus `GET /metrics`.
- Adversarial robustness test corpus over the parsing/auth paths.

## v0.3.0

### Added
- Webhooks (`channel_occupied`/`vacated`, `member_added`/`removed`), signed
  `X-Pusher-Key` + `X-Pusher-Signature`.
- REST `batch_events` and channel-inspection endpoints (`channels`,
  `channels/{name}`, `channels/{name}/users`).
- Browser Origin allow-list (`allowed_origins`).

## v0.2.0

### Added
- Presence channels (roster, `member_added`/`member_removed`).
- Client events (`client-*` / whisper): private/presence only, rate-limited.
- Per-connection memory cut to ~16 KB (tuned tungstenite read buffer).

## v0.1.0

### Added
- First release: Pusher-compatible core (public/private channels, handshake,
  ping/pong, protocol errors), signed REST `events`, single-instance in-memory
  state, TOML config, zero-alloc fan-out with slow-consumer kill, TCP_NODELAY.
- Laravel package (broadcast driver + `install`/`start` commands), Laravel
  6–13 compatibility.
- Cross-compiled releases (Linux x86_64/ARM64 musl, macOS ×2, Windows) +
  `FROM scratch` Docker image.

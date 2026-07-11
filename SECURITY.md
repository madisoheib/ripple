# Security Policy

## Supported versions

Ripple is pre-1.0; only the latest release receives security fixes. Once 1.0
ships, the latest minor line will be supported.

| Version | Supported |
|---------|-----------|
| latest release | ✅ |
| older | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately to **contact@souheibmadi.com** — or, preferably, via GitHub's
["Report a vulnerability"](https://github.com/madisoheib/ripple/security/advisories/new)
(Security → Advisories), which keeps the discussion private until a fix ships.

Include: affected version, a description, and ideally a minimal reproduction.
We aim to acknowledge within 72 hours and to ship a fix or mitigation before
any public disclosure. Coordinated disclosure is appreciated; credit is given
to reporters who want it.

## Scope

In scope — the server and the Laravel package:
- Authentication/authorization bypass (private/presence channel auth, the
  session-resume authorization check, REST HMAC verification)
- Cross-tenant data leakage on a multi-app server
- Remote crashes / denial of service (frame parsing, resource exhaustion)
- Signature or replay weaknesses in the REST or webhook signing

Out of scope:
- Attacks requiring the app `secret` (it is a trusted server-side credential)
- Running behind a misconfigured reverse proxy (see `docs/reverse-proxy.md`)
- Missing OS-level hardening (ulimit, firewall) the operator controls
- Volumetric DDoS against the host

## Security properties (by design)

- HMAC comparisons are constant-time (`subtle`).
- REST requests are replay-bounded (`auth_timestamp` ±600 s) and the body is
  authenticated (`body_md5` required).
- Session resume is refused unless the current, freshly-authenticated
  connection is already subscribed to the channel — history cannot be read
  without authorization.
- No `unsafe` in application code; the frame parser is exercised by an
  adversarial fuzz-style test corpus in CI.

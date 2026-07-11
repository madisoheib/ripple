# Static musl build -> scratch (spec §7.1). Alpine's default target is musl and
# Rust links it statically, so the binary runs on `scratch` with no .so files.
FROM rust:alpine AS build
RUN apk add --no-cache musl-dev
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM scratch
COPY --from=build /src/target/release/ripple /ripple
# Default config (change creds via a mounted /ripple.toml or RIPPLE_* env).
COPY ripple.toml.example /ripple.toml
EXPOSE 8080
ENTRYPOINT ["/ripple", "start", "--config", "/ripple.toml"]

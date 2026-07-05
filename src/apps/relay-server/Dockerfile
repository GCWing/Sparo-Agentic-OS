# Sparo OS Relay Server — standalone Docker build.
# Build context is relay-server root (Cargo.toml + src/), no workspace needed.
FROM rust:1.85-slim AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml ./
RUN mkdir -p src && echo 'fn main() { println!("placeholder"); }' > src/main.rs
RUN cargo build --release 2>/dev/null || true

RUN rm -rf src target/release/sparo-relay-server target/release/deps/sparo*

COPY src/ src/

RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /build/target/release/sparo-relay-server /app/sparo-relay-server
RUN mkdir -p /app/static

ENV RELAY_PORT=9700
ENV RELAY_STATIC_DIR=/app/static
EXPOSE 9700

CMD ["/app/sparo-relay-server"]

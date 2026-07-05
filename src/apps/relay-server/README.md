# Sparo OS Relay Server

WebSocket relay server for Sparo OS Remote Connect. Bridges desktop (WebSocket) and mobile (HTTP) clients with E2E encryption support.

## Features

- Desktop connects via WebSocket, mobile via HTTP — relay bridges between them
- End-to-end encrypted message passthrough (server cannot decrypt)
- Correlation-based HTTP-to-WebSocket request-response matching
- Per-room mobile-web static file upload & serving (content-addressable, incremental)
- Heartbeat-based connection management with configurable room TTL
- Docker deployment ready with Caddy reverse proxy

## Quick Start

### Docker (Recommended)

```bash
# SSH into your target server first, then clone the repo:
git clone https://github.com/GCWing/Sparo-Agentic-OS
cd Sparo-Agentic-OS/src/apps/relay-server

# SSH into your target server first, then run:
bash deploy.sh
```

`deploy.sh` must be run on the target server itself. It only deploys to the current machine and does not SSH to a remote host.

After deployment, you can manage the service with:

```bash
bash start.sh
bash stop.sh
bash restart.sh
```

### What URL should I fill in Sparo OS Desktop?

In **Remote Connect → Self-Hosted → Server URL**, use one of:

- Direct relay port: `http://<YOUR_SERVER_IP>:9700`

`/relay` is **not mandatory**. It is only needed when your reverse proxy is configured with that path prefix.

### Manual

```bash
# From project root
cargo build --release -p sparo-relay-server

# Run
RELAY_PORT=9700 ./target/release/sparo-relay-server
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAY_PORT` | `9700` | Server listen port |
| `RELAY_STATIC_DIR` | `./static` | Path to mobile web static files (fallback SPA) |
| `RELAY_ROOM_WEB_DIR` | `/tmp/sparo-os-room-web` | Directory for per-room uploaded mobile-web files |
| `RELAY_ROOM_TTL` | `3600` | Room TTL in seconds (0 = no expiry) |

## API Endpoints

### Health & Info

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check (returns status, version, uptime, room/connection counts) |
| `/api/info` | GET | Server info (name, version, protocol_version) |

### Room Operations (Mobile HTTP → Desktop WS bridge)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rooms/:room_id/pair` | POST | Mobile initiates pairing — relay forwards to desktop via WS, waits for response |
| `/api/rooms/:room_id/command` | POST | Mobile sends encrypted command — relay forwards to desktop, returns response |

### Per-Room Mobile-Web File Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rooms/:room_id/upload-web` | POST | Full upload: base64-encoded files keyed by path (10MB body limit) |
| `/api/rooms/:room_id/check-web-files` | POST | Incremental: check which files the server already has by hash |
| `/api/rooms/:room_id/upload-web-files` | POST | Incremental: upload only the missing files (10MB body limit) |
| `/r/:room_id/*path` | GET | Serve uploaded mobile-web static files for a room |

### WebSocket

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ws` | WebSocket | Desktop client connection endpoint |

## WebSocket Protocol (Desktop Only)

Only desktop clients connect via WebSocket. Mobile clients use the HTTP endpoints above.

### Desktop → Server (Inbound)

```json
// Create a room
{ "type": "create_room", "room_id": "optional-id", "device_id": "...", "device_type": "desktop", "public_key": "base64..." }

// Respond to a bridged HTTP request (pair or command)
{ "type": "relay_response", "correlation_id": "...", "encrypted_data": "base64...", "nonce": "base64..." }

// Heartbeat
{ "type": "heartbeat" }
```

### Server → Desktop (Outbound)

```json
// Room created confirmation
{ "type": "room_created", "room_id": "..." }

// Pair request forwarded from mobile HTTP
{ "type": "pair_request", "correlation_id": "...", "public_key": "base64...", "device_id": "...", "device_name": "..." }

// Encrypted command forwarded from mobile HTTP
{ "type": "command", "correlation_id": "...", "encrypted_data": "base64...", "nonce": "base64..." }

// Heartbeat acknowledgment
{ "type": "heartbeat_ack" }

// Error
{ "type": "error", "message": "..." }
```

## Self-Hosted Deployment

### Option A: Deploy on the Server Itself

If you have the repo cloned **on the server**:

```bash
git clone https://github.com/GCWing/Sparo-Agentic-OS
cd Sparo-Agentic-OS/src/apps/relay-server/
bash deploy.sh
```

Or, if the repo is already present on the server:

```bash
cd src/apps/relay-server/
bash deploy.sh
```

This script must be executed in an SSH session on the target server. It builds the Docker image on that server and starts the container there. It will **automatically stop any previously running relay container** before restarting.

### Service Operations

Run these commands on the target server inside `src/apps/relay-server/`:

```bash
# Start the service only when it is not already running
bash start.sh

# Stop the running service
bash stop.sh

# Restart the service, or start it if it is currently stopped
bash restart.sh

# View current status
docker compose ps

# View logs
docker compose logs -f relay-server
```

Behavior notes:

- `start.sh` is idempotent. If the relay service is already running, it exits without starting it again.
- `stop.sh` exits cleanly when the service is already stopped.
- `restart.sh` restarts the service when it is running, and starts it when it is stopped.
- The container uses `restart: unless-stopped`, so it will automatically come back after a server reboot as long as the Docker service itself is enabled and running.

### Option B: Remote Deploy (from your dev machine)

Push code changes from your local dev machine to a remote server via SSH:

```bash
cd src/apps/relay-server/

# First-time setup (creates /opt/sparo-os-relay, copies static/)
bash remote-deploy.sh 116.204.120.240 --first

# Subsequent updates (syncs src + rebuilds)
bash remote-deploy.sh 116.204.120.240
```

The script will:
1. Test SSH connectivity
2. **Stop the old container** if running
3. Sync source code (`src/`), `Cargo.toml`, `Dockerfile`, `docker-compose.yml`
4. Rebuild the Docker image on the server
5. Start the new container
6. Run a health check

**Prerequisites:**
- SSH key-based auth to the server (configured in `~/.ssh/config`)
- Docker + Docker Compose installed on the server

### Deployment Checklist

1. Open required ports:
   - `9700` (relay direct access, optional if only via reverse proxy)
   - `80/443` (for Caddy reverse proxy)
2. Verify health endpoint:
   - `http://<server-ip>:9700/health`
3. Configure your final URL strategy:
   - root domain (`https://relay.example.com`)
4. Fill the same URL into Sparo OS Desktop "Custom Server"

### Directory Structure

```
relay-server/
├── src/                    # Rust source code
├── static/                 # Mobile-web static files
├── Cargo.toml              # Crate manifest (standalone, no workspace deps)
├── Dockerfile              # Docker build (standalone single-crate build)
├── docker-compose.yml      # Docker Compose config
├── Caddyfile               # Caddy reverse proxy config (optional)
├── deploy.sh               # Deploy current machine (run on the target server itself)
├── start.sh                # Start service if not already running
├── stop.sh                 # Stop running service
├── restart.sh              # Restart service, or start if stopped
├── remote-deploy.sh        # Remote deploy (run from dev machine via SSH)
└── README.md
```

Relay server is a **standalone crate** — one set of code, one Dockerfile, one docker-compose.yml.
Whether deployed as a public relay, LAN relay, or NAT traversal relay, the build and runtime are identical.

### Relay Server Scope

- Remote Connect self-hosted deployment uses **`src/apps/relay-server`**.
- Sparo OS no longer ships a separate general-purpose server application; Remote Connect relay is the only server-side crate in the workspace.

## Architecture

```
Mobile Phone ──HTTP POST──► Relay Server ◄──WebSocket── Desktop Client
                               │
                          E2E Encrypted
                          (server cannot
                           read messages)
```

The relay server bridges HTTP and WebSocket:

- **Desktop** connects via WebSocket, creates a room, and stays connected.
- **Mobile** sends HTTP POST requests (`/pair`, `/command`). The relay forwards them to the desktop over WS using correlation IDs, waits for the WS response, and returns it to mobile via HTTP.
- The relay only manages rooms and forwards opaque encrypted payloads. All encryption/decryption happens on the client side.
- Per-room mobile-web static files can be uploaded via the incremental upload API and served at `/r/:room_id/`.

---
name: convert-to-Status
description: Switch from WhatsApp to Status messenger for end-to-end encrypted decentralized messaging. Use when the user wants to use Status instead of WhatsApp as NanoClaw's messaging channel. Triggers on "status", "convert to status", "switch to status", "use status messenger".
---

# Convert to Status

Switch NanoClaw's messaging channel from WhatsApp to Status messenger (end-to-end encrypted, decentralized, Waku-based).

**What this changes:**
- Channel implementation: `src/channels/whatsapp.ts` -> `src/channels/status.ts`
- API layer: Baileys -> status-backend HTTP/RPC + WebSocket signals in `src/status-api.ts`
- Authentication: QR scanning -> Status `keyUID` + password login
- Message transport: WhatsApp servers -> Waku peer-to-peer network
- Access control: phone numbers -> public key allow-list via `STATUS_ALLOW_FROM`
- Addressing format: `phone@s.whatsapp.net` -> `0x04...` public keys (DM) or composite group IDs

**What stays the same:**
- Container runner
- IPC flow
- Task scheduler
- Router
- Group registration flow
- Trigger system behavior (works with both channels)
- Database schema

## Prerequisites

1. **status-backend binary**: Run locally as the bridge to Status protocol.
2. **Waku node (nwaku)**: Run for peer-to-peer messaging.
3. **Status account**: Prepare `keyUID` and password (create via `createAccount()` in `src/status-api.ts` or Status desktop app).
4. **Node.js 20+** and npm.

## Phase 1: Pre-flight

### Check if already applied

Inspect `.nanoclaw/state.yaml`. If `convert-to-Status` already exists in `applied_skills`, skip to Phase 5 (Verify).

### Check current channel wiring

Inspect `src/index.ts` for channel construction:
- If using `new WhatsAppChannel(...)`, continue with migration.
- If using `new StatusChannel(...)`, code migration is already applied; continue to Phase 5.

## Phase 2: Install Status Backend Infrastructure

### 2a: Set up nwaku (Waku node)

Install the `nwaku` binary (package or source build) and run it:

```bash
nwaku --rest=true --rest-port=8645
```

nwaku must be running before status-backend can connect to the Waku network. How you keep it running (systemd, supervisor, tmux, etc.) is up to you.

### 2b: Set up status-backend

Install the `status-backend` binary and run it:

```bash
status-backend --address 127.0.0.1 --port 21405
```

Verify health:

```bash
curl http://127.0.0.1:21405/health
```

### 2c: Create or import Status account

Bootstrap login with `scripts/status-login.sh`, or create an account via API (`createAccount()` in `src/status-api.ts`).

Set credentials in `.env`:

```bash
STATUS_PORT=21405
STATUS_KEY_UID=<your-key-uid>
STATUS_PASSWORD=<your-password>
STATUS_DATA_DIR=$HOME/.status-backend/data
STATUS_PROFILE_NAME=<profile-name>
STATUS_ALLOW_FROM=0x04<your-admin-public-key>
```

### 2d: Bootstrap login

After status-backend is healthy, run the login script to initialize the application and start the Waku messenger:

```bash
./scripts/status-login.sh
```

This script retries `startMessenger` up to 30 times since Waku peer discovery can take 30-60 seconds.

## Phase 3: Apply Code Changes

Apply this skill package through NanoClaw's skills engine:

```bash
npx tsx scripts/apply-skill.ts .claude/skills/convert-to-Status
```

This migration adds:
- `src/channels/status.ts` - Status channel (polling + WebSocket signals)
- `src/status-api.ts` - status-backend HTTP/RPC wrapper
- `src/channels/status.test.ts` - Status channel tests
- `src/status-api.test.ts` - Status API tests
- `src/trigger.ts` - Trigger matching enhancements (`|` and `,` separators)
- `src/trigger.test.ts` - Trigger tests
- `scripts/status-login.sh` - Login bootstrap script
- `scripts/restart-status-nanoclaw.sh` - Restart helper for Status stack

This migration modifies:
- `src/index.ts` - Replace `WhatsAppChannel` usage with `StatusChannel`
- `src/config.ts` - Add `STATUS_PORT`, `STATUS_KEY_UID`, `STATUS_PASSWORD`, `STATUS_DATA_DIR`, `STATUS_PROFILE_NAME`, `STATUS_ALLOW_FROM`
- `package.json` - Add `ws` dependency for WebSocket signaling

## Phase 4: Configure Access Control

Use `STATUS_ALLOW_FROM` to restrict who can message the bot:
- When set: allow DMs only from listed admin keys; allow groups only when an admin member is present.
- When empty: permissive mode (allow all senders/groups).

Status JID handling:
- DMs use sender public keys (`0x04...`).
- Group chats use composite IDs (for example `uuid-...-0x04<pubkey>`).
- `ownsJid()` must correctly evaluate both DM and composite group formats.

## Phase 5: Verify

1. Health check:
   ```bash
   curl http://127.0.0.1:21405/health
   ```
2. Build:
   ```bash
   npm run build
   ```
3. Tests:
   ```bash
   npm test
   ```
4. Start NanoClaw:
   ```bash
   # Example with a service manager
   <your-service-manager> start nanoclaw
   # Example for local development
   npm run dev
   ```
5. Send a DM from your Status account to the bot public key and verify reply.
6. Create a Status group, add the bot, register via IPC, and send a trigger message.

## Troubleshooting

**Waku not booting**
- `nwaku` can need 30-60 seconds for peer discovery bootstrap.
- NanoClaw retries `startMessenger` up to 30 times (~2.5 minutes).
- If still failing, inspect nwaku logs using your process manager. Example (systemd):
  ```bash
  journalctl -u nwaku -f
  ```

**status-backend health check fails**
- Ensure port `21405` is available.
- Inspect status-backend logs using your process manager. Example (systemd):
  ```bash
  journalctl -u status-backend -f
  ```

**Group chat messages not routing**
- Confirm `ownsJid()` supports composite group IDs.
- Confirm the group was registered through `register_group` IPC.

**Bot replies not appearing in groups**
- `sendGroupChatMessage` may fallback to `sendChatMessage` on older backends.
- Check runtime warnings/logs for fallback behavior.

**Login fails after restart**
- Ensure login bootstrap (`scripts/status-login.sh`) runs only after `status-backend` is healthy.
- If using a service manager, verify dependency ordering and retry behavior.

## Summary of Changed Files

| File | Type of Change |
|------|----------------|
| `src/channels/status.ts` | Added |
| `src/status-api.ts` | Added |
| `src/channels/status.test.ts` | Added |
| `src/status-api.test.ts` | Added |
| `src/trigger.ts` | Added/updated for multi-trigger separators |
| `src/trigger.test.ts` | Added |
| `scripts/status-login.sh` | Added |
| `scripts/restart-status-nanoclaw.sh` | Added |
| `src/index.ts` | Modified (`WhatsAppChannel` -> `StatusChannel`) |
| `src/config.ts` | Modified (Status env config) |
| `package.json` | Modified (`ws` dependency) |

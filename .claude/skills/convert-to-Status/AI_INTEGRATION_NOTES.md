# AI Integration Notes: Status Messenger in NanoClaw

This document captures hard problems encountered during the real-world integration of Status messenger into NanoClaw, written as AI-authored notes for future developers and AI agents working on Status integration.

## Note 1: Waku Bootstrap Failures
**Problem**: When status-backend starts, it needs to connect to the Waku peer-to-peer network via nwaku. The Waku messenger (`wakuext_startMessenger` RPC call) frequently fails to start on first attempt.

**Symptoms**:
- `startMessenger` RPC returns errors or hangs
- status-backend health check passes but messenger operations fail
- Messages cannot be sent or received even though the backend is "healthy"

**Root Cause**: Waku peer discovery takes time (30-60 seconds). The nwaku node needs to bootstrap its peer table before the messenger layer can function. Starting the messenger too early results in a degraded state where the node appears healthy but cannot route messages.

**Solution implemented**:
- NanoClaw retries `startMessenger` up to 30 times with 5-second intervals (2.5 minutes total)
- The retry loop is in `StatusChannel.connect()` lines 89-101
- The `status-login.sh` script also retries messenger start up to 30 times
- Login/messenger bootstrap is run only after status-backend is healthy (for example via a service manager hook)
- Key lesson: Always treat `startMessenger` as eventually-consistent, never assume it succeeds on first call

**Additional context**: Some status-go builds auto-start the messenger and don't expose `wakuext_startMessenger` at all (returns `-32601 method not found`). The login script handles this by treating that error as success.

## Note 2: Group Chat JID Ownership and Routing Failures
**Problem**: After initial integration, the bot could receive and respond to DMs but group chat replies silently failed. Messages were received from groups but the router could not find a channel to send replies back.

**Symptoms**:
- Bot receives group messages (visible in logs)
- `onChatMetadata` fires correctly for group chats
- Group is registered via `register_group` IPC
- But replies never appear in the group
- Log shows: `No channel owns JID, skipping messages`

**Root Cause**: Status group chat JIDs are composite identifiers, not simple public keys. A typical group JID looks like:
`<group-uuid>-0x04<group-public-key>`

The original `ownsJid()` method only matched JIDs starting with `0x04` or `0x00` (DM-style public keys). Group JIDs start with a UUID prefix, so `ownsJid()` returned false, and the router couldn't find any channel that owns the JID.

**Solution implemented**:
- Updated `ownsJid()` to also check the trailing segment after the last `-` separator
- If the trailing segment is a valid Status public key (`0x04...` or `0x00...`), the JID is owned by the Status channel
- See `src/channels/status.ts` lines 158-163
- Added test cases for composite group JIDs in `src/channels/status.test.ts`

**Key lesson**: Never assume JID formats are uniform across DMs and groups. Status uses completely different ID schemas for 1:1 vs group chats. Always test both paths.

## Note 3: Group Registration Flow — Don't Auto-Register
**Problem**: Early attempts tried to auto-register groups when the channel discovered them via chat metadata. This caused phantom groups that the admin never intended to activate, and broke the explicit registration model.

**Solution**: Keep the explicit `register_group` IPC flow:
1. Channel emits metadata only (via `onChatMetadata`)
2. Host stores metadata in `chats` table
3. Group activation is explicit — admin sends `register_group` IPC command
4. Only registered groups get message processing

This matches WhatsApp's flow exactly and keeps the admin in control.

## Note 4: Group Message Sending — RPC Method Variations
**Problem**: Different versions of status-go expose different RPC methods for sending group messages. Some have `wakuext_sendGroupChatMessage`, others only have `wakuext_sendChatMessage`.

**Solution**: `sendGroupChatMessage()` in `status-api.ts` tries the canonical method first, then falls back to `sendChatMessage` with a different payload shape. This makes NanoClaw compatible with multiple status-backend versions.

## Note 5: Double-Encoded JSON Responses
**Problem**: Some status-backend RPC responses are double-encoded — the JSON response body is itself a JSON string that needs to be parsed twice.

**Solution**: `parseRPCResponse()` in `status-api.ts` detects when the outer parse returns a string and parses again. This handles both single and double-encoded responses transparently.

## General Architecture Notes for Future AI Agents
- Status uses public keys as identity, not phone numbers
- The `STATUS_ALLOW_FROM` config acts as an access control list using public keys
- WebSocket signals at `ws://127.0.0.1:<port>/signals` provide real-time notifications but are supplementary — polling is the primary message discovery mechanism
- The `contentType` field in messages filters non-text content (contentType !== 1)
- Bot's own messages are filtered by both public key match AND assistant name prefix match

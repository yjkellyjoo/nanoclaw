# Status Conversion Notes

Date: 2026-02-28

## Session Summary

1. Status chat discovery worked.
2. Group registration worked once `register_group` IPC was used.
3. Replies still failed for Status group chats due to channel routing mismatch.

## Root Cause

1. `StatusChannel.ownsJid()` originally only matched JIDs that start with `0x04` or `0x00` (DM-style IDs).
2. Status group JIDs can be composite IDs like `group-uuid-...-0x04<pubkey>`.
3. Router could not find a channel for those group JIDs, so message processing was skipped.

## Fix Applied

1. Updated `src/channels/status.ts` `ownsJid()` to accept:
   - direct Status public keys (`0x04...`, `0x00...`)
   - composite IDs with trailing key segment (`...-0x04...`, `...-0x00...`)
2. Added tests in `src/channels/status.test.ts` for composite group JID ownership.

## Important Architectural Decision (Keep This)

1. Keep registration flow aligned with core NanoClaw behavior:
   - channel emits metadata only
   - host stores metadata in `chats`
   - group activation is explicit via admin/main `register_group` IPC into `registered_groups`
2. Do not auto-register groups from channel metadata callbacks.

## Status Access Filter Behavior

When `STATUS_ALLOW_FROM` is set:

1. DMs are allowed only if initiated by admin key.
2. Group chats are allowed only if admin key is in group members.

When `STATUS_ALLOW_FROM` is empty:

1. Status filter is permissive (allow all).

## Future Skill: `convert-to-Status` Checklist

1. Preserve explicit registration (`register_group`) flow.
2. Ensure Status group JID ownership rules include composite IDs.
3. Preserve admin-only access controls for DM and group contexts.
4. Add migration tests for:
   - DM routing
   - group routing
   - `register_group` persistence
   - trigger behavior (`requires_trigger`)
5. Include post-change smoke steps:
   - register a Status group via IPC
   - send trigger message in group
   - confirm container run and outbound reply

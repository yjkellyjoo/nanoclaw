# Intent: Modify `src/config.ts`

Add Status backend configuration support in environment loading and exports.

- Add `readEnvFile` entries for:
  - `STATUS_PORT`
  - `STATUS_KEY_UID`
  - `STATUS_PASSWORD`
  - `STATUS_DATA_DIR`
  - `STATUS_PROFILE_NAME`
  - `STATUS_ALLOW_FROM`
- Export each Status config variable with appropriate defaults.
- Set `STATUS_PORT` default to `21405`.
- Set `STATUS_DATA_DIR` default to `~/.status-backend/data`.
- Parse `STATUS_ALLOW_FROM` as a comma-separated list into `string[]`.
- Preserve invariant that existing WhatsApp config can either be removed or left in place without conflicting behavior.

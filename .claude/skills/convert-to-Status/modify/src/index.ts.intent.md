# Intent: Modify `src/index.ts`

Switch the primary messaging channel implementation from WhatsApp to Status.

- Remove the WhatsApp channel import and add the Status channel import.
- Replace `new WhatsAppChannel(channelOpts)` with `new StatusChannel(channelOpts)`.
- Remove WhatsApp-specific connection/auth lifecycle handling (for example QR code flow and persisted auth state hooks).
- Keep the rest of the runtime behavior unchanged because `StatusChannel` conforms to the same `Channel` interface.
- Preserve key invariants: channel array construction, `findChannel()` lookup behavior, and message routing/dispatch semantics remain the same.

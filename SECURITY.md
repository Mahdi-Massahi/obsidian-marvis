# Security policy

## Reporting a vulnerability

If you've found a security issue in Marvis, please **don't open a public
issue**. Email **mahdi.massahi@xebia.com** with the details and I'll
respond within 5 business days. If the issue is confirmed and patched,
you'll be credited in the release notes (unless you prefer to remain
anonymous).

## Scope

Marvis is a local-first Obsidian plugin. It runs entirely inside the
user's Obsidian process — there is no Marvis-hosted backend. The
sensitive surfaces are:

- **AI assistant API key.** When the assistant is enabled, the user
  supplies a Gemini API key. The key is stored in Obsidian's per-plugin
  `data.json` and is never transmitted anywhere except directly to the
  configured Google Gemini Live endpoint over WSS.
- **Vault file writes.** All AI-driven writes route through
  `AssistantConfirmModal` — a write tool cannot mutate the vault without
  an explicit user click. Bypassing that gate would be a security bug.
- **Apple Calendar sync.** macOS-only. Read-only pull from the user's
  selected calendars via EventKit; no data leaves the device.

Out of scope:
- Issues in Obsidian itself, in the `obsidian` peer module, or in
  third-party plugins that interact with Marvis-created notes.
- Issues that require physical access to an unlocked vault.

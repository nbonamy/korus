# native

Native helper binaries shipped with the desktop app. Follow the root
[AGENTS.md](../AGENTS.md) as well.

## tts-helper

`tts-helper/` is a Swift package that builds `app-tts-helper`, the local
text-to-speech helper. `npm run build:tts` (`scripts/prepare-tts-helper.mjs`)
builds it and copies the binary into the desktop app's resources (`client/electron/.tts`).
Electron main launches it for spoken announcements; the renderer never talks to it.

- **The request protocol is versioned.** `SpeakRequest` carries a version, an id,
  the text and an optional voice, and the helper validates all of it (version,
  non-empty id and text, a short text limit). Change the protocol additively and
  keep the version check honest.
- **Everything is local.** The helper uses an on-device model. Voice tensors are
  downloaded on demand and verified against pinned SHA-256 digests before use;
  never relax that check or add a network dependency.
- **Dependencies are pinned and attributed.** When `Package.resolved` or the model
  changes, update `NOTICE.md` in the same change.
- **Verify** with `swift test` in `native/tts-helper`; these tests are not part of
  `npm test`.

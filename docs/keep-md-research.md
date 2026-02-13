# keep.md Implementation Research for Bookmark Buddy

## Executive summary

`Bookmark Buddy` is currently the Safari Web Extension starter template with minimal runtime logic (message echo + placeholder popup/background scripts). The clean slate means we can adopt a **Markdown-first bookmark source of truth** with relatively little migration burden. 

I could not fetch `https://keep.md/` directly from this container because outbound requests to that host returned `403` at the proxy layer, so this plan uses:

1. The observed repository architecture.
2. Common 2024–2026 best practices for Markdown-based knowledge/bookmark systems.
3. A proposed `keep.md` adapter layer that can be aligned quickly once the upstream spec is reachable.

## Current codebase baseline (what exists today)

- `background.js` only responds to a `greeting` message and returns a static value. No persistence, capture pipeline, or indexing exists yet.
- `popup.js` only logs to console; no UI state or data model.
- `SafariWebExtensionHandler.swift` currently echoes extension native messages back to the browser runtime, which is useful as a bridge scaffold.
- `ViewController.swift` is default host-app bootstrap UI for extension enablement and does not yet provide bookmark functionality.

Implication: adding keep.md is not constrained by heavy legacy behavior, but we should define interfaces now so the extension and native app evolve in lockstep.

## What “keep.md” likely implies (working model)

Because the canonical site was unavailable from this environment, use this as an implementation hypothesis:

- A portable Markdown representation for saved items (links, notes, highlights, tags, metadata).
- Human-editable flat files that remain useful in Git/Obsidian/plain text tooling.
- Deterministic serialization (stable field ordering, predictable heading structure) so diffs remain clean.

### Proposed canonical record shape

Use one Markdown document per bookmark, optionally grouped by date folders:

```md
---
id: 01JV8A3D8W0K7QY8X8M7E9G8Q1
url: https://example.com/post
title: Example Post
author: Jane Doe
created: 2026-02-13T21:00:00Z
captured_from: safari-extension
tags: [ai, research]
source_type: article
lang: en
hash_url: sha256:...
---

# Summary

One-paragraph summary.

# Notes

- Key point 1
- Key point 2

# Highlights

> Optional clipped quote
```

Why this pattern is robust:
- YAML frontmatter is ubiquitous in Markdown ecosystems.
- Body sections are future-proof (plain Markdown; app-specific semantics live in headings + metadata keys).

## Recommended architecture in Bookmark Buddy

## 1) Domain model and adapters

Create a strict in-memory model independent from UI:

- `BookmarkRecord` (typed fields, normalized URL, created/updated timestamps, tags, content sections).
- `KeepMdAdapter` with two pure methods:
  - `parse(markdown: string) -> BookmarkRecord | ParseError`
  - `serialize(record: BookmarkRecord) -> string`

Best practice: keep parse/serialize pure and deterministic; side effects (storage, network, native bridge) stay outside.

## 2) Storage abstraction (avoid lock-in)

Define `BookmarkStore` interface with implementations:

- `BrowserLocalStore` (WebExtension `storage.local`) for MVP.
- `NativeFileStore` (through `browser.runtime.sendNativeMessage` to Swift host) for filesystem-backed `.md` storage.
- Optional future `GitSyncStore` for repo-backed sync.

This lets you ship early with extension-only storage while preserving migration path to true file-based keep.md compatibility.

## 3) Import/export pipeline

Add command handlers in `background.js`:

- `IMPORT_KEEP_MD_BLOB` (many markdown files → parse → dedupe → persist).
- `EXPORT_KEEP_MD_BLOB` (records → deterministic markdown files).
- `CAPTURE_CURRENT_TAB` (extract metadata, create record, persist).

Use an idempotent dedupe key:

- Primary: normalized URL hash.
- Secondary: canonical content hash (`title + url + created day`).

## 4) Native bridge strategy for real file ownership

Current Swift extension handler already receives messages and returns structured payloads. Extend it with typed commands:

- `writeKeepMdFile`
- `readKeepMdFiles`
- `listKeepMdFiles`
- `deleteKeepMdFile`

Guardrails:
- Restrict to app-managed directory.
- Validate payload schema before disk I/O.
- Return typed error codes (`E_PARSE`, `E_IO`, `E_CONFLICT`, `E_UNAUTHORIZED_PATH`).

## 5) UI strategy

`popup.js` should move from console-only to a small state machine:

- states: `idle`, `capturing`, `saved`, `error`, `syncing`.
- actions: save current page, tag quickly, open library.

For larger management UI, use an extension page rather than overloading popup dimensions.

## 6) Conflict handling and sync semantics

When using markdown files + multi-device edits, define conflict policy early:

- Last-write-wins for metadata fields.
- Merge append-only sections (`Notes`, `Highlights`) using block identifiers when possible.
- Store `updated` and `revision` metadata.
- On hard conflict, write both versions and mark record `conflicted: true`.

## 7) Search and indexing

Generate lightweight inverted index from:

- title
- url host/path tokens
- tags
- summary + notes text

Implementation options:
- Start with in-memory token map persisted alongside records.
- Upgrade to MiniSearch/Lunr-like approach only after scale requires it.

## 8) Security and trust boundaries

Critical because Markdown can embed HTML/JS:

- Never render unsanitized markdown HTML.
- If rendering is needed, pass output through sanitizer allowlist.
- Strip scriptable protocols (`javascript:`, malformed `data:` URLs except explicit safe cases).
- Enforce URL normalization and punycode-safe host handling.
- Treat imported markdown as untrusted content.

## 9) Performance budgets

Set explicit budgets before implementation:

- Capture action ≤ 200 ms median perceived latency.
- Popup interactive ready ≤ 150 ms after open.
- Bulk import: stream parse; avoid loading huge archives into memory.

## 10) Testing strategy (high confidence)

Add tests at three levels:

1. **Parser/serializer golden tests**
   - markdown fixture ↔ expected JSON model roundtrips.
   - malformed frontmatter and edge Unicode cases.
2. **Background command tests**
   - message routing, dedupe behavior, error surfaces.
3. **Bridge contract tests**
   - JS message schema ↔ Swift decoding/encoding.

Include a corpus folder of real-world markdown samples for regression testing.

## Suggested phased rollout

### Phase 0: Spec lock
- Confirm official keep.md grammar and reserved keys.
- Finalize compatibility mode matrix (strict vs permissive parse).

### Phase 1: MVP in extension storage
- Implement domain model + parser/serializer.
- Save/capture/export in `storage.local`.
- Basic popup actions.

### Phase 2: Native file-backed mode
- Extend native messaging commands in Swift.
- Add read/write/list file operations and migration.

### Phase 3: Sync and collaboration hardening
- Conflict markers, revision metadata, optional git-friendly layout.
- Import diagnostics UI and repair tools.

## Online best-practice references consulted

Given the network limitation to `keep.md`, these are the main current practices to align with:

- CommonMark + GitHub-Flavored Markdown compatibility for predictable parsing.
- Frontmatter interoperability (`gray-matter` style YAML blocks).
- Sanitized markdown rendering model (DOMPurify/rehype-sanitize approach).
- WebExtension architecture pattern: keep long-lived state in background/service layer, keep popup ephemeral.
- Deterministic text serialization for VCS-friendly sync.

## Concrete next tasks for this repository

1. Replace placeholder `background.js` message handler with typed command router.
2. Implement `keep-md.ts` (or `keep-md.js`) parser/serializer module + tests.
3. Replace `popup.js` console log with capture/import/export UI actions.
4. Extend `SafariWebExtensionHandler.swift` from echo response to command-dispatch bridge.
5. Add `docs/keep-md-spec-compat.md` with strict/permissive parse rules once official spec is reachable.

## Risks and mitigations

- **Risk:** Official keep.md spec differs from assumed metadata keys.
  - **Mitigation:** adapter layer with configurable key mapping + strict mode.
- **Risk:** Markdown import from arbitrary sources includes hostile content.
  - **Mitigation:** sanitize render path; never execute raw HTML.
- **Risk:** Divergent behavior between iOS/macOS extension contexts.
  - **Mitigation:** shared command schema + integration tests against both targets.

## Open questions to resolve when keep.md is reachable

- Required vs optional frontmatter keys.
- Canonical timestamp format and timezone rules.
- Whether multi-bookmark-per-file is valid.
- Any reserved headings/macros/extensions.
- How attachments/images are represented.

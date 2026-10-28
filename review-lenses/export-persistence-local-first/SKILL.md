---
name: export-persistence-local-first
description: Review Excalidraw export, persistence, and local-only feature changes for data loss, round-trip, escaping, quota, and boundary regressions. Use as one lens in a code review run.
---

# Review lens: Export Persistence and Local-First Boundaries

Review changes that save, load, export, import, name, switch, or store Excalidraw scenes or local demo data for whether data round-trips honestly and stays within its intended boundary.

## Scope

- **Round-trip persistence** Whether scene files, binaries, references, boards, bookmarks, and templates reload with the same user-visible content or fail explicitly.
- **Local-first boundaries** Whether local-only features avoid new network transmission, secret or public service endpoints, and false claims of sync or sharing.
- **Data safety** Whether board switching, quota errors, storage corruption, and unsupported data avoid silent erasure.
- **Escaping and names** Whether user-provided names, text, and template content are escaped when displayed or serialized.

## Method

Start at the changed persistence or export boundary. Follow data from user input through serialization, storage or file APIs, reload/import, and UI messaging. Check what happens when the browser denies file access, storage is full or corrupt, or a scene includes binary references.

## Threshold

Report a change when user work can be silently lost, a saved/exported artifact cannot honestly be reloaded, unsupported data is accepted without a clear failure, local-only data crosses a network boundary, or user-controlled text can be interpreted as markup or code.

Do not report a browser file-picker denial as a product bug when the UI treats it as a denied save rather than success, and do not require sync behavior for features that clearly remain local.

## Reporting

Name the data boundary, the scenario that loses or misrepresents data, and the user-facing result. State whether the fix should preserve the data, reject it explicitly, escape it, or correct the UI claim.

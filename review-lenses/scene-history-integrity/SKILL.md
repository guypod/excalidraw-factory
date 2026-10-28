---
name: scene-history-integrity
description: Review Excalidraw editor changes for scene graph, history, and undo/redo integrity. Use as one lens in a code review run.
---

# Review lens: Scene History Integrity

Review changes that mutate Excalidraw editor state for whether user operations preserve the scene graph and history model.

## Scope

- **Element identity and ordering** Whether mutations preserve element ids, fractional ordering, deleted-element handling, and selection state.
- **Connected geometry** Whether bound text, arrows, containers, and related elements stay connected through the operation and undo/redo.
- **History capture** Whether each intentional user operation becomes the right undo unit through `CaptureUpdateAction` or the repository's equivalent update path.
- **Object ownership** Whether the change avoids direct mutation of shared scene objects that other state or history entries still reference.

## Method

Start at the changed editor operation, action, or state update. Follow the update through the element map, app state, history capture, and any tests that exercise the operation through real editor state rather than isolated object shapes.

## Threshold

Report a change when a normal user operation can corrupt relationships between elements, produce an undo/redo result that differs from the visible operation, lose selection or deleted-element semantics, or mutate shared state outside the expected update path.

Do not report pure rendering changes, read-only calculations, or refactors that keep the same editor update path and preserve existing scene/history tests.

## Reporting

Name the operation, the state relationship that can be broken, and the user-visible undo/redo or scene outcome. State the safer update path or test coverage that would prove the relationship is preserved.

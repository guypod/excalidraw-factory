---
name: accessible-canvas-workflows
description: Review Excalidraw UI changes for accessible keyboard, focus, dialog, shortcut, and announcement behavior. Use as one lens in a code review run.
---

# Review lens: Accessible Canvas Workflows

Review changes that add or alter Excalidraw canvas UI, dialogs, toolbar actions, shortcuts, or timed interactions for whether users can complete them without a pointer and without disruptive focus behavior.

## Scope

- **Keyboard path** Whether users can open, navigate, confirm, cancel, and recover from the workflow with the keyboard.
- **Focus and dialogs** Whether focus moves intentionally, returns after close, and Escape/cancel behavior is consistent with nearby UI.
- **Labels and shortcuts** Whether controls have accessible names and new shortcuts avoid conflicts with existing editor shortcuts and text entry.
- **Contrast, motion, and announcements** Whether theme contrast, reduced-motion behavior, timers, and live announcements remain legible and do not seize focus or announce excessively.

## Method

Start at the changed interactive control or workflow. Trace how it is reached, how focus enters and leaves it, how keyboard events are handled, and how it behaves under themes, reduced motion, and screen-reader-facing labels.

## Threshold

Report a change when keyboard or assistive-technology users cannot complete or exit the workflow, when focus is lost or trapped, when a control lacks a usable name, when text or icon contrast is materially too low to read in a supported theme, or when announcements or timers disrupt use.

Do not report cosmetic color or motion preferences that remain legible and non-blocking, or intentional shortcut changes that are documented and do not conflict with text input or existing editor commands.

## Reporting

Name the affected workflow and the user action that fails. State the missing keyboard, focus, label, contrast, or announcement behavior and the nearby Excalidraw pattern to follow.

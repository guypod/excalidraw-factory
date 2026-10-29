import { COLOR_PALETTE } from "@excalidraw/common";
import { convertToExcalidrawElements } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

/** Notes beyond this count are dropped so one paste cannot flood the scene. */
export const STICKY_BURST_MAX_NOTES = 50;
/** Characters per note; longer lines are shortened to fit a sticky. */
export const STICKY_BURST_MAX_LENGTH = 140;

const NOTE_SIZE = 200;
const GAP = 20;
const ELLIPSIS = "…";

export type ParsedStickyLines = {
  lines: string[];
  /** nonempty lines dropped because of STICKY_BURST_MAX_NOTES */
  droppedCount: number;
  /** kept lines shortened because of STICKY_BURST_MAX_LENGTH */
  shortenedCount: number;
};

/** Splits pasted text into trimmed, nonempty note texts within the limits. */
export const parseStickyLines = (input: string): ParsedStickyLines => {
  const nonEmpty = input
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let shortenedCount = 0;
  const lines = nonEmpty.slice(0, STICKY_BURST_MAX_NOTES).map((line) => {
    const chars = Array.from(line);
    if (chars.length <= STICKY_BURST_MAX_LENGTH) {
      return line;
    }
    shortenedCount++;
    return `${chars
      .slice(0, STICKY_BURST_MAX_LENGTH - 1)
      .join("")
      .trimEnd()}${ELLIPSIS}`;
  });

  return {
    lines,
    droppedCount: nonEmpty.length - lines.length,
    shortenedCount,
  };
};

/**
 * Builds a roughly square grid of sticky notes (rectangles with bound text),
 * with fresh ids on every call.
 */
export const getStickyNoteElements = (
  lines: readonly string[],
): ExcalidrawElement[] => {
  const columns = Math.ceil(Math.sqrt(lines.length));
  const notes = lines.map((text) =>
    convertToExcalidrawElements(
      [
        {
          type: "rectangle",
          x: 0,
          y: 0,
          width: NOTE_SIZE,
          height: NOTE_SIZE,
          backgroundColor: COLOR_PALETTE.yellow[1],
          fillStyle: "solid",
          roundness: { type: 3 },
          label: { text, fontSize: 16 },
        },
      ],
      { regenerateIds: true },
    ),
  );

  // a note grows taller when its text needs more room, so each row is as
  // tall as its tallest note to keep notes from overlapping
  const elements: ExcalidrawElement[] = [];
  let rowTop = 0;
  for (let row = 0; row * columns < notes.length; row++) {
    const rowNotes = notes.slice(row * columns, (row + 1) * columns);
    let rowHeight = NOTE_SIZE;
    for (const [column, noteElements] of rowNotes.entries()) {
      const dx = column * (NOTE_SIZE + GAP);
      for (const element of noteElements) {
        if (element.type === "rectangle") {
          rowHeight = Math.max(rowHeight, element.height);
        }
        elements.push({ ...element, x: element.x + dx, y: element.y + rowTop });
      }
    }
    rowTop += rowHeight + GAP;
  }
  return elements;
};

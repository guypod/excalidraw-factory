import React from "react";

import { KEYS, reseed, viewportCoordsToSceneCoords } from "@excalidraw/common";
import {
  CaptureUpdateAction,
  getCommonBounds,
  getContainerElement,
  isBoundToContainer,
  isTextElement,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextElementWithContainer,
} from "@excalidraw/element/types";

import {
  STICKY_BURST_MAX_LENGTH,
  STICKY_BURST_MAX_NOTES,
  getStickyNoteElements,
  parseStickyLines,
} from "../components/StickyBurst/stickyNotes";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import {
  act,
  fireEvent,
  queryByTestId,
  render,
  unmountComponent,
  waitFor,
} from "./test-utils";

const { h } = window;

const openDialog = async () => {
  act(() => {
    API.setAppState({ openDialog: { name: "stickyBurst" } });
  });
  await waitFor(() =>
    expect(document.querySelector(".StickyBurstDialog")).not.toBeNull(),
  );
};

const getDialog = () =>
  document.querySelector(".StickyBurstDialog") as HTMLElement;

const typeLines = (text: string) => {
  fireEvent.change(queryByTestId(getDialog(), "sticky-burst-input")!, {
    target: { value: text },
  });
};

const getInsertButton = () =>
  queryByTestId(getDialog(), "sticky-burst-insert") as HTMLButtonElement;

const expectNotesBoundCorrectly = (
  elements: readonly ExcalidrawElement[],
  expectedTexts: readonly string[],
) => {
  const elementsMap = new Map(elements.map((el) => [el.id, el]));
  const boundTexts = elements.filter(
    (el): el is ExcalidrawTextElementWithContainer =>
      isTextElement(el) && isBoundToContainer(el),
  );
  expect(boundTexts.map((el) => el.originalText)).toEqual(expectedTexts);
  for (const text of boundTexts) {
    const container = getContainerElement(text, elementsMap);
    expect(container?.type).toBe("rectangle");
    expect(container!.boundElements).toEqual([{ type: "text", id: text.id }]);
  }
  expect(elements.filter((el) => el.type === "rectangle").length).toBe(
    expectedTexts.length,
  );
};

describe("parseStickyLines", () => {
  it("keeps trimmed nonempty lines across line ending styles", () => {
    expect(parseStickyLines("  one \r\n\r\n\ttwo\rthree\n   \n")).toEqual({
      lines: ["one", "two", "three"],
      droppedCount: 0,
      shortenedCount: 0,
    });
  });

  it("returns no lines for empty or whitespace input", () => {
    expect(parseStickyLines("").lines).toEqual([]);
    expect(parseStickyLines(" \n\t\n ").lines).toEqual([]);
  });

  it("caps the number of notes and the length of each", () => {
    const many = Array.from(
      { length: STICKY_BURST_MAX_NOTES + 5 },
      (_, i) => `line ${i}`,
    ).join("\n");
    const parsedMany = parseStickyLines(many);
    expect(parsedMany.lines.length).toBe(STICKY_BURST_MAX_NOTES);
    expect(parsedMany.lines[0]).toBe("line 0");
    expect(parsedMany.droppedCount).toBe(5);

    const long = "x".repeat(STICKY_BURST_MAX_LENGTH + 10);
    const parsedLong = parseStickyLines(`${long}\nshort`);
    expect(Array.from(parsedLong.lines[0]).length).toBe(
      STICKY_BURST_MAX_LENGTH,
    );
    expect(parsedLong.lines[0].endsWith("…")).toBe(true);
    expect(parsedLong.lines[1]).toBe("short");
    expect(parsedLong.shortenedCount).toBe(1);
  });
});

describe("getStickyNoteElements", () => {
  it("builds bound-text notes with unique ids on every call", () => {
    const lines = ["alpha", "beta", "gamma", "delta", "epsilon"];
    const first = getStickyNoteElements(lines);
    const second = getStickyNoteElements(lines);

    const ids = first.map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(second.some((el) => ids.includes(el.id))).toBe(false);
    expectNotesBoundCorrectly(first, lines);
  });

  it("lays notes out in a grid without overlaps", () => {
    const lines = [
      "a",
      "a much longer note that wraps over several lines inside the sticky, ".repeat(
        2,
      ),
      "c",
      "d",
    ];
    const rects = getStickyNoteElements(lines).filter(
      (el) => el.type === "rectangle",
    );
    // four notes form a 2x2 grid
    expect(new Set(rects.map((el) => el.x)).size).toBe(2);
    expect(new Set(rects.map((el) => el.y)).size).toBe(2);
    for (const a of rects) {
      for (const b of rects) {
        if (a === b) {
          continue;
        }
        const overlaps =
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height;
        expect(overlaps).toBe(false);
      }
    }
  });
});

describe("<StickyBurstDialog/>", () => {
  beforeEach(async () => {
    unmountComponent();
    reseed(7);
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("previews and inserts notes near the viewport center without replacing the scene", async () => {
    const existing = API.createElement({
      type: "rectangle",
      x: -500,
      y: -500,
      width: 100,
      height: 100,
    });
    API.setElements([existing]);
    API.setAppState({ scrollX: 300, scrollY: -200 });

    await openDialog();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        queryByTestId(getDialog(), "sticky-burst-input"),
      ),
    );
    typeLines("Ship it\n\n  Fix the bug  \nWrite docs\n");

    expect(
      queryByTestId(getDialog(), "sticky-burst-status")!.textContent,
    ).toContain("3");
    await waitFor(() =>
      expect(
        queryByTestId(getDialog(), "sticky-burst-preview")!.querySelector(
          "svg",
        ),
      ).not.toBeNull(),
    );

    fireEvent.click(getInsertButton());
    expect(getDialog()).toBeNull();
    expect(h.state.openDialog).toBeNull();

    expect(h.elements.find((el) => el.id === existing.id)).toEqual(
      expect.objectContaining({ isDeleted: false, x: -500, y: -500 }),
    );
    const inserted = h.elements.filter((el) => el.id !== existing.id);
    expectNotesBoundCorrectly(inserted, [
      "Ship it",
      "Fix the bug",
      "Write docs",
    ]);
    const ids = h.elements.map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);

    const [minX, minY, maxX, maxY] = getCommonBounds(inserted);
    const center = viewportCoordsToSceneCoords(
      {
        clientX: h.state.width / 2 + h.state.offsetLeft,
        clientY: h.state.height / 2 + h.state.offsetTop,
      },
      h.state,
    );
    expect(Math.abs((minX + maxX) / 2 - center.x)).toBeLessThan(50);
    expect(Math.abs((minY + maxY) / 2 - center.y)).toBeLessThan(50);
  });

  it("undoes and redoes the whole burst in a single step", async () => {
    const existing = API.createElement({ type: "rectangle" });
    API.updateScene({
      elements: [existing],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    const undoStackSize = API.getUndoStack().length;

    await openDialog();
    typeLines("one\ntwo\nthree");
    fireEvent.click(getInsertButton());

    const insertedIds = h.elements
      .filter((el) => el.id !== existing.id)
      .map((el) => el.id);
    expect(insertedIds.length).toBe(6);
    expect(API.getUndoStack().length).toBe(undoStackSize + 1);

    Keyboard.undo();
    expect(h.elements.filter((el) => !el.isDeleted).map((el) => el.id)).toEqual(
      [existing.id],
    );

    Keyboard.redo();
    const restored = h.elements.filter((el) => !el.isDeleted);
    expect(restored.map((el) => el.id)).toEqual([existing.id, ...insertedIds]);
    expectNotesBoundCorrectly(
      restored.filter((el) => el.id !== existing.id),
      ["one", "two", "three"],
    );
  });

  it("disables insert for empty input and explains why", async () => {
    await openDialog();
    expect(getInsertButton().disabled).toBe(true);

    typeLines("   \n\n\t");
    expect(getInsertButton().disabled).toBe(true);
    fireEvent.keyDown(queryByTestId(getDialog(), "sticky-burst-input")!, {
      key: KEYS.ENTER,
      ctrlKey: true,
    });
    expect(getDialog()).not.toBeNull();
    expect(h.elements).toEqual([]);
    expect(
      queryByTestId(getDialog(), "sticky-burst-preview")!.querySelector("svg"),
    ).toBeNull();
  });

  it("tells the user when lines are dropped or shortened", async () => {
    await openDialog();
    const many = Array.from({ length: STICKY_BURST_MAX_NOTES + 2 }, (_, i) =>
      i === 0 ? "y".repeat(STICKY_BURST_MAX_LENGTH + 1) : `n${i}`,
    ).join("\n");
    typeLines(many);

    const status = queryByTestId(getDialog(), "sticky-burst-status")!
      .textContent!;
    expect(status).toContain(String(STICKY_BURST_MAX_NOTES));
    expect(status).toContain(String(STICKY_BURST_MAX_LENGTH));

    fireEvent.click(getInsertButton());
    expect(h.elements.filter(isTextElement).length).toBe(
      STICKY_BURST_MAX_NOTES,
    );
  });

  it("inserts with Ctrl+Enter and keeps typing keys away from the editor", async () => {
    const existing = API.createElement({ type: "rectangle", x: 10, y: 20 });
    API.setElements([existing]);
    API.setSelectedElements([existing]);

    await openDialog();
    const input = queryByTestId(getDialog(), "sticky-burst-input")!;
    fireEvent.keyDown(input, { key: KEYS.ARROW_RIGHT });
    fireEvent.keyDown(input, { key: KEYS.DELETE });
    expect(h.elements).toEqual([
      expect.objectContaining({
        id: existing.id,
        x: 10,
        y: 20,
        isDeleted: false,
      }),
    ]);

    typeLines("only note");
    fireEvent.keyDown(input, {
      key: KEYS.ENTER,
      ctrlKey: true,
      isComposing: true,
    });
    fireEvent.keyDown(input, { key: KEYS.ENTER, ctrlKey: true, keyCode: 229 });
    expect(getDialog()).not.toBeNull();
    expect(h.elements.filter(isTextElement)).toEqual([]);

    fireEvent.keyDown(input, { key: KEYS.ENTER, ctrlKey: true });
    expect(getDialog()).toBeNull();
    expect(
      h.elements.filter(isTextElement).map((el) => el.originalText),
    ).toEqual(["only note"]);
  });

  it("cancels without changing the scene and returns focus to the editor", async () => {
    const existing = API.createElement({ type: "rectangle" });
    API.setElements([existing]);
    const undoStackSize = API.getUndoStack().length;

    await openDialog();
    typeLines("would be a note");
    fireEvent.click(queryByTestId(getDialog(), "sticky-burst-cancel")!);
    expect(getDialog()).toBeNull();
    expect(document.activeElement).toBe(
      document.querySelector(".excalidraw-container"),
    );

    await openDialog();
    typeLines("another note");
    fireEvent.keyDown(getDialog(), { key: KEYS.ESCAPE });
    expect(getDialog()).toBeNull();

    expect(h.elements.map((el) => el.id)).toEqual([existing.id]);
    expect(API.getUndoStack().length).toBe(undoStackSize);
  });
});

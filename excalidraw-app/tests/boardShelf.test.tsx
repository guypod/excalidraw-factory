import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import {
  act,
  fireEvent,
  render,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";
import { createStore, set } from "idb-keyval";
import { vi } from "vitest";

import type { FileId } from "@excalidraw/element/types";
import type { BinaryFileData, DataURL } from "@excalidraw/excalidraw/types";

import ExcalidrawApp from "../App";
import { appJotaiStore } from "../app-jotai";
import { STORAGE_KEYS } from "../app_constants";
import {
  activeBoardAtom,
  boardShelfDialogOpenAtom,
} from "../components/BoardShelfDialog";
import { BoardShelf, BoardShelfError } from "../data/boardShelf";

const { h } = window;

const boardsStore = createStore(
  `${STORAGE_KEYS.IDB_BOARDS}-db`,
  `${STORAGE_KEYS.IDB_BOARDS}-store`,
);

const imageFile: BinaryFileData = {
  id: "image-file-1" as FileId,
  mimeType: "image/png",
  dataURL: "data:image/png;base64,iVBORw0KGgo=" as DataURL,
  created: 1,
};

const clearBoards = async () => {
  const { boards, unreadable } = await BoardShelf.list();
  for (const { id } of [...boards, ...unreadable]) {
    await BoardShelf.delete(id);
  }
};

const byTestId = (testId: string) =>
  document.querySelector<HTMLElement>(`[data-testid='${testId}']`);

const openShelf = async () => {
  act(() => {
    appJotaiStore.set(boardShelfDialogOpenAtom, true);
  });
  await waitFor(() =>
    expect(document.querySelector(".BoardShelfDialog")).not.toBeNull(),
  );
};

const boardItem = (name: string) =>
  [...document.querySelectorAll<HTMLElement>(".BoardShelf__item")].find(
    (item) => item.textContent?.includes(name),
  );

const clickInItem = async (name: string, testId: string) => {
  await waitFor(() => expect(boardItem(name)).toBeTruthy());
  fireEvent.click(boardItem(name)!.querySelector(`[data-testid='${testId}']`)!);
};

const saveAsNew = async (name: string) => {
  const input = document.querySelector<HTMLInputElement>(
    ".BoardShelf__saveRow input",
  )!;
  fireEvent.change(input, { target: { value: name } });
  fireEvent.click(byTestId("board-shelf-save-new")!);
  await waitFor(() => expect(boardItem(name)).toBeTruthy());
};

const setScene = (
  elements: Parameters<typeof API.updateScene>[0]["elements"],
) =>
  act(() => {
    API.updateScene({
      elements,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  });

describe("BoardShelf storage", () => {
  beforeEach(clearBoards);

  it("round-trips elements and the image files they reference", async () => {
    const rect = API.createElement({ type: "rectangle", id: "rect" });
    const image = API.createElement({
      type: "image",
      id: "img",
      fileId: imageFile.id,
    });
    const unrelated = { ...imageFile, id: "unused" as FileId };

    const { record, missingFileIds } = await BoardShelf.save({
      name: "  Sprint   plan ",
      elements: [rect, image],
      appState: { viewBackgroundColor: "#ffc9c9" },
      files: { [imageFile.id]: imageFile, [unrelated.id]: unrelated },
    });

    expect(missingFileIds).toEqual([]);
    expect(record.name).toBe("Sprint plan");

    const loaded = await BoardShelf.load(record.id);
    expect(loaded.elements.map((el) => el.id)).toEqual(["rect", "img"]);
    expect(Object.keys(loaded.files)).toEqual([imageFile.id]);
    expect(loaded.files[imageFile.id].dataURL).toBe(imageFile.dataURL);
    expect(loaded.appState.viewBackgroundColor).toBe("#ffc9c9");
  });

  it("reports images whose data is not available", async () => {
    const image = API.createElement({
      type: "image",
      fileId: "missing" as FileId,
    });
    const { missingFileIds } = await BoardShelf.save({
      name: "Board",
      elements: [image],
      appState: {},
      files: {},
    });
    expect(missingFileIds).toEqual(["missing"]);
  });

  it("keeps the previous version when a save hits the storage quota", async () => {
    const rect = API.createElement({ type: "rectangle", id: "first" });
    const { record } = await BoardShelf.save({
      name: "Board",
      elements: [rect],
      appState: {},
      files: {},
    });

    const quotaError = new DOMException("full", "QuotaExceededError");
    const putSpy = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(() => {
        throw quotaError;
      });

    try {
      await expect(
        BoardShelf.save({
          id: record.id,
          name: "Board",
          elements: [API.createElement({ type: "ellipse", id: "second" })],
          appState: {},
          files: {},
        }),
      ).rejects.toMatchObject({ code: "quota" });
    } finally {
      putSpy.mockRestore();
    }

    const loaded = await BoardShelf.load(record.id);
    expect(loaded.elements.map((el) => el.id)).toEqual(["first"]);
  });

  it("lists corrupt entries separately and refuses to load them", async () => {
    await set("broken", { version: 1, name: 5 }, boardsStore);
    await BoardShelf.save({
      name: "Good",
      elements: [],
      appState: {},
      files: {},
    });

    const { boards, unreadable } = await BoardShelf.list();
    expect(boards.map((board) => board.name)).toEqual(["Good"]);
    expect(unreadable).toEqual([{ id: "broken" }]);

    const error = await BoardShelf.load("broken").catch((error) => error);
    expect(error).toBeInstanceOf(BoardShelfError);
    expect(error.code).toBe("corrupt");

    // still there: corrupt data is never removed without the user asking
    expect((await BoardShelf.list()).unreadable).toEqual([{ id: "broken" }]);
  });

  it("renames and deletes boards", async () => {
    const { record } = await BoardShelf.save({
      name: "Old",
      elements: [],
      appState: {},
      files: {},
    });
    await BoardShelf.rename(record.id, "New");
    expect((await BoardShelf.list()).boards.map((b) => b.name)).toEqual([
      "New",
    ]);
    await BoardShelf.delete(record.id);
    expect((await BoardShelf.list()).boards).toEqual([]);
  });
});

describe("BoardShelfDialog", () => {
  beforeEach(async () => {
    await clearBoards();
    localStorage.clear();
    appJotaiStore.set(activeBoardAtom, null);
    await render(<ExcalidrawApp />);
  });

  it("says boards are local only", async () => {
    await openShelf();
    expect(
      document.querySelector(".BoardShelf__localOnly")?.textContent,
    ).toMatch(/only in this browser.*not synced/);
  });

  it("saves, switches and reloads boards with their images", async () => {
    act(() => {
      h.app.addFiles([imageFile]);
    });
    setScene([
      API.createElement({ type: "image", id: "img", fileId: imageFile.id }),
    ]);
    await openShelf();
    await saveAsNew("Images");

    setScene([API.createElement({ type: "rectangle", id: "rect" })]);
    await saveAsNew("Shapes");
    expect(byTestId("board-shelf-current")?.textContent).toContain("Shapes");

    // "Shapes" is saved, so switching does not ask
    await clickInItem("Images", "board-shelf-open");
    await waitFor(() => expect(h.elements.map((el) => el.id)).toEqual(["img"]));
    expect(byTestId("board-shelf-confirm")).toBeNull();
    expect(h.app.files[imageFile.id]?.dataURL).toBe(imageFile.dataURL);
    expect(h.state.name).toBe("Images");

    await clickInItem("Shapes", "board-shelf-open");
    await waitFor(() =>
      expect(h.elements.map((el) => el.id)).toEqual(["rect"]),
    );
  });

  it("asks before replacing unsaved changes, and cancel keeps them", async () => {
    setScene([API.createElement({ type: "rectangle", id: "saved" })]);
    await openShelf();
    await saveAsNew("Board A");

    setScene([API.createElement({ type: "ellipse", id: "unsaved" })]);
    await clickInItem("Board A", "board-shelf-open");

    await waitFor(() => expect(byTestId("board-shelf-confirm")).not.toBeNull());
    fireEvent.click(byTestId("board-shelf-confirm-cancel")!);
    expect(byTestId("board-shelf-confirm")).toBeNull();
    expect(h.elements.map((el) => el.id)).toEqual(["unsaved"]);

    await clickInItem("Board A", "board-shelf-open");
    await waitFor(() => expect(byTestId("board-shelf-confirm")).not.toBeNull());
    fireEvent.click(byTestId("board-shelf-confirm-action")!);
    await waitFor(() =>
      expect(h.elements.map((el) => el.id)).toEqual(["saved"]),
    );
  });

  it("keeps focus in the dialog after a confirmation closes", async () => {
    await openShelf();
    await saveAsNew("Focus");
    await clickInItem("Focus", "board-shelf-delete");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        byTestId("board-shelf-confirm-cancel"),
      ),
    );
    fireEvent.click(byTestId("board-shelf-confirm-cancel")!);
    await waitFor(() =>
      expect(
        document
          .querySelector(".BoardShelfDialog")
          ?.contains(document.activeElement),
      ).toBe(true),
    );
  });

  it("asks before deleting a board", async () => {
    await openShelf();
    await saveAsNew("Doomed");

    await clickInItem("Doomed", "board-shelf-delete");
    await waitFor(() => expect(byTestId("board-shelf-confirm")).not.toBeNull());
    fireEvent.click(byTestId("board-shelf-confirm-cancel")!);
    expect((await BoardShelf.list()).boards).toHaveLength(1);

    await clickInItem("Doomed", "board-shelf-delete");
    await waitFor(() => expect(byTestId("board-shelf-confirm")).not.toBeNull());
    fireEvent.click(byTestId("board-shelf-confirm-action")!);
    await waitFor(() => expect(boardItem("Doomed")).toBeUndefined());
    expect((await BoardShelf.list()).boards).toHaveLength(0);
    expect(byTestId("board-shelf-current")?.textContent).not.toContain(
      "Doomed",
    );
  });

  it("renames a board and keeps it as the current board", async () => {
    await openShelf();
    await saveAsNew("Draft");

    await clickInItem("Draft", "board-shelf-rename");
    const input = await waitFor(() => {
      const el = boardItem("")?.querySelector<HTMLInputElement>(
        ".BoardShelf__renameForm input",
      );
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.change(input, { target: { value: "Final" } });
    fireEvent.click(byTestId("board-shelf-rename-submit")!);

    await waitFor(() => expect(boardItem("Final")).toBeTruthy());
    expect(byTestId("board-shelf-current")?.textContent).toContain("Final");
    expect((await BoardShelf.list()).boards.map((b) => b.name)).toEqual([
      "Final",
    ]);
  });

  it("shows a storage error and keeps the canvas when saving fails", async () => {
    setScene([API.createElement({ type: "rectangle", id: "keep" })]);
    await openShelf();

    const putSpy = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(() => {
        throw new DOMException("full", "QuotaExceededError");
      });
    try {
      fireEvent.click(byTestId("board-shelf-save-new")!);
      await waitFor(() =>
        expect(byTestId("board-shelf-status")?.textContent).toMatch(
          /storage is full/,
        ),
      );
    } finally {
      putSpy.mockRestore();
    }
    expect(h.elements.map((el) => el.id)).toEqual(["keep"]);
    expect((await BoardShelf.list()).boards).toHaveLength(0);
  });
});

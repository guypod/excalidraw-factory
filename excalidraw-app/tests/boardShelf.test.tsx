import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { Keyboard } from "@excalidraw/excalidraw/tests/helpers/ui";
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
import { isCollaboratingAtom } from "../collab/Collab";
import {
  BoardShelf,
  BoardShelfError,
  hasUnsavedBoardChanges,
  syncActiveBoardFromStorage,
} from "../data/boardShelf";

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

  it("keeps stored image data when overwriting without the image loaded", async () => {
    const image = API.createElement({
      type: "image",
      id: "img",
      fileId: imageFile.id,
    });
    const { record } = await BoardShelf.save({
      name: "Board",
      elements: [image],
      appState: {},
      files: { [imageFile.id]: imageFile },
    });

    const { missingFileIds } = await BoardShelf.save({
      id: record.id,
      name: "Board",
      elements: [image],
      appState: {},
      files: {},
    });

    expect(missingFileIds).toEqual([]);
    const loaded = await BoardShelf.load(record.id);
    expect(loaded.files[imageFile.id]?.dataURL).toBe(imageFile.dataURL);
  });

  it("lists records with malformed elements as unreadable", async () => {
    await set(
      "bad-elements",
      {
        version: 1,
        id: "bad-elements",
        name: "Bad",
        createdAt: 1,
        updatedAt: 1,
        elements: [null],
        appState: {},
        files: {},
      },
      boardsStore,
    );
    expect((await BoardShelf.list()).unreadable).toEqual([
      { id: "bad-elements" },
    ]);
  });

  it("renames without replacing content saved after the board was read", async () => {
    const { record } = await BoardShelf.save({
      name: "Old",
      elements: [API.createElement({ type: "rectangle", id: "first" })],
      appState: {},
      files: {},
    });
    const saving = BoardShelf.save({
      id: record.id,
      name: "Old",
      elements: [API.createElement({ type: "ellipse", id: "second" })],
      appState: {},
      files: {},
    });
    const renaming = BoardShelf.rename(record.id, "New");
    await Promise.all([saving, renaming]);

    const loaded = await BoardShelf.load(record.id);
    expect(loaded.name).toBe("New");
    expect(loaded.elements.map((el) => el.id)).toEqual(["second"]);
  });

  it("counts a changed background as unsaved", async () => {
    const elements = [API.createElement({ type: "rectangle", id: "rect" })];
    const { record } = await BoardShelf.save({
      name: "Board",
      elements,
      appState: { viewBackgroundColor: "#ffffff" },
      files: {},
    });
    const active = { id: record.id, name: record.name };
    expect(
      await hasUnsavedBoardChanges(
        elements,
        { ...getDefaultAppState(), viewBackgroundColor: "#ffffff" },
        active,
      ),
    ).toBe(false);
    expect(
      await hasUnsavedBoardChanges(
        elements,
        { ...getDefaultAppState(), viewBackgroundColor: "#ffc9c9" },
        active,
      ),
    ).toBe(true);
  });
});

describe("BoardShelfDialog", () => {
  beforeEach(async () => {
    await clearBoards();
    localStorage.clear();
    appJotaiStore.set(activeBoardAtom, null);
    appJotaiStore.set(isCollaboratingAtom, false);
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

  it("makes reopening an older snapshot one undoable step", async () => {
    const rect = API.createElement({ type: "rectangle", id: "rect", x: 0 });
    setScene([rect]);
    await openShelf();
    await saveAsNew("Board");

    setScene([
      { ...h.elements[0], x: 100, version: h.elements[0].version + 1 },
    ]);
    await clickInItem("Board", "board-shelf-open");
    await waitFor(() => expect(byTestId("board-shelf-confirm")).not.toBeNull());
    fireEvent.click(byTestId("board-shelf-confirm-action")!);
    await waitFor(() => expect(h.elements[0].x).toBe(0));

    act(() => {
      Keyboard.undo();
    });
    expect(h.elements[0].x).toBe(100);
  });

  it("does not keep the previous local file handle", async () => {
    await openShelf();
    await saveAsNew("Board");
    const fileHandle = { name: "other.excalidraw" } as any;
    act(() => {
      API.setAppState({ fileHandle });
    });
    await clickInItem("Board", "board-shelf-open");
    await waitFor(() => expect(h.state.name).toBe("Board"));
    expect(h.state.fileHandle).toBeNull();
  });

  it("does not open a board if collaboration started during the confirm", async () => {
    setScene([API.createElement({ type: "rectangle", id: "saved" })]);
    await openShelf();
    await saveAsNew("Board A");
    setScene([API.createElement({ type: "ellipse", id: "unsaved" })]);
    await clickInItem("Board A", "board-shelf-open");
    await waitFor(() => expect(byTestId("board-shelf-confirm")).not.toBeNull());

    act(() => {
      appJotaiStore.set(isCollaboratingAtom, true);
    });
    fireEvent.click(byTestId("board-shelf-confirm-action")!);
    await waitFor(() =>
      expect(byTestId("board-shelf-status")?.textContent).toMatch(
        /collaboration/,
      ),
    );
    expect(h.elements.map((el) => el.id)).toEqual(["unsaved"]);
  });

  it("does not change the scene if the dialog closes while a board loads", async () => {
    setScene([API.createElement({ type: "rectangle", id: "saved" })]);
    await openShelf();
    await saveAsNew("Board A");
    setScene([]);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const load = BoardShelf.load;
    const loadSpy = vi
      .spyOn(BoardShelf, "load")
      .mockImplementation(async (id) => {
        await gate;
        return load(id);
      });
    try {
      await clickInItem("Board A", "board-shelf-open");
      act(() => {
        appJotaiStore.set(boardShelfDialogOpenAtom, false);
      });
      setScene([API.createElement({ type: "ellipse", id: "newer" })]);
      release();
      await act(() => gate);
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      loadSpy.mockRestore();
    }
    expect(h.elements.map((el) => el.id)).toEqual(["newer"]);
  });

  it("stores the active board together with the scene it belongs to", async () => {
    setScene([API.createElement({ type: "rectangle", id: "first" })]);
    await openShelf();
    await saveAsNew("First");
    setScene([API.createElement({ type: "ellipse", id: "second" })]);
    await saveAsNew("Second");

    await clickInItem("First", "board-shelf-open");
    await waitFor(() =>
      expect(h.elements.map((el) => el.id)).toEqual(["first"]),
    );
    // written right away, not after the debounced scene save
    expect(
      JSON.parse(
        localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS)!,
      ).map((el: { id: string }) => el.id),
    ).toEqual(["first"]);
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ACTIVE_BOARD)!)
        .name,
    ).toBe("First");
  });

  it("writes a queued save with the board it was queued with", async () => {
    const first = API.createElement({ type: "rectangle", id: "first" });
    setScene([first]);
    await openShelf();
    await saveAsNew("First");
    const firstBoard = appJotaiStore.get(activeBoardAtom);
    setScene([API.createElement({ type: "ellipse", id: "second" })]);
    await saveAsNew("Second");
    const secondBoard = appJotaiStore.get(activeBoardAtom);

    const writes: { elements: string[]; board: string | null }[] = [];
    const setItem = localStorage.setItem.bind(localStorage);
    const setItemSpy = vi
      .spyOn(localStorage, "setItem")
      .mockImplementation((key, value) => {
        if (key === STORAGE_KEYS.VERSION_DATA_STATE) {
          writes.push({
            elements: JSON.parse(
              localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS)!,
            ).map((el: { id: string }) => el.id),
            board: localStorage.getItem(
              STORAGE_KEYS.LOCAL_STORAGE_ACTIVE_BOARD,
            ),
          });
        }
        return setItem(key, value);
      });
    try {
      // a scene edit queues a debounced save of "Second", then "First" is
      // opened before it runs
      setScene([
        API.createElement({ type: "ellipse", id: "second" }),
        API.createElement({ type: "diamond", id: "edit" }),
      ]);
      await clickInItem("First", "board-shelf-open");
      await waitFor(() =>
        expect(byTestId("board-shelf-confirm")).not.toBeNull(),
      );
      fireEvent.click(byTestId("board-shelf-confirm-action")!);
      await waitFor(() =>
        expect(h.elements.map((el) => el.id)).toEqual(["first"]),
      );
    } finally {
      setItemSpy.mockRestore();
    }
    expect(firstBoard).not.toEqual(secondBoard);
    for (const write of writes) {
      const board = JSON.parse(write.board!);
      expect(board.id).toBe(
        write.elements.includes("first") ? firstBoard!.id : secondBoard!.id,
      );
    }
    expect(writes.some((write) => write.elements.includes("edit"))).toBe(true);
  });

  it.each([
    ["the active board", STORAGE_KEYS.LOCAL_STORAGE_ACTIVE_BOARD],
    ["the new scene", STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS],
  ])(
    "keeps every stored scene with its own board when writing %s fails after a queued save",
    async (_, failingKey) => {
      setScene([API.createElement({ type: "rectangle", id: "first" })]);
      await openShelf();
      await saveAsNew("First");
      const firstBoard = appJotaiStore.get(activeBoardAtom)!;
      setScene([API.createElement({ type: "ellipse", id: "second" })]);
      await saveAsNew("Second");
      const secondBoard = appJotaiStore.get(activeBoardAtom)!;

      // every scene/board pair another tab could import, at each write
      const pairs: { elements: string[]; board: string | null }[] = [];
      const recordPair = () =>
        pairs.push({
          elements: JSON.parse(
            localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS)!,
          ).map((el: { id: string }) => el.id),
          board: localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ACTIVE_BOARD),
        });
      // only the write for the opened board fails. The queued save of the
      // previous scene, flushed by the open, goes through
      const setItem = localStorage.setItem.bind(localStorage);
      const removeItem = localStorage.removeItem.bind(localStorage);
      const setItemSpy = vi
        .spyOn(localStorage, "setItem")
        .mockImplementation((key, value) => {
          if (
            key === failingKey &&
            (value.includes(`"${firstBoard.id}"`) || value.includes('"first"'))
          ) {
            throw new DOMException("full", "QuotaExceededError");
          }
          setItem(key, value);
          recordPair();
        });
      const removeItemSpy = vi
        .spyOn(localStorage, "removeItem")
        .mockImplementation((key) => {
          removeItem(key);
          recordPair();
        });
      try {
        // queues a debounced save of the "Second" scene
        setScene([
          API.createElement({ type: "ellipse", id: "second" }),
          API.createElement({ type: "diamond", id: "edit" }),
        ]);
        await clickInItem("First", "board-shelf-open");
        await waitFor(() =>
          expect(byTestId("board-shelf-confirm")).not.toBeNull(),
        );
        fireEvent.click(byTestId("board-shelf-confirm-action")!);
        await waitFor(() =>
          expect(h.elements.map((el) => el.id)).toEqual(["first"]),
        );
      } finally {
        setItemSpy.mockRestore();
        removeItemSpy.mockRestore();
      }

      expect(
        pairs.some(
          (pair) => pair.elements.includes("edit") && pair.board !== null,
        ),
      ).toBe(true);
      for (const pair of pairs) {
        if (pair.board === null) {
          continue;
        }
        const { id } = JSON.parse(pair.board);
        if (pair.elements.includes("first")) {
          expect(id).toBe(firstBoard.id);
        } else if (pair.elements.includes("second")) {
          expect(id).toBe(secondBoard.id);
        }
      }
      // the failed write leaves no board behind for the scene in storage
      expect(
        localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ACTIVE_BOARD),
      ).toBeNull();
    },
  );

  it("does not leave another board stored when the scene write fails", async () => {
    setScene([API.createElement({ type: "rectangle", id: "first" })]);
    await openShelf();
    await saveAsNew("First");
    expect(
      localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ACTIVE_BOARD),
    ).not.toBeNull();

    const setItem = localStorage.setItem.bind(localStorage);
    const setItemSpy = vi
      .spyOn(localStorage, "setItem")
      .mockImplementation((key, value) => {
        if (key === STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS) {
          throw new DOMException("full", "QuotaExceededError");
        }
        return setItem(key, value);
      });
    try {
      setScene([API.createElement({ type: "ellipse", id: "second" })]);
      await saveAsNew("Second");
    } finally {
      setItemSpy.mockRestore();
    }
    expect(localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ACTIVE_BOARD)).toBe(
      null,
    );
  });

  it("takes the active board from storage when another tab's scene is imported", async () => {
    await openShelf();
    await saveAsNew("Mine");
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_ACTIVE_BOARD,
      JSON.stringify({ id: "other", name: "Other tab" }),
    );
    act(() => {
      syncActiveBoardFromStorage();
    });
    await waitFor(() =>
      expect(byTestId("board-shelf-current")?.textContent).toContain(
        "Other tab",
      ),
    );
  });
});

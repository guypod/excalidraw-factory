import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { openViewportBookmarks } from "@excalidraw/excalidraw/components/ViewportBookmarks/ViewportBookmarks";
import {
  VIEWPORT_BOOKMARKS_STORAGE_KEY,
  clearUnsavedViewportBookmarks,
} from "@excalidraw/excalidraw/components/ViewportBookmarks/viewportBookmarkStore";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import {
  act,
  fireEvent,
  render,
  screen,
  unmountComponent,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";

import ExcalidrawApp from "../App";
import { appJotaiStore } from "../app-jotai";
import {
  activeBoardAtom,
  boardShelfDialogOpenAtom,
} from "../components/BoardShelfDialog";
import { isCollaboratingAtom } from "../collab/Collab";
import { BoardShelf, syncActiveBoardFromStorage } from "../data/boardShelf";

const { h } = window;

const clearBoards = async () => {
  const { boards, unreadable } = await BoardShelf.list();
  for (const { id } of [...boards, ...unreadable]) {
    await BoardShelf.delete(id);
  }
};

const bookmarksPanel = () =>
  document.querySelector<HTMLElement>("[data-testid='viewport-bookmarks']");

const openBookmarks = async () => {
  act(() => openViewportBookmarks(h.app));
  await waitFor(() => expect(bookmarksPanel()).not.toBeNull());
};

const bookmarkNames = () =>
  [
    ...bookmarksPanel()!.querySelectorAll<HTMLElement>("[data-bookmark-id]"),
  ].map((button) => button.textContent);

const saveView = (name: string) => {
  const input = screen.getByLabelText("Bookmark name");
  fireEvent.change(input, { target: { value: name } });
  fireEvent.submit(input.closest("form")!);
};

const boardItem = (name: string) =>
  [...document.querySelectorAll<HTMLElement>(".BoardShelf__item")].find(
    (item) => item.textContent?.includes(name),
  );

const shelfButton = async (name: string, testId: string) => {
  await waitFor(() => expect(boardItem(name)).toBeTruthy());
  return boardItem(name)!.querySelector<HTMLElement>(
    `[data-testid='${testId}']`,
  )!;
};

const openShelf = async () => {
  act(() => {
    appJotaiStore.set(boardShelfDialogOpenAtom, true);
  });
  await waitFor(() =>
    expect(document.querySelector(".BoardShelfDialog")).not.toBeNull(),
  );
};

const saveBoardAsNew = async (name: string) => {
  const input = document.querySelector<HTMLInputElement>(
    ".BoardShelf__saveRow input",
  )!;
  fireEvent.change(input, { target: { value: name } });
  fireEvent.click(
    document.querySelector<HTMLElement>(
      "[data-testid='board-shelf-save-new']",
    )!,
  );
  await waitFor(() => expect(boardItem(name)).toBeTruthy());
};

const openBoard = async (name: string, elementId: string) => {
  fireEvent.click(await shelfButton(name, "board-shelf-open"));
  await waitFor(() =>
    expect(h.elements.map((el) => el.id)).toEqual([elementId]),
  );
};

const setScene = (id: string) =>
  act(() => {
    API.updateScene({
      elements: [API.createElement({ type: "rectangle", id })],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  });

describe("viewport bookmarks with local boards", () => {
  beforeEach(async () => {
    await clearBoards();
    localStorage.clear();
    clearUnsavedViewportBookmarks();
    appJotaiStore.set(activeBoardAtom, null);
    appJotaiStore.set(isCollaboratingAtom, false);
    await render(<ExcalidrawApp />);
  });

  it("keeps bookmarks per local board across switching, rename and reload", async () => {
    setScene("a-rect");
    await openShelf();
    await saveBoardAsNew("Alpha");
    setScene("b-rect");
    await saveBoardAsNew("Beta");
    const urlBefore = window.location.href;

    // the panel stays open while boards switch under it
    await openBookmarks();
    await openBoard("Alpha", "a-rect");
    saveView("View on Alpha");
    await openBoard("Beta", "b-rect");
    await waitFor(() => expect(bookmarkNames()).toEqual([]));
    saveView("View on Beta");
    await openBoard("Alpha", "a-rect");
    await waitFor(() => expect(bookmarkNames()).toEqual(["View on Alpha"]));
    // switching boards does not navigate, so the URL alone cannot tell them apart
    expect(window.location.href).toBe(urlBefore);

    // renaming a board keeps its id and so its bookmarks
    fireEvent.click(await shelfButton("Alpha", "board-shelf-rename"));
    const renameInput = await waitFor(() => {
      const input = document.querySelector<HTMLInputElement>(
        ".BoardShelf__renameForm input",
      );
      expect(input).toBeTruthy();
      return input!;
    });
    fireEvent.change(renameInput, { target: { value: "Alpha renamed" } });
    fireEvent.click(
      document.querySelector<HTMLElement>(
        "[data-testid='board-shelf-rename-submit']",
      )!,
    );
    await waitFor(() => expect(boardItem("Alpha renamed")).toBeTruthy());
    expect(bookmarkNames()).toEqual(["View on Alpha"]);
    expect(h.elements.map((el) => el.id)).toEqual(["a-rect"]);

    // the stored bookmarks are keyed by board id, never by display name
    const stored = localStorage.getItem(VIEWPORT_BOOKMARKS_STORAGE_KEY)!;
    expect(stored).not.toContain("Alpha renamed");
    expect(Object.keys(JSON.parse(stored))).toEqual([
      `/#board=${appJotaiStore.get(activeBoardAtom)!.id}`,
      expect.stringMatching(/^\/#board=/),
    ]);

    // reload: a new editor picks the active board up from storage
    unmountComponent();
    act(() => syncActiveBoardFromStorage());
    await render(<ExcalidrawApp />);
    await openBookmarks();
    expect(bookmarkNames()).toEqual(["View on Alpha"]);
  });
});

import React from "react";

import { KEYS, MAX_ZOOM, reseed } from "@excalidraw/common";

import { Excalidraw } from "../index";
import {
  VIEWPORT_BOOKMARKS_STORAGE_KEY,
  clearUnsavedViewportBookmarks,
  createViewportBookmark,
  getBoardKey,
  getBookmarkViewport,
  getDefaultBookmarkName,
  loadViewportBookmarks,
  updateViewportBookmarks,
} from "../components/ViewportBookmarks/viewportBookmarkStore";
import { openViewportBookmarks } from "../components/ViewportBookmarks/ViewportBookmarks";

import { API } from "./helpers/api";
import {
  act,
  fireEvent,
  render,
  screen,
  unmountComponent,
  waitFor,
} from "./test-utils";

import type { NormalizedZoomValue } from "../types";

const { h } = window;

const getPanel = () =>
  document.querySelector<HTMLElement>("[data-testid='viewport-bookmarks']");

const getError = () =>
  document.querySelector("[data-testid='viewport-bookmarks-error']");

const getBookmarkButton = (name: string) =>
  screen.getByRole("button", { name });

const open = async () => {
  act(() => openViewportBookmarks(h.app));
  await waitFor(() => expect(getPanel()).not.toBeNull());
};

const saveView = (name: string) => {
  const input = screen.getByLabelText("Bookmark name");
  fireEvent.change(input, { target: { value: name } });
  fireEvent.submit(input.closest("form")!);
};

const setCamera = (scrollX: number, scrollY: number, zoom: number) =>
  act(() => {
    h.setState({
      scrollX,
      scrollY,
      zoom: { value: zoom as NormalizedZoomValue },
    });
  });

const storedFor = (boardKey = getBoardKey()) =>
  JSON.parse(localStorage.getItem(VIEWPORT_BOOKMARKS_STORAGE_KEY) ?? "{}")[
    boardKey
  ];

describe("viewport bookmark helpers", () => {
  beforeEach(() => {
    localStorage.clear();
    clearUnsavedViewportBookmarks();
  });

  it("keys boards by path and hash id, never the room key", () => {
    expect(getBoardKey({ pathname: "/", hash: "" })).toBe("/");
    expect(getBoardKey({ pathname: "/", hash: "#room=abc,secretkey" })).toBe(
      "/#room=abc",
    );
    expect(getBoardKey({ pathname: "/", hash: "#json=x,key" })).toBe(
      "/#json=x",
    );
  });

  it("keys boards that share a URL by the host's board id", () => {
    const location = { pathname: "/", hash: "" };
    expect(getBoardKey(location, "a")).toBe("/#board=a");
    expect(getBoardKey(location, "b")).toBe("/#board=b");
    expect(getBoardKey(location, null)).toBe("/");
    // a room is its own board, whatever local board was open before
    expect(getBoardKey({ pathname: "/", hash: "#room=r,key" }, "a")).toBe(
      "/#room=r",
    );
  });

  it("restores the saved centre at any viewport size", () => {
    const bookmark = createViewportBookmark("A", {
      scrollX: -100,
      scrollY: -50,
      zoom: { value: 2 as NormalizedZoomValue },
      width: 800,
      height: 600,
    });
    expect(bookmark).toMatchObject({ centerX: 300, centerY: 200, zoom: 2 });

    const restored = getBookmarkViewport(bookmark, { width: 400, height: 300 });
    expect(restored.zoom.value).toBe(2);
    // the saved centre is in the middle of the smaller viewport
    expect(400 / 2 / 2 - restored.scrollX).toBeCloseTo(300);
    expect(300 / 2 / 2 - restored.scrollY).toBeCloseTo(200);
  });

  it("clamps restored zoom to the editor range", () => {
    const viewport = getBookmarkViewport(
      { id: "a", name: "A", centerX: 0, centerY: 0, zoom: 1000 },
      { width: 100, height: 100 },
    );
    expect(viewport.zoom.value).toBe(MAX_ZOOM);
  });

  it("keeps each board's bookmarks separate", () => {
    const bookmark = { id: "a", name: "A", centerX: 1, centerY: 2, zoom: 1 };
    updateViewportBookmarks("/#room=one", { type: "add", bookmark });
    updateViewportBookmarks("/#room=two", {
      type: "add",
      bookmark: { ...bookmark, id: "b" },
    });
    updateViewportBookmarks("/#room=two", {
      type: "remove",
      id: "b",
      name: "A",
    });
    expect(loadViewportBookmarks("/#room=one").value).toEqual([bookmark]);
    expect(loadViewportBookmarks("/#room=two").value).toEqual([]);
  });

  it("drops stored entries that are not usable bookmarks", () => {
    localStorage.setItem(
      VIEWPORT_BOOKMARKS_STORAGE_KEY,
      JSON.stringify({
        "/": [
          { id: "ok", name: "  Fine  ", centerX: 1, centerY: 1, zoom: 1 },
          { id: "nan", name: "x", centerX: null, centerY: 1, zoom: 1 },
          { id: "zero", name: "x", centerX: 1, centerY: 1, zoom: 0 },
          { id: "blank", name: "   ", centerX: 1, centerY: 1, zoom: 1 },
          "junk",
        ],
      }),
    );
    expect(loadViewportBookmarks("/")).toEqual({
      error: null,
      rejected: [],
      value: [{ id: "ok", name: "Fine", centerX: 1, centerY: 1, zoom: 1 }],
    });
  });

  it("reports unreadable storage instead of throwing", () => {
    localStorage.setItem(VIEWPORT_BOOKMARKS_STORAGE_KEY, "{not json");
    expect(loadViewportBookmarks("/")).toEqual({
      error: "load",
      rejected: [],
      value: [],
    });
    // a later save replaces the corrupt data
    expect(
      updateViewportBookmarks("/", {
        type: "add",
        bookmark: { id: "a", name: "A", centerX: 0, centerY: 0, zoom: 1 },
      }).error,
    ).toBe(null);
  });

  it("replays failed changes onto other tabs' stored changes", () => {
    const at = (id: string, name = id) => ({
      id,
      name,
      centerX: 0,
      centerY: 0,
      zoom: 1,
    });
    updateViewportBookmarks("/", { type: "add", bookmark: at("keep") });
    updateViewportBookmarks("/", { type: "add", bookmark: at("gone") });
    const stored = localStorage.getItem(VIEWPORT_BOOKMARKS_STORAGE_KEY)!;

    // this tab's writes fail
    const setItem = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    updateViewportBookmarks("/", { type: "add", bookmark: at("mine") });
    updateViewportBookmarks("/", {
      type: "rename",
      id: "keep",
      from: "keep",
      name: "Kept",
    });
    setItem.mockRestore();

    // meanwhile another tab adds one and removes another
    localStorage.setItem(
      VIEWPORT_BOOKMARKS_STORAGE_KEY,
      JSON.stringify({ "/": [...JSON.parse(stored)["/"], at("other")] }),
    );
    localStorage.setItem(
      VIEWPORT_BOOKMARKS_STORAGE_KEY,
      JSON.stringify({
        "/": JSON.parse(localStorage.getItem(VIEWPORT_BOOKMARKS_STORAGE_KEY)!)[
          "/"
        ].filter((entry: { id: string }) => entry.id !== "gone"),
      }),
    );

    const loaded = loadViewportBookmarks("/");
    expect(loaded.error).toBe("save");
    expect(loaded.value.map((entry) => entry.name)).toEqual([
      "Kept",
      "other",
      "mine",
    ]);

    // the next successful write stores both tabs' changes
    const result = updateViewportBookmarks("/", {
      type: "add",
      bookmark: at("later"),
    });
    expect(result).toMatchObject({ error: null, rejected: [] });
    expect(storedFor("/").map((entry: { name: string }) => entry.name)).toEqual(
      ["Kept", "other", "mine", "later"],
    );
    vi.restoreAllMocks();
  });

  it("reports changes another tab made impossible instead of applying them", () => {
    const at = (id: string, name = id) => ({
      id,
      name,
      centerX: 0,
      centerY: 0,
      zoom: 1,
    });
    // another tab removed "a" and renamed "b" after this tab loaded them
    localStorage.setItem(
      VIEWPORT_BOOKMARKS_STORAGE_KEY,
      JSON.stringify({ "/": [at("b", "Theirs")] }),
    );
    const rename = updateViewportBookmarks("/", {
      type: "rename",
      id: "a",
      from: "a",
      name: "Mine",
    });
    expect(rename.rejected).toMatchObject([{ reason: "missing" }]);
    const conflict = updateViewportBookmarks("/", {
      type: "rename",
      id: "b",
      from: "b",
      name: "Mine",
    });
    expect(conflict.rejected).toMatchObject([
      { reason: "conflict", current: { name: "Theirs" } },
    ]);
    const remove = updateViewportBookmarks("/", {
      type: "remove",
      id: "b",
      name: "b",
    });
    expect(remove.rejected).toMatchObject([{ reason: "conflict" }]);
    // nothing was recreated, renamed or removed
    expect(storedFor("/")).toEqual([at("b", "Theirs")]);
  });

  it("rejects an add over the limit instead of dropping it", () => {
    localStorage.setItem(
      VIEWPORT_BOOKMARKS_STORAGE_KEY,
      JSON.stringify({
        "/": Array.from({ length: 50 }, (_, index) => ({
          id: `${index}`,
          name: `View ${index}`,
          centerX: 0,
          centerY: 0,
          zoom: 1,
        })),
      }),
    );
    const result = updateViewportBookmarks("/", {
      type: "add",
      bookmark: { id: "new", name: "New", centerX: 0, centerY: 0, zoom: 1 },
    });
    expect(result.rejected).toMatchObject([{ reason: "limit" }]);
    expect(storedFor("/")).toHaveLength(50);
  });

  it("keeps pending changes while storage cannot be read", () => {
    const bookmark = (id: string, name: string) => ({
      id,
      name,
      centerX: 0,
      centerY: 0,
      zoom: 1,
    });
    localStorage.setItem(
      VIEWPORT_BOOKMARKS_STORAGE_KEY,
      JSON.stringify({
        "/": [bookmark("a", "A")],
        "/other": [bookmark("o", "O")],
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const setItem = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    updateViewportBookmarks("/", {
      type: "rename",
      id: "a",
      from: "A",
      name: "B",
    });
    const getItem = vi
      .spyOn(window.localStorage, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    const blind = updateViewportBookmarks("/", {
      type: "add",
      bookmark: bookmark("c", "C"),
    });
    // the rename is not rejected against an unknown list
    expect(blind).toMatchObject({ error: "save", rejected: [] });
    expect(blind.value.map((entry) => entry.name)).toEqual(["B", "C"]);
    expect(loadViewportBookmarks("/")).toMatchObject({
      error: "load",
      value: [{ name: "B" }, { name: "C" }],
    });
    getItem.mockRestore();
    setItem.mockRestore();

    // nothing was written while storage could not be read
    expect(storedFor("/")).toEqual([bookmark("a", "A")]);
    expect(
      updateViewportBookmarks("/", { type: "remove", id: "c", name: "C" }),
    ).toMatchObject({ error: null, rejected: [] });
    expect(storedFor("/")).toEqual([bookmark("a", "B")]);
    expect(storedFor("/other")).toEqual([bookmark("o", "O")]);
    vi.restoreAllMocks();
  });

  it("picks the first free default name", () => {
    const at = (name: string) => ({
      id: name,
      name,
      centerX: 0,
      centerY: 0,
      zoom: 1,
    });
    expect(getDefaultBookmarkName([], "View")).toBe("View 1");
    expect(getDefaultBookmarkName([at("View 2")], "View")).toBe("View 3");
  });
});

describe("<ViewportBookmarks/>", () => {
  beforeEach(async () => {
    localStorage.clear();
    clearUnsavedViewportBookmarks();
    window.history.replaceState({}, "", "/");
    unmountComponent();
    reseed(7);
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves and jumps without touching elements or history", async () => {
    const rect = API.createElement({ type: "rectangle", x: 10, y: 10 });
    API.setElements([rect]);
    const elementsBefore = h.elements;
    const versionBefore = h.elements[0].version;

    setCamera(-500, -300, 1.5);
    await open();
    saveView("Detail");
    expect(storedFor()).toHaveLength(1);

    const undoBefore = h.history.isUndoStackEmpty;
    setCamera(0, 0, 1);
    fireEvent.click(getBookmarkButton("Detail"));

    expect(h.state.scrollX).toBeCloseTo(-500);
    expect(h.state.scrollY).toBeCloseTo(-300);
    expect(h.state.zoom.value).toBe(1.5);
    expect(h.elements).toBe(elementsBefore);
    expect(h.elements[0].version).toBe(versionBefore);
    expect(h.history.isUndoStackEmpty).toBe(undoBefore);
  });

  it("names quick saves and lists bookmarks after reopening", async () => {
    await open();
    saveView("");
    saveView("  ");
    expect(getBookmarkButton("View 1")).toBeTruthy();
    expect(getBookmarkButton("View 2")).toBeTruthy();

    fireEvent.keyDown(getPanel()!, { key: KEYS.ESCAPE });
    expect(getPanel()).toBeNull();
    await open();
    expect(getBookmarkButton("View 2")).toBeTruthy();
  });

  it("renames with F2 and Enter, and Escape cancels a rename", async () => {
    await open();
    saveView("Old");

    fireEvent.keyDown(getBookmarkButton("Old"), { key: "F2" });
    const input = screen.getByLabelText("New name for Old");
    fireEvent.change(input, { target: { value: "Cancelled" } });
    fireEvent.keyDown(input, { key: KEYS.ESCAPE });
    expect(getPanel()).not.toBeNull();
    expect(getBookmarkButton("Old")).toBeTruthy();

    fireEvent.keyDown(getBookmarkButton("Old"), { key: "F2" });
    fireEvent.change(screen.getByLabelText("New name for Old"), {
      target: { value: "New" },
    });
    fireEvent.keyDown(screen.getByLabelText("New name for Old"), {
      key: KEYS.ENTER,
    });
    expect(getBookmarkButton("New")).toBeTruthy();
    expect(document.activeElement).toBe(getBookmarkButton("New"));
    expect(storedFor()[0].name).toBe("New");
  });

  it("removes with Delete and moves focus to the next bookmark", async () => {
    await open();
    saveView("One");
    saveView("Two");

    fireEvent.keyDown(getBookmarkButton("One"), { key: KEYS.DELETE });
    expect(screen.queryByRole("button", { name: "One" })).toBe(null);
    expect(document.activeElement).toBe(getBookmarkButton("Two"));
    expect(storedFor().map((b: { name: string }) => b.name)).toEqual(["Two"]);

    fireEvent.keyDown(getBookmarkButton("Two"), { key: KEYS.BACKSPACE });
    expect(storedFor()).toBeUndefined();
    expect(screen.getByText("No saved views yet.")).toBeTruthy();
  });

  it("does not trigger editor shortcuts while typing a name", async () => {
    await open();
    const input = screen.getByLabelText("Bookmark name");
    fireEvent.keyDown(input, { key: "r" });
    expect(h.state.activeTool.type).toBe("selection");
  });

  it("keeps working in memory when storage is full", async () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await open();
    saveView("Unsaved");

    expect(getError()?.textContent).toMatch(/unavailable or full/);
    expect(getBookmarkButton("Unsaved")).toBeTruthy();
    setCamera(0, 0, 1);
    fireEvent.click(getBookmarkButton("Unsaved"));
    expect(h.state.zoom.value).toBe(1);
  });

  it("keeps unsaved changes after the panel is closed and reopened", async () => {
    const setItem = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await open();
    saveView("Unsaved");

    fireEvent.keyDown(getPanel()!, { key: KEYS.ESCAPE });
    await open();
    expect(getBookmarkButton("Unsaved")).toBeTruthy();
    expect(getError()?.textContent).toMatch(/unavailable or full/);

    // once storage works again the next change stores the whole list
    setItem.mockRestore();
    saveView("Stored");
    expect(getError()).toBeNull();
    expect(storedFor().map((b: { name: string }) => b.name)).toEqual([
      "Unsaved",
      "Stored",
    ]);
  });

  it("keeps bookmarks another tab saved while the panel was open", async () => {
    await open();
    // another tab saves to the same board after this panel loaded
    updateViewportBookmarks(getBoardKey(), {
      type: "add",
      bookmark: {
        id: "other",
        name: "Other tab",
        centerX: 0,
        centerY: 0,
        zoom: 1,
      },
    });
    saveView("This tab");
    expect(storedFor().map((b: { name: string }) => b.name)).toEqual([
      "Other tab",
      "This tab",
    ]);
    expect(getBookmarkButton("Other tab")).toBeTruthy();
  });

  it("shows another tab's changes when storage changes", async () => {
    await open();
    updateViewportBookmarks(getBoardKey(), {
      type: "add",
      bookmark: {
        id: "other",
        name: "Other tab",
        centerX: 0,
        centerY: 0,
        zoom: 1,
      },
    });
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: VIEWPORT_BOOKMARKS_STORAGE_KEY }),
      );
    });
    expect(getBookmarkButton("Other tab")).toBeTruthy();
  });

  it("keeps another tab's changes made after a failed write", async () => {
    const setItem = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await open();
    saveView("Unsaved");
    fireEvent.keyDown(getPanel()!, { key: KEYS.ESCAPE });
    setItem.mockRestore();

    // another tab stores a bookmark while this tab's change is pending
    localStorage.setItem(
      VIEWPORT_BOOKMARKS_STORAGE_KEY,
      JSON.stringify({
        [getBoardKey()]: [
          { id: "other", name: "Other tab", centerX: 0, centerY: 0, zoom: 1 },
        ],
      }),
    );
    await open();
    expect(getBookmarkButton("Other tab")).toBeTruthy();
    expect(getBookmarkButton("Unsaved")).toBeTruthy();

    saveView("Stored");
    expect(storedFor().map((b: { name: string }) => b.name)).toEqual([
      "Other tab",
      "Unsaved",
      "Stored",
    ]);
  });

  it("reports a save the limit rejected instead of announcing it", async () => {
    await open();
    // another tab fills the board after this panel loaded
    localStorage.setItem(
      VIEWPORT_BOOKMARKS_STORAGE_KEY,
      JSON.stringify({
        [getBoardKey()]: Array.from({ length: 50 }, (_, index) => ({
          id: `${index}`,
          name: `Other ${index}`,
          centerX: 0,
          centerY: 0,
          zoom: 1,
        })),
      }),
    );
    saveView("Too many");
    expect(storedFor()).toHaveLength(50);
    expect(screen.queryByRole("button", { name: "Too many" })).toBe(null);
    expect(
      document.querySelector("[data-testid='viewport-bookmarks-rejected']")
        ?.textContent,
    ).toMatch(/Too many was not saved/);
    expect(
      screen.getByTestId("viewport-bookmarks-announcement").textContent,
    ).not.toMatch(/Saved view/);
    // the name is kept to retry
    expect(
      (screen.getByLabelText("Bookmark name") as HTMLInputElement).value,
    ).toBe("Too many");
  });

  it("reports a rename of a bookmark another tab removed", async () => {
    await open();
    saveView("Old");
    localStorage.setItem(VIEWPORT_BOOKMARKS_STORAGE_KEY, "{}");

    fireEvent.keyDown(getBookmarkButton("Old"), { key: "F2" });
    const input = screen.getByLabelText("New name for Old");
    fireEvent.change(input, { target: { value: "New" } });
    fireEvent.keyDown(input, { key: KEYS.ENTER });

    expect(storedFor()).toBeUndefined();
    expect(screen.queryByRole("button", { name: "New" })).toBe(null);
    expect(
      screen.getByTestId("viewport-bookmarks-announcement").textContent,
    ).toMatch(/removed in another tab/);
  });

  it("reports a rename another tab made while the rename was open", async () => {
    await open();
    saveView("Old");
    const [saved] = storedFor();

    fireEvent.keyDown(getBookmarkButton("Old"), { key: "F2" });
    const input = screen.getByLabelText("New name for Old");
    fireEvent.change(input, { target: { value: "Mine" } });
    // another tab renames it while the input is open
    localStorage.setItem(
      VIEWPORT_BOOKMARKS_STORAGE_KEY,
      JSON.stringify({ [getBoardKey()]: [{ ...saved, name: "Theirs" }] }),
    );
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: VIEWPORT_BOOKMARKS_STORAGE_KEY }),
      );
    });
    fireEvent.keyDown(screen.getByLabelText("New name for Theirs"), {
      key: KEYS.ENTER,
    });

    expect(storedFor()).toEqual([{ ...saved, name: "Theirs" }]);
    expect(
      screen.getByTestId("viewport-bookmarks-announcement").textContent,
    ).toMatch(/Theirs/);
    expect(screen.queryByRole("button", { name: "Mine" })).toBe(null);
  });

  it("leaves focus where the user moved it when a rename ends on blur", async () => {
    await open();
    saveView("Old");
    fireEvent.keyDown(getBookmarkButton("Old"), { key: "F2" });
    const input = screen.getByLabelText("New name for Old");
    fireEvent.change(input, { target: { value: "New" } });

    const nameInput = screen.getByLabelText("Bookmark name");
    act(() => nameInput.focus());
    fireEvent.blur(input);

    expect(getBookmarkButton("New")).toBeTruthy();
    expect(document.activeElement).toBe(nameInput);
  });

  it("says so when storage cannot be read", async () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await open();
    expect(getError()?.textContent).toMatch(/could not be read/);
  });
});

describe("<ViewportBookmarks/> board identity", () => {
  beforeEach(() => {
    localStorage.clear();
    clearUnsavedViewportBookmarks();
    window.history.replaceState({}, "", "/");
    unmountComponent();
    reseed(7);
  });

  it("keeps boards that share a URL apart, also while the panel is open", async () => {
    const { rerender } = await render(
      <Excalidraw handleKeyboardGlobally={true} boardId="board-a" />,
    );
    await open();
    saveView("On A");

    rerender(<Excalidraw handleKeyboardGlobally={true} boardId="board-b" />);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "On A" })).toBe(null),
    );
    saveView("On B");

    rerender(<Excalidraw handleKeyboardGlobally={true} boardId="board-a" />);
    await waitFor(() => expect(getBookmarkButton("On A")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "On B" })).toBe(null);
    expect(storedFor("/#board=a")).toBeUndefined();
    expect(storedFor("/#board=board-a")).toHaveLength(1);
    expect(storedFor("/#board=board-b")).toHaveLength(1);
  });

  it("follows a room started or left with pushState while open", async () => {
    const { rerender } = await render(
      <Excalidraw handleKeyboardGlobally={true} />,
    );
    await open();
    saveView("Local");

    // as Collab.startCollaboration does: pushState, then isCollaborating
    window.history.pushState({}, "", "/#room=abc,secret");
    rerender(<Excalidraw handleKeyboardGlobally={true} isCollaborating />);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Local" })).toBe(null),
    );
    saveView("In room");
    expect(storedFor("/#room=abc")).toHaveLength(1);

    window.history.pushState({}, "", "/");
    rerender(<Excalidraw handleKeyboardGlobally={true} />);
    await waitFor(() => expect(getBookmarkButton("Local")).toBeTruthy());
    expect(storedFor("/")).toHaveLength(1);
    expect(localStorage.getItem(VIEWPORT_BOOKMARKS_STORAGE_KEY)).not.toContain(
      "secret",
    );
  });
});

import React from "react";

import { KEYS, MAX_ZOOM, reseed } from "@excalidraw/common";

import { Excalidraw } from "../index";
import {
  VIEWPORT_BOOKMARKS_STORAGE_KEY,
  createViewportBookmark,
  getBoardKey,
  getBookmarkViewport,
  getDefaultBookmarkName,
  loadViewportBookmarks,
  saveViewportBookmarks,
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
  beforeEach(() => localStorage.clear());

  it("keys boards by path and hash id, never the room key", () => {
    expect(getBoardKey({ pathname: "/", hash: "" })).toBe("/");
    expect(getBoardKey({ pathname: "/", hash: "#room=abc,secretkey" })).toBe(
      "/#room=abc",
    );
    expect(getBoardKey({ pathname: "/", hash: "#json=x,key" })).toBe(
      "/#json=x",
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
    saveViewportBookmarks("/#room=one", [bookmark]);
    saveViewportBookmarks("/#room=two", []);
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
      ok: true,
      value: [{ id: "ok", name: "Fine", centerX: 1, centerY: 1, zoom: 1 }],
    });
  });

  it("reports unreadable storage instead of throwing", () => {
    localStorage.setItem(VIEWPORT_BOOKMARKS_STORAGE_KEY, "{not json");
    expect(loadViewportBookmarks("/")).toEqual({ ok: false, value: [] });
    // a later save replaces the corrupt data
    expect(saveViewportBookmarks("/", []).ok).toBe(true);
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

  it("says so when storage cannot be read", async () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await open();
    expect(getError()?.textContent).toMatch(/could not be read/);
  });
});

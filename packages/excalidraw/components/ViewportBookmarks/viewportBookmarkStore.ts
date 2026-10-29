import { randomId } from "@excalidraw/common";

import { getNormalizedZoom } from "../../scene/normalize";
import { centerScrollOn } from "../../scene/scroll";

import type { AppState } from "../../types";

/** one localStorage entry holds the bookmarks of every board, keyed by board */
export const VIEWPORT_BOOKMARKS_STORAGE_KEY = "excalidraw-viewport-bookmarks";

export const MAX_BOOKMARK_NAME_LENGTH = 60;
export const MAX_BOOKMARKS_PER_BOARD = 50;

/**
 * A saved camera: the scene point at the centre of the viewport and the zoom.
 * Storing the centre rather than the scroll offset keeps the same part of the
 * board in view when the window size differs on restore.
 */
export type ViewportBookmark = {
  id: string;
  name: string;
  centerX: number;
  centerY: number;
  zoom: number;
};

type StoredBookmarks = Record<string, ViewportBookmark[]>;

/**
 * Bookmarks belong to the board open in this browser only. A collaboration
 * room (`#room=<id>,<key>`) or shared link (`#json=<id>,<key>`) is keyed by
 * its id, so the encryption key is never written to storage. Otherwise the
 * host's `boardId` tells apart boards that share a URL, such as the app's
 * local boards.
 */
export const getBoardKey = (
  location: Pick<Location, "pathname" | "hash"> = window.location,
  boardId?: string | null,
) => {
  const hashId = location.hash.split(",")[0];
  if (hashId) {
    return `${location.pathname}${hashId}`;
  }
  return boardId ? `${location.pathname}#board=${boardId}` : location.pathname;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const normalizeBookmarkName = (name: string) =>
  name.trim().replace(/\s+/g, " ").slice(0, MAX_BOOKMARK_NAME_LENGTH);

/** entries that are not usable bookmarks are dropped, never restored */
const parseBookmarks = (value: unknown): ViewportBookmark[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(
      (entry): entry is ViewportBookmark =>
        !!entry &&
        typeof entry.id === "string" &&
        typeof entry.name === "string" &&
        !!normalizeBookmarkName(entry.name) &&
        isFiniteNumber(entry.centerX) &&
        isFiniteNumber(entry.centerY) &&
        isFiniteNumber(entry.zoom) &&
        entry.zoom > 0,
    )
    .slice(0, MAX_BOOKMARKS_PER_BOARD)
    .map((entry) => ({
      id: entry.id,
      name: normalizeBookmarkName(entry.name),
      centerX: entry.centerX,
      centerY: entry.centerY,
      zoom: getNormalizedZoom(entry.zoom),
    }));
};

const readAll = (): StoredBookmarks => {
  const raw = window.localStorage.getItem(VIEWPORT_BOOKMARKS_STORAGE_KEY);
  if (!raw) {
    return {};
  }
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed
    : {};
};

/**
 * Lists whose last write failed, by board. They are what the user sees until
 * reload, so a closed and reopened panel does not lose them.
 */
const unsavedBookmarks = new Map<string, ViewportBookmark[]>();

export const clearUnsavedViewportBookmarks = () => unsavedBookmarks.clear();

export type BookmarkLoadResult = {
  value: ViewportBookmark[];
  /** "load": storage could not be read. "save": the list is not stored yet */
  error: "load" | "save" | null;
};

/** bookmarks of one board, from the unsaved list when a write failed */
export const loadViewportBookmarks = (boardKey: string): BookmarkLoadResult => {
  const unsaved = unsavedBookmarks.get(boardKey);
  if (unsaved) {
    return { value: unsaved, error: "save" };
  }
  try {
    return { value: parseBookmarks(readAll()[boardKey]), error: null };
  } catch (error: any) {
    console.warn(`viewport bookmarks: could not read: ${error.message}`);
    return { value: [], error: "load" };
  }
};

/**
 * Applies `update` to the board's current list, read again now so changes
 * another tab stored since the panel loaded are kept, and stores the result.
 * Other boards are left alone. When storage is unavailable or full the result
 * is kept in memory until reload.
 */
export const updateViewportBookmarks = (
  boardKey: string,
  update: (bookmarks: ViewportBookmark[]) => ViewportBookmark[],
): BookmarkLoadResult => {
  let all: StoredBookmarks;
  try {
    all = readAll();
  } catch {
    // unreadable data is replaced rather than blocking every later save
    all = {};
  }
  const next = update(
    unsavedBookmarks.get(boardKey) ?? parseBookmarks(all[boardKey]),
  ).slice(0, MAX_BOOKMARKS_PER_BOARD);
  try {
    if (next.length) {
      all[boardKey] = next;
    } else {
      delete all[boardKey];
    }
    window.localStorage.setItem(
      VIEWPORT_BOOKMARKS_STORAGE_KEY,
      JSON.stringify(all),
    );
    unsavedBookmarks.delete(boardKey);
    return { value: next, error: null };
  } catch (error: any) {
    console.warn(`viewport bookmarks: could not save: ${error.message}`);
    unsavedBookmarks.set(boardKey, next);
    return { value: next, error: "save" };
  }
};

/** the first free "View N" name, so quick saves do not collide */
export const getDefaultBookmarkName = (
  bookmarks: readonly ViewportBookmark[],
  prefix: string,
) => {
  const names = new Set(bookmarks.map((bookmark) => bookmark.name));
  let index = bookmarks.length + 1;
  while (names.has(`${prefix} ${index}`)) {
    index++;
  }
  return `${prefix} ${index}`;
};

export const createViewportBookmark = (
  name: string,
  appState: Pick<AppState, "scrollX" | "scrollY" | "zoom" | "width" | "height">,
): ViewportBookmark => {
  const zoom = appState.zoom.value;
  return {
    id: randomId(),
    name: normalizeBookmarkName(name),
    centerX: appState.width / 2 / zoom - appState.scrollX,
    centerY: appState.height / 2 / zoom - appState.scrollY,
    zoom,
  };
};

/**
 * The scroll and zoom that put the bookmark's centre in the middle of the
 * current viewport. Zoom is clamped to the editor's range.
 */
export const getBookmarkViewport = (
  bookmark: ViewportBookmark,
  appState: Pick<AppState, "width" | "height">,
): Pick<AppState, "scrollX" | "scrollY" | "zoom"> => {
  const zoom = { value: getNormalizedZoom(bookmark.zoom) };
  return {
    ...centerScrollOn({
      scenePoint: { x: bookmark.centerX, y: bookmark.centerY },
      viewportDimensions: { width: appState.width, height: appState.height },
      zoom,
    }),
    zoom,
  };
};

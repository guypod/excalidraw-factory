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

export type BookmarkStorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; value: T };

/**
 * Bookmarks belong to the board open at this URL, in this browser only. The
 * board is the page path plus the first part of the hash, so a collaboration
 * room (`#room=<id>,<key>`) or shared link (`#json=<id>,<key>`) gets its own
 * bookmarks and the encryption key is never written to storage.
 */
export const getBoardKey = (
  location: Pick<Location, "pathname" | "hash"> = window.location,
) => {
  const hashId = location.hash.split(",")[0];
  return `${location.pathname}${hashId}`;
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

/** bookmarks of one board; `ok` is false when storage could not be read */
export const loadViewportBookmarks = (
  boardKey: string,
): BookmarkStorageResult<ViewportBookmark[]> => {
  try {
    return { ok: true, value: parseBookmarks(readAll()[boardKey]) };
  } catch (error: any) {
    console.warn(`viewport bookmarks: could not read: ${error.message}`);
    return { ok: false, value: [] };
  }
};

/**
 * Replaces one board's bookmarks and leaves other boards' alone. `ok` is false
 * when storage is unavailable or full; the caller keeps its in-memory list.
 */
export const saveViewportBookmarks = (
  boardKey: string,
  bookmarks: readonly ViewportBookmark[],
): BookmarkStorageResult<null> => {
  try {
    let all: StoredBookmarks;
    try {
      all = readAll();
    } catch {
      // unreadable data is replaced rather than blocking every later save
      all = {};
    }
    if (bookmarks.length) {
      all[boardKey] = [...bookmarks];
    } else {
      delete all[boardKey];
    }
    window.localStorage.setItem(
      VIEWPORT_BOOKMARKS_STORAGE_KEY,
      JSON.stringify(all),
    );
    return { ok: true, value: null };
  } catch (error: any) {
    console.warn(`viewport bookmarks: could not save: ${error.message}`);
    return { ok: false, value: null };
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

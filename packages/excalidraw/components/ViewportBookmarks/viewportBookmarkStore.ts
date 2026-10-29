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
 * A change made in this tab. Renames and removals carry the name the user saw,
 * so a bookmark another tab renamed meanwhile is reported, not overwritten.
 */
export type BookmarkOperation =
  | { type: "add"; bookmark: ViewportBookmark }
  | { type: "rename"; id: string; from: string; name: string }
  | { type: "remove"; id: string; name: string };

/**
 * A change that was not applied. "limit": the board already has the maximum.
 * "missing": another tab removed the bookmark. "conflict": another tab renamed
 * it, `current` is its name now.
 */
export type RejectedBookmarkOperation = {
  operation: BookmarkOperation;
  reason: "limit" | "missing" | "conflict";
  current?: ViewportBookmark;
};

export type BookmarkLoadResult = {
  value: ViewportBookmark[];
  /** "load": storage could not be read. "save": changes are not stored yet */
  error: "load" | "save" | null;
  /** this tab's changes that could not be applied to the current list */
  rejected: RejectedBookmarkOperation[];
};

/**
 * Applies `operations` in order to `bookmarks`, the board's list as stored
 * now, so other tabs' additions, renames and removals are kept.
 */
const replayOperations = (
  bookmarks: ViewportBookmark[],
  operations: readonly BookmarkOperation[],
) => {
  let value = bookmarks;
  const applied: BookmarkOperation[] = [];
  const rejected: RejectedBookmarkOperation[] = [];
  for (const operation of operations) {
    if (operation.type === "add") {
      if (value.some((entry) => entry.id === operation.bookmark.id)) {
        applied.push(operation);
      } else if (value.length >= MAX_BOOKMARKS_PER_BOARD) {
        rejected.push({ operation, reason: "limit" });
      } else {
        value = [...value, operation.bookmark];
        applied.push(operation);
      }
      continue;
    }
    const current = value.find((entry) => entry.id === operation.id);
    const expectedName =
      operation.type === "rename" ? operation.from : operation.name;
    if (!current) {
      rejected.push({ operation, reason: "missing" });
    } else if (operation.type === "rename" && current.name === operation.name) {
      applied.push(operation);
    } else if (current.name !== expectedName) {
      rejected.push({ operation, reason: "conflict", current });
    } else {
      value =
        operation.type === "rename"
          ? value.map((entry) =>
              entry === current ? { ...entry, name: operation.name } : entry,
            )
          : value.filter((entry) => entry !== current);
      applied.push(operation);
    }
  }
  return { value, applied, rejected };
};

/**
 * Changes whose write failed, by board. They are replayed onto the stored list
 * on every load and write until one write succeeds or the page reloads, so a
 * closed and reopened panel keeps them and other tabs' changes are not lost.
 */
const pendingOperations = new Map<string, BookmarkOperation[]>();

export const clearUnsavedViewportBookmarks = () => pendingOperations.clear();

/** bookmarks of one board, with this tab's unsaved changes applied */
export const loadViewportBookmarks = (boardKey: string): BookmarkLoadResult => {
  let stored: ViewportBookmark[];
  try {
    stored = parseBookmarks(readAll()[boardKey]);
  } catch (error: any) {
    console.warn(`viewport bookmarks: could not read: ${error.message}`);
    return { value: [], error: "load", rejected: [] };
  }
  const pending = pendingOperations.get(boardKey);
  if (!pending) {
    return { value: stored, error: null, rejected: [] };
  }
  const { value, applied, rejected } = replayOperations(stored, pending);
  // a change another tab made impossible is reported once, then dropped
  if (applied.length) {
    pendingOperations.set(boardKey, applied);
  } else {
    pendingOperations.delete(boardKey);
  }
  return { value, error: applied.length ? "save" : null, rejected };
};

/**
 * Applies `operation`, after this tab's unsaved changes, to the board's list
 * as stored now and stores the result. Other boards are left alone. When
 * storage is unavailable or full the applied changes are kept to replay later.
 */
export const updateViewportBookmarks = (
  boardKey: string,
  operation: BookmarkOperation,
): BookmarkLoadResult => {
  let all: StoredBookmarks;
  try {
    all = readAll();
  } catch {
    // unreadable data is replaced rather than blocking every later save
    all = {};
  }
  const { value, applied, rejected } = replayOperations(
    parseBookmarks(all[boardKey]),
    [...(pendingOperations.get(boardKey) ?? []), operation],
  );
  try {
    if (value.length) {
      all[boardKey] = value;
    } else {
      delete all[boardKey];
    }
    window.localStorage.setItem(
      VIEWPORT_BOOKMARKS_STORAGE_KEY,
      JSON.stringify(all),
    );
    pendingOperations.delete(boardKey);
    return { value, error: null, rejected };
  } catch (error: any) {
    console.warn(`viewport bookmarks: could not save: ${error.message}`);
    if (applied.length) {
      pendingOperations.set(boardKey, applied);
    } else {
      pendingOperations.delete(boardKey);
    }
    return { value, error: applied.length ? "save" : null, rejected };
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

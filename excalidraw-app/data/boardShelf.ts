/**
 * Named boards saved locally to this browser (IndexedDB). Nothing here is
 * sent over the network: boards are not synced or backed up anywhere.
 *
 * Each board record holds its elements, the persistable part of appState and
 * the binary files its image elements reference, so a board reloads with its
 * images even after the shared `files-db` cache has been cleaned up.
 */

import { cleanAppStateForExport } from "@excalidraw/excalidraw/appState";
import {
  restoreAppState,
  restoreElements,
} from "@excalidraw/excalidraw/data/restore";
import { randomId } from "@excalidraw/common";
import {
  getNonDeletedElements,
  isInitializedImageElement,
} from "@excalidraw/element";
import { createStore, del, entries, get, update } from "idb-keyval";

import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
} from "@excalidraw/excalidraw/types";

import { appJotaiStore, atom } from "../app-jotai";
import { STORAGE_KEYS } from "../app_constants";

const BOARD_RECORD_VERSION = 1;

const boardsStore = createStore(
  `${STORAGE_KEYS.IDB_BOARDS}-db`,
  `${STORAGE_KEYS.IDB_BOARDS}-store`,
);

export type BoardRecord = {
  version: typeof BOARD_RECORD_VERSION;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
};

export type BoardSummary = {
  id: string;
  name: string;
  updatedAt: number;
};

/** a stored entry we could not parse. It is listed, never auto-deleted */
export type UnreadableBoard = { id: string };

/** the saved board the canvas was last saved to or opened from */
export type ActiveBoard = {
  id: string;
  name: string;
};

export class BoardShelfError extends Error {
  constructor(
    public readonly code: "quota" | "unavailable" | "corrupt" | "notFound",
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BoardShelfError";
  }
}

const isQuotaExceededError = (error: any) =>
  error?.name === "QuotaExceededError" ||
  error?.inner?.name === "QuotaExceededError";

const toShelfError = (error: unknown): BoardShelfError => {
  if (error instanceof BoardShelfError) {
    return error;
  }
  if (isQuotaExceededError(error)) {
    return new BoardShelfError(
      "quota",
      "Browser storage is full. The board was not saved.",
      error,
    );
  }
  return new BoardShelfError(
    "unavailable",
    "Browser storage is unavailable. The board was not saved.",
    error,
  );
};

export const normalizeBoardName = (name: string) =>
  name.replace(/\s+/g, " ").trim().slice(0, 100);

const isObject = (value: any) => !!value && typeof value === "object";

export const isBoardRecord = (value: any): value is BoardRecord =>
  isObject(value) &&
  value.version === BOARD_RECORD_VERSION &&
  typeof value.id === "string" &&
  typeof value.name === "string" &&
  typeof value.updatedAt === "number" &&
  Array.isArray(value.elements) &&
  value.elements.every(
    (element: any) =>
      isObject(element) &&
      typeof element.id === "string" &&
      typeof element.type === "string",
  ) &&
  !!value.appState &&
  typeof value.appState === "object" &&
  !!value.files &&
  typeof value.files === "object" &&
  Object.values(value.files).every(isObject);

/**
 * Returns the files referenced by image elements, and the file ids that are
 * referenced but not available, so callers can tell the user.
 */
export const getReferencedFiles = (
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles,
) => {
  const referencedFiles: BinaryFiles = {};
  const missingFileIds: FileId[] = [];
  for (const element of elements) {
    if (isInitializedImageElement(element) && !element.isDeleted) {
      const file = files[element.fileId];
      if (file) {
        referencedFiles[element.fileId] = file;
      } else if (!missingFileIds.includes(element.fileId)) {
        missingFileIds.push(element.fileId);
      }
    }
  }
  return { referencedFiles, missingFileIds };
};

export const BoardShelf = {
  /** lists readable boards (most recently updated first) and unreadable ids */
  list: async (): Promise<{
    boards: BoardSummary[];
    unreadable: UnreadableBoard[];
  }> => {
    let all: [IDBValidKey, unknown][];
    try {
      all = await entries(boardsStore);
    } catch (error) {
      throw new BoardShelfError(
        "unavailable",
        "Browser storage is unavailable, so saved boards cannot be listed.",
        error,
      );
    }
    const boards: BoardSummary[] = [];
    const unreadable: UnreadableBoard[] = [];
    for (const [key, value] of all) {
      if (isBoardRecord(value) && value.id === key) {
        boards.push({
          id: value.id,
          name: value.name,
          updatedAt: value.updatedAt,
        });
      } else {
        unreadable.push({ id: String(key) });
      }
    }
    boards.sort((a, b) => b.updatedAt - a.updatedAt);
    return { boards, unreadable };
  },

  load: async (id: string): Promise<BoardRecord> => {
    let value: unknown;
    try {
      value = await get(id, boardsStore);
    } catch (error) {
      throw new BoardShelfError(
        "unavailable",
        "Browser storage is unavailable, so the board cannot be opened.",
        error,
      );
    }
    if (value === undefined) {
      throw new BoardShelfError("notFound", "This board no longer exists.");
    }
    if (!isBoardRecord(value)) {
      throw new BoardShelfError(
        "corrupt",
        "This board's stored data is unreadable, so it was not opened.",
      );
    }
    return value;
  },

  /**
   * Saves the scene. With `id`, overwrites that board (keeping its name and
   * createdAt); otherwise creates a new one. A failed write leaves any
   * previously stored version of the board intact.
   *
   * When overwriting, images whose data isn't loaded on the canvas keep the
   * copy already stored with the board, so a save never drops image data the
   * board had. The read and write happen in one transaction.
   */
  save: async ({
    id,
    name,
    elements,
    appState,
    files,
  }: {
    id?: string;
    name: string;
    elements: readonly ExcalidrawElement[];
    appState: Partial<AppState>;
    files: BinaryFiles;
  }): Promise<{ record: BoardRecord; missingFileIds: FileId[] }> => {
    const nonDeletedElements = getNonDeletedElements(elements);
    const { referencedFiles, missingFileIds: missingOnCanvas } =
      getReferencedFiles(nonDeletedElements, files);

    const now = Date.now();
    let record: BoardRecord | null = null;
    let missingFileIds = missingOnCanvas;
    const boardId = id ?? randomId();

    try {
      await update(
        boardId,
        (existing) => {
          const previous = id && isBoardRecord(existing) ? existing : null;
          const boardFiles = { ...referencedFiles };
          missingFileIds = missingOnCanvas.filter((fileId) => {
            const storedFile = previous?.files[fileId];
            if (storedFile) {
              boardFiles[fileId] = storedFile;
              return false;
            }
            return true;
          });
          record = {
            version: BOARD_RECORD_VERSION,
            id: boardId,
            name: normalizeBoardName(name),
            createdAt: previous?.createdAt ?? now,
            updatedAt: now,
            elements: nonDeletedElements,
            appState: cleanAppStateForExport(appState),
            files: boardFiles,
          };
          return record;
        },
        boardsStore,
      );
    } catch (error) {
      throw toShelfError(error);
    }
    return { record: record!, missingFileIds };
  },

  /**
   * Changes only the name, reading and writing in one transaction so a save
   * committed from another tab is never replaced by an older snapshot.
   */
  rename: async (id: string, name: string): Promise<BoardRecord> => {
    let renamed: BoardRecord | null = null;
    try {
      await update(
        id,
        (existing) => {
          if (existing === undefined) {
            throw new BoardShelfError(
              "notFound",
              "This board no longer exists.",
            );
          }
          if (!isBoardRecord(existing)) {
            throw new BoardShelfError(
              "corrupt",
              "This board's stored data is unreadable, so it was not renamed.",
            );
          }
          renamed = { ...existing, name: normalizeBoardName(name) };
          return renamed;
        },
        boardsStore,
      );
    } catch (error) {
      throw toShelfError(error);
    }
    return renamed!;
  },

  delete: async (id: string) => {
    try {
      await del(id, boardsStore);
    } catch (error) {
      throw new BoardShelfError(
        "unavailable",
        "Browser storage is unavailable, so the board was not deleted.",
        error,
      );
    }
  },
};

/** files stored with a board, as an array for `excalidrawAPI.addFiles()` */
export const getBoardFiles = (record: BoardRecord): BinaryFileData[] =>
  Object.values(record.files);

// active board (which saved board the canvas currently represents) ----------

export const loadActiveBoard = (): ActiveBoard | null => {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ACTIVE_BOARD);
    if (data) {
      const parsed = JSON.parse(data);
      if (typeof parsed?.id === "string" && typeof parsed?.name === "string") {
        return parsed;
      }
    }
  } catch (error: any) {
    console.error(error);
  }
  return null;
};

export const saveActiveBoard = (activeBoard: ActiveBoard | null) => {
  try {
    if (activeBoard) {
      localStorage.setItem(
        STORAGE_KEYS.LOCAL_STORAGE_ACTIVE_BOARD,
        JSON.stringify(activeBoard),
      );
    } else {
      localStorage.removeItem(STORAGE_KEYS.LOCAL_STORAGE_ACTIVE_BOARD);
    }
  } catch (error: any) {
    // the active board is a convenience: losing it only loses dirty tracking
    console.error(error);
  }
};

export const activeBoardAtom = atom<ActiveBoard | null>(loadActiveBoard());

/**
 * Call when the canvas is replaced with the scene another tab saved. The
 * active board is stored together with that scene (see `LocalData`), so this
 * keeps the board identity matching the canvas it now shows.
 */
export const syncActiveBoardFromStorage = () => {
  appJotaiStore.set(activeBoardAtom, loadActiveBoard());
};

// fields that change without the user editing (image upload status, version
// bookkeeping), so they don't count as unsaved changes
const comparableElements = (elements: readonly ExcalidrawElement[]) =>
  JSON.stringify(
    getNonDeletedElements(elements).map(
      ({ version, versionNonce, updated, ...rest }) => {
        if ("status" in rest) {
          const { status, ...withoutStatus } = rest;
          return withoutStatus;
        }
        return rest;
      },
    ),
  );

// persisted scene settings that opening a board replaces (background, grid)
const comparableAppState = (appState: Partial<AppState>) => {
  const exported = cleanAppStateForExport(appState) as Record<string, unknown>;
  return JSON.stringify(
    Object.keys(exported)
      .sort()
      .map((key) => [key, exported[key]]),
  );
};

/**
 * Whether the canvas has work that is not saved to a board: anything that
 * differs from the active board's stored elements or scene settings, or any
 * content when there is no active board. If the active board can't be read,
 * the canvas counts as unsaved so callers ask before replacing it.
 */
export const hasUnsavedBoardChanges = async (
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  activeBoard: ActiveBoard | null,
) => {
  if (!getNonDeletedElements(elements).length && !activeBoard) {
    return false;
  }
  if (!activeBoard) {
    return true;
  }
  try {
    const record = await BoardShelf.load(activeBoard.id);
    // restore both sides, so normalization done on open isn't seen as edits
    const restore = (els: readonly ExcalidrawElement[]) =>
      restoreElements(els, null, { repairBindings: true });
    return (
      comparableElements(restore(record.elements)) !==
        comparableElements(restore(elements)) ||
      comparableAppState(restoreAppState(record.appState, null)) !==
        comparableAppState(restoreAppState(appState, null))
    );
  } catch {
    return true;
  }
};

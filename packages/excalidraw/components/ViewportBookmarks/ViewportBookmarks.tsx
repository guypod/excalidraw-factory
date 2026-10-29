import { useEffect, useRef, useState } from "react";

import { KEYS } from "@excalidraw/common";

import { atom, editorJotaiStore, useAtomValue } from "../../editor-jotai";
import { t } from "../../i18n";
import { useApp, useAppProps } from "../App";
import { CloseIcon, TrashIcon, pencilIcon } from "../icons";

import {
  MAX_BOOKMARKS_PER_BOARD,
  MAX_BOOKMARK_NAME_LENGTH,
  createViewportBookmark,
  getBoardKey,
  getBookmarkViewport,
  getDefaultBookmarkName,
  VIEWPORT_BOOKMARKS_STORAGE_KEY,
  loadViewportBookmarks,
  normalizeBookmarkName,
  updateViewportBookmarks,
} from "./viewportBookmarkStore";

import "./ViewportBookmarks.scss";

import type {
  BookmarkLoadResult,
  BookmarkOperation,
  RejectedBookmarkOperation,
  ViewportBookmark,
} from "./viewportBookmarkStore";

import type { AppClassProperties } from "../../types";

/**
 * Every editor shares one jotai store, so the open panel records which editor
 * opened it and only that editor shows it.
 */
export const viewportBookmarksAtom = atom<{
  editorId: AppClassProperties["id"];
} | null>(null);

/** why one of this tab's changes did not apply, in words */
const describeRejection = ({
  operation,
  reason,
  current,
}: RejectedBookmarkOperation) => {
  if (operation.type === "add") {
    return t("viewportBookmarks.limitReached", {
      name: operation.bookmark.name,
      max: MAX_BOOKMARKS_PER_BOARD,
    });
  }
  if (reason === "conflict" && current) {
    return operation.type === "rename"
      ? t("viewportBookmarks.renameConflict", {
          name: operation.from,
          newName: operation.name,
          current: current.name,
        })
      : t("viewportBookmarks.removeConflict", {
          name: operation.name,
          current: current.name,
        });
  }
  return operation.type === "rename"
    ? t("viewportBookmarks.renameMissing", {
        name: operation.from,
        newName: operation.name,
      })
    : t("viewportBookmarks.removeMissing", { name: operation.name });
};

/**
 * a change kept while storage cannot be read, which the last read list could
 * not confirm
 */
const describeUnverified = (operation: BookmarkOperation) =>
  t("viewportBookmarks.unverified", {
    name:
      operation.type === "add"
        ? operation.bookmark.name
        : operation.type === "rename"
        ? operation.from
        : operation.name,
  });

export const ViewportBookmarks = () => {
  const app = useApp();
  const panel = useAtomValue(viewportBookmarksAtom);

  if (panel?.editorId !== app.id) {
    return null;
  }

  return (
    <ViewportBookmarksPanel
      onClose={() => app.updateEditorAtom(viewportBookmarksAtom, null)}
    />
  );
};

const ViewportBookmarksPanel = ({ onClose }: { onClose: () => void }) => {
  const app = useApp();
  // the props context re-renders the panel when `boardId` or
  // `isCollaborating` change, so the key below follows them
  const { boardId } = useAppProps();
  // bumped on history navigation, which changes the URL but no prop
  const [, setLocationVersion] = useState(0);
  const boardKey = getBoardKey(window.location, boardId);
  const [bookmarks, setBookmarks] = useState<ViewportBookmark[]>([]);
  const [error, setError] = useState<string | null>(null);
  // changes another tab made impossible, shown until the next change
  const [rejections, setRejections] = useState<string[]>([]);
  const [nameInput, setNameInput] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // the bookmark to focus after the list re-renders
  const focusIdRef = useRef<string | null>(null);
  // a rename ends once, whether by Enter, Escape or blur
  const renamingIdRef = useRef<string | null>(null);
  // the name shown when the rename began, which another tab may change while
  // the input is open
  const renameFromRef = useRef("");

  const getBookmarkButton = (id: string) =>
    Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-bookmark-id]") ??
        [],
    ).find((button) => button.dataset.bookmarkId === id);

  const showResult = (result: BookmarkLoadResult) => {
    setBookmarks(result.value);
    setError(
      result.error === "load"
        ? t("viewportBookmarks.loadFailed")
        : result.error === "save"
        ? t("viewportBookmarks.saveFailed")
        : null,
    );
    if (result.rejected.length) {
      setRejections(result.rejected.map(describeRejection));
    }
  };

  // the board can change under the panel: opening another local board changes
  // `boardId`, and starting or leaving a room changes the URL with pushState,
  // which fires no event but comes with a new `isCollaborating` prop
  useEffect(() => {
    const onLocationChange = () => setLocationVersion((version) => version + 1);
    window.addEventListener("hashchange", onLocationChange);
    window.addEventListener("popstate", onLocationChange);
    return () => {
      window.removeEventListener("hashchange", onLocationChange);
      window.removeEventListener("popstate", onLocationChange);
    };
  }, []);

  useEffect(() => {
    setRejections([]);
    showResult(loadViewportBookmarks(boardKey));
    // another tab may change this board's bookmarks while the panel is open
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === VIEWPORT_BOOKMARKS_STORAGE_KEY) {
        showResult(loadViewportBookmarks(boardKey));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey]);

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const id = focusIdRef.current;
    if (id === null) {
      return;
    }
    focusIdRef.current = null;
    (getBookmarkButton(id) ?? nameInputRef.current)?.focus();
  });

  /**
   * Applies the change to the board's stored list as it is now, so changes
   * another tab stored meanwhile are kept. The change is kept to replay until
   * reload when storage refuses it. Success is announced only when the change
   * applied, and a change that cannot be checked while storage is unreadable
   * is announced as pending; returns whether it was not rejected.
   */
  const commit = (operation: BookmarkOperation, message: string) => {
    const result = updateViewportBookmarks(boardKey, operation);
    setRejections([]);
    showResult(result);
    const rejection = result.rejected.find(
      (rejected) => rejected.operation === operation,
    );
    const unverified = result.unverified.includes(operation);
    setAnnouncement(
      rejection
        ? describeRejection(rejection)
        : unverified
        ? describeUnverified(operation)
        : message,
    );
    if (unverified) {
      setRejections([describeUnverified(operation)]);
    }
    return !rejection;
  };

  const atLimit = bookmarks.length >= MAX_BOOKMARKS_PER_BOARD;

  const save = () => {
    if (atLimit) {
      return;
    }
    const name =
      normalizeBookmarkName(nameInput) ||
      getDefaultBookmarkName(bookmarks, t("viewportBookmarks.defaultName"));
    const bookmark = createViewportBookmark(name, app.state);
    // a rejected name stays in the input so the user can retry
    if (
      commit(
        { type: "add", bookmark },
        t("viewportBookmarks.announceSaved", { name: bookmark.name }),
      )
    ) {
      setNameInput("");
    }
  };

  const jump = (bookmark: ViewportBookmark) => {
    // only the camera moves: no element changes and no history entry
    app.setAppState(getBookmarkViewport(bookmark, app.state));
    setAnnouncement(
      t("viewportBookmarks.announceJumped", { name: bookmark.name }),
    );
  };

  const startRename = (bookmark: ViewportBookmark) => {
    renamingIdRef.current = bookmark.id;
    renameFromRef.current = bookmark.name;
    setRenamingId(bookmark.id);
    setRenameInput(bookmark.name);
  };

  /**
   * `restoreFocus` is set for Enter and Escape. On blur focus has already
   * moved where the user wanted, so it stays there.
   */
  const finishRename = (
    bookmark: ViewportBookmark,
    apply: boolean,
    restoreFocus: boolean,
  ) => {
    if (renamingIdRef.current !== bookmark.id) {
      return;
    }
    renamingIdRef.current = null;
    setRenamingId(null);
    if (restoreFocus) {
      focusIdRef.current = bookmark.id;
    }
    const from = renameFromRef.current;
    const name = normalizeBookmarkName(renameInput);
    if (!apply || !name || name === from) {
      return;
    }
    commit(
      { type: "rename", id: bookmark.id, from, name },
      t("viewportBookmarks.announceRenamed", { name }),
    );
  };

  const remove = (bookmark: ViewportBookmark) => {
    const index = bookmarks.indexOf(bookmark);
    const next = bookmarks.filter((entry) => entry.id !== bookmark.id);
    focusIdRef.current = (next[index] ?? next[index - 1])?.id ?? "";
    commit(
      { type: "remove", id: bookmark.id, name: bookmark.name },
      t("viewportBookmarks.announceRemoved", { name: bookmark.name }),
    );
  };

  const close = () => {
    onClose();
    app.focusContainer();
  };

  const onPanelKeyDown = (event: React.KeyboardEvent) => {
    // keys in the panel keep their native meaning and never reach editor
    // shortcuts, so typing a name does not switch tools
    event.stopPropagation();
    if (event.key === KEYS.ESCAPE && !event.defaultPrevented) {
      event.preventDefault();
      close();
    }
  };

  const onBookmarkKeyDown = (
    event: React.KeyboardEvent,
    bookmark: ViewportBookmark,
    index: number,
  ) => {
    if (event.key === "F2") {
      event.preventDefault();
      startRename(bookmark);
    } else if (event.key === KEYS.DELETE || event.key === KEYS.BACKSPACE) {
      event.preventDefault();
      remove(bookmark);
    } else if (event.key === KEYS.ARROW_DOWN || event.key === KEYS.ARROW_UP) {
      event.preventDefault();
      const next = bookmarks[index + (event.key === KEYS.ARROW_DOWN ? 1 : -1)];
      if (next) {
        getBookmarkButton(next.id)?.focus();
      }
    }
  };

  return (
    <section
      className="ViewportBookmarks"
      aria-label={t("viewportBookmarks.title")}
      data-testid="viewport-bookmarks"
      onKeyDown={onPanelKeyDown}
    >
      <div className="ViewportBookmarks__header">
        <span className="ViewportBookmarks__title">
          {t("viewportBookmarks.title")}
        </span>
        <button
          type="button"
          className="ViewportBookmarks__icon-button"
          onClick={close}
          aria-label={t("viewportBookmarks.close")}
          title={`${t("viewportBookmarks.close")} (Esc)`}
        >
          {CloseIcon}
        </button>
      </div>
      <p className="ViewportBookmarks__hint">
        {t("viewportBookmarks.localHint")}
      </p>
      <form
        className="ViewportBookmarks__save"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <input
          ref={nameInputRef}
          type="text"
          value={nameInput}
          maxLength={MAX_BOOKMARK_NAME_LENGTH}
          placeholder={t("viewportBookmarks.namePlaceholder")}
          aria-label={t("viewportBookmarks.nameLabel")}
          onChange={(event) => setNameInput(event.target.value)}
        />
        <button
          type="submit"
          className="ViewportBookmarks__button"
          disabled={atLimit}
        >
          {t("viewportBookmarks.save")}
        </button>
      </form>
      {error && (
        <div
          className="ViewportBookmarks__error"
          role="alert"
          data-testid="viewport-bookmarks-error"
        >
          {error}
        </div>
      )}
      {rejections.length > 0 && (
        <div
          className="ViewportBookmarks__error"
          role="alert"
          data-testid="viewport-bookmarks-rejected"
        >
          {rejections.map((message, index) => (
            <p key={index}>{message}</p>
          ))}
        </div>
      )}
      {bookmarks.length === 0 ? (
        <p className="ViewportBookmarks__empty">
          {t("viewportBookmarks.empty")}
        </p>
      ) : (
        <ul
          ref={listRef}
          className="ViewportBookmarks__list"
          aria-label={t("viewportBookmarks.listLabel")}
        >
          {bookmarks.map((bookmark, index) => (
            <li key={bookmark.id} className="ViewportBookmarks__item">
              {renamingId === bookmark.id ? (
                <input
                  type="text"
                  autoFocus
                  value={renameInput}
                  maxLength={MAX_BOOKMARK_NAME_LENGTH}
                  aria-label={t("viewportBookmarks.renameLabel", {
                    name: bookmark.name,
                  })}
                  onChange={(event) => setRenameInput(event.target.value)}
                  onBlur={() => finishRename(bookmark, true, false)}
                  onKeyDown={(event) => {
                    if (event.key === KEYS.ENTER) {
                      event.preventDefault();
                      finishRename(bookmark, true, true);
                    } else if (event.key === KEYS.ESCAPE) {
                      // cancels the rename without closing the panel
                      event.preventDefault();
                      finishRename(bookmark, false, true);
                    }
                  }}
                />
              ) : (
                <>
                  <button
                    type="button"
                    className="ViewportBookmarks__jump"
                    data-bookmark-id={bookmark.id}
                    title={t("viewportBookmarks.jumpHint")}
                    onClick={() => jump(bookmark)}
                    onKeyDown={(event) =>
                      onBookmarkKeyDown(event, bookmark, index)
                    }
                  >
                    {bookmark.name}
                  </button>
                  <button
                    type="button"
                    className="ViewportBookmarks__icon-button"
                    aria-label={t("viewportBookmarks.rename", {
                      name: bookmark.name,
                    })}
                    title={`${t("viewportBookmarks.renameShort")} (F2)`}
                    onClick={() => startRename(bookmark)}
                  >
                    {pencilIcon}
                  </button>
                  <button
                    type="button"
                    className="ViewportBookmarks__icon-button"
                    aria-label={t("viewportBookmarks.remove", {
                      name: bookmark.name,
                    })}
                    title={`${t("viewportBookmarks.removeShort")} (Delete)`}
                    onClick={() => remove(bookmark)}
                  >
                    {TrashIcon}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <div
        className="ViewportBookmarks__sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="viewport-bookmarks-announcement"
      >
        {announcement}
      </div>
    </section>
  );
};

/** opens the bookmarks panel for this editor */
export const openViewportBookmarks = (app: AppClassProperties) => {
  app.updateEditorAtom(viewportBookmarksAtom, { editorId: app.id });
};

/** closes the panel when its editor goes away */
export const closeViewportBookmarksForEditor = (
  editorId: AppClassProperties["id"],
) => {
  if (editorJotaiStore.get(viewportBookmarksAtom)?.editorId === editorId) {
    editorJotaiStore.set(viewportBookmarksAtom, null);
  }
};

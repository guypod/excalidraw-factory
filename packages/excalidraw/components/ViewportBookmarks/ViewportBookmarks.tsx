import { useEffect, useRef, useState } from "react";

import { KEYS } from "@excalidraw/common";

import { atom, editorJotaiStore, useAtomValue } from "../../editor-jotai";
import { t } from "../../i18n";
import { useApp } from "../App";
import { CloseIcon, TrashIcon, pencilIcon } from "../icons";

import {
  MAX_BOOKMARKS_PER_BOARD,
  MAX_BOOKMARK_NAME_LENGTH,
  createViewportBookmark,
  getBoardKey,
  getBookmarkViewport,
  getDefaultBookmarkName,
  loadViewportBookmarks,
  normalizeBookmarkName,
  saveViewportBookmarks,
} from "./viewportBookmarkStore";

import "./ViewportBookmarks.scss";

import type { ViewportBookmark } from "./viewportBookmarkStore";

import type { AppClassProperties } from "../../types";

/**
 * Every editor shares one jotai store, so the open panel records which editor
 * opened it and only that editor shows it.
 */
export const viewportBookmarksAtom = atom<{
  editorId: AppClassProperties["id"];
} | null>(null);

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
  const [boardKey, setBoardKey] = useState(() => getBoardKey());
  const [bookmarks, setBookmarks] = useState<ViewportBookmark[]>([]);
  const [error, setError] = useState<string | null>(null);
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

  const getBookmarkButton = (id: string) =>
    Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-bookmark-id]") ??
        [],
    ).find((button) => button.dataset.bookmarkId === id);

  // the board can change under the panel, for example when joining a room
  useEffect(() => {
    const onHashChange = () => setBoardKey(getBoardKey());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const result = loadViewportBookmarks(boardKey);
    setBookmarks(result.value);
    setError(result.ok ? null : t("viewportBookmarks.loadFailed"));
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

  /** keeps the change in memory even when storage refuses it */
  const commit = (next: ViewportBookmark[], message: string) => {
    setBookmarks(next);
    const result = saveViewportBookmarks(boardKey, next);
    setError(result.ok ? null : t("viewportBookmarks.saveFailed"));
    setAnnouncement(message);
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
    commit(
      [...bookmarks, bookmark],
      t("viewportBookmarks.announceSaved", { name: bookmark.name }),
    );
    setNameInput("");
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
    setRenamingId(bookmark.id);
    setRenameInput(bookmark.name);
  };

  const finishRename = (bookmark: ViewportBookmark, apply: boolean) => {
    if (renamingIdRef.current !== bookmark.id) {
      return;
    }
    renamingIdRef.current = null;
    setRenamingId(null);
    focusIdRef.current = bookmark.id;
    const name = normalizeBookmarkName(renameInput);
    if (!apply || !name || name === bookmark.name) {
      return;
    }
    commit(
      bookmarks.map((entry) =>
        entry.id === bookmark.id ? { ...entry, name } : entry,
      ),
      t("viewportBookmarks.announceRenamed", { name }),
    );
  };

  const remove = (bookmark: ViewportBookmark) => {
    const index = bookmarks.indexOf(bookmark);
    const next = bookmarks.filter((entry) => entry.id !== bookmark.id);
    focusIdRef.current = (next[index] ?? next[index - 1])?.id ?? "";
    commit(
      next,
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
                  onBlur={() => finishRename(bookmark, true)}
                  onKeyDown={(event) => {
                    if (event.key === KEYS.ENTER) {
                      event.preventDefault();
                      finishRename(bookmark, true);
                    } else if (event.key === KEYS.ESCAPE) {
                      // cancels the rename without closing the panel
                      event.preventDefault();
                      finishRename(bookmark, false);
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

import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import DialogActionButton from "@excalidraw/excalidraw/components/DialogActionButton";
import { TextField } from "@excalidraw/excalidraw/components/TextField";
import {
  bumpElementVersions,
  restoreAppState,
  restoreElements,
} from "@excalidraw/excalidraw/data/restore";
import { useI18n } from "@excalidraw/excalidraw/i18n";
import { KEYS } from "@excalidraw/common";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { appJotaiStore, atom, useAtom } from "../app-jotai";
import { isCollaboratingAtom } from "../collab/Collab";
import {
  activeBoardAtom,
  BoardShelf,
  getBoardFiles,
  hasUnsavedBoardChanges,
  normalizeBoardName,
  saveActiveBoard,
} from "../data/boardShelf";

import "./BoardShelfDialog.scss";

import type {
  ActiveBoard,
  BoardSummary,
  UnreadableBoard,
} from "../data/boardShelf";

export const boardShelfDialogOpenAtom = atom(false);

export { activeBoardAtom };

type Status = { type: "info" | "error"; message: string } | null;

type PendingConfirm =
  | { type: "open"; board: BoardSummary }
  | { type: "delete"; board: { id: string; name: string } }
  | null;

const formatDate = (timestamp: number) => {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return String(timestamp);
  }
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const BoardShelfDialog = ({
  excalidrawAPI,
  isCollaborating,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
  isCollaborating: boolean;
}) => {
  const [isOpen, setIsOpen] = useAtom(boardShelfDialogOpenAtom);

  if (!isOpen) {
    return null;
  }

  return (
    <BoardShelfDialogInner
      excalidrawAPI={excalidrawAPI}
      isCollaborating={isCollaborating}
      onClose={() => setIsOpen(false)}
    />
  );
};

const BoardShelfDialogInner = ({
  excalidrawAPI,
  isCollaborating,
  onClose,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
  isCollaborating: boolean;
  onClose: () => void;
}) => {
  const { t } = useI18n();
  const [activeBoard, setActiveBoardState] = useAtom(activeBoardAtom);
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [unreadable, setUnreadable] = useState<UnreadableBoard[]>([]);
  const [newBoardName, setNewBoardName] = useState("");
  const [renaming, setRenaming] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null);
  const [status, setStatus] = useState<Status>(null);
  const confirmRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const setActiveBoard = useCallback(
    (board: ActiveBoard | null) => {
      setActiveBoardState(board);
      saveActiveBoard(board);
    },
    [setActiveBoardState],
  );

  const refresh = useCallback(async () => {
    try {
      const result = await BoardShelf.list();
      setBoards(result.boards);
      setUnreadable(result.unreadable);
    } catch (error) {
      setStatus({ type: "error", message: errorMessage(error) });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (pendingConfirm) {
      confirmRef.current
        ?.querySelector<HTMLButtonElement>("[data-confirm-cancel]")
        ?.focus();
    } else if (!rootRef.current?.contains(document.activeElement)) {
      // the focused control was removed (confirm, rename form or a deleted
      // board). Keep focus in the dialog so Escape and Tab keep working
      rootRef.current?.focus();
    }
  }, [pendingConfirm, renaming, boards]);

  // async work started by this dialog must not touch the scene once the
  // dialog has closed (a reopened dialog is a new instance)
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // guards async work so the dialog never runs two storage writes at once
  const busyRef = useRef(false);
  const run = async (task: () => Promise<void>) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    try {
      await task();
    } catch (error) {
      setStatus({ type: "error", message: errorMessage(error) });
    } finally {
      busyRef.current = false;
    }
  };

  const save = (asNew: boolean) =>
    run(async () => {
      const name =
        normalizeBoardName(asNew ? newBoardName : activeBoard?.name ?? "") ||
        t("boardShelf.defaultName");
      const { record, missingFileIds } = await BoardShelf.save({
        id: asNew ? undefined : activeBoard?.id,
        name,
        elements: excalidrawAPI.getSceneElements(),
        appState: excalidrawAPI.getAppState(),
        files: excalidrawAPI.getFiles(),
      });
      setActiveBoard({ id: record.id, name: record.name });
      setNewBoardName("");
      let message = t("boardShelf.status.saved", { name: record.name });
      if (missingFileIds.length) {
        message += ` ${t("boardShelf.status.missingImages", {
          count: missingFileIds.length,
        })}`;
      }
      setStatus({ type: "info", message });
      await refresh();
    });

  const doOpen = async (board: BoardSummary) => {
    const record = await BoardShelf.load(board.id);
    if (!isMountedRef.current) {
      return;
    }
    // checked when the scene is applied, because a session can start while a
    // confirmation or read is pending, and the scene would then be synced
    if (appJotaiStore.get(isCollaboratingAtom)) {
      setPendingConfirm(null);
      throw new Error(t("boardShelf.openDisabledWhileCollaborating"));
    }
    excalidrawAPI.addFiles(getBoardFiles(record));
    excalidrawAPI.updateScene({
      // versions must be above the current scene's, or history won't record
      // elements that go back to an older saved state
      elements: bumpElementVersions(
        restoreElements(record.elements, null, {
          repairBindings: true,
        }),
        excalidrawAPI.getSceneElementsIncludingDeleted(),
      ),
      appState: {
        ...restoreAppState(record.appState, excalidrawAPI.getAppState()),
        // the board is not the local file the canvas may have come from
        fileHandle: null,
        name: record.name,
        selectedElementIds: {},
        selectedGroupIds: {},
        editingGroupId: null,
      },
      // a single undo step, so the previous canvas can be brought back
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    excalidrawAPI.scrollToContent(undefined, { fitToContent: true });
    setActiveBoard({ id: record.id, name: record.name });
    setPendingConfirm(null);
    setStatus({
      type: "info",
      message: t("boardShelf.status.opened", { name: record.name }),
    });
  };

  const openBoard = (board: BoardSummary) => run(() => doOpen(board));

  const requestOpen = (board: BoardSummary) =>
    run(async () => {
      const isDirty = await hasUnsavedBoardChanges(
        excalidrawAPI.getSceneElements(),
        excalidrawAPI.getAppState(),
        activeBoard,
      );
      if (!isMountedRef.current) {
        return;
      }
      if (isDirty) {
        setPendingConfirm({ type: "open", board });
      } else {
        await doOpen(board);
      }
    });

  const commitRename = () =>
    run(async () => {
      if (!renaming) {
        return;
      }
      const name = normalizeBoardName(renaming.name);
      if (!name) {
        setRenaming(null);
        return;
      }
      const record = await BoardShelf.rename(renaming.id, name);
      if (activeBoard?.id === record.id) {
        setActiveBoard({ id: record.id, name: record.name });
      }
      setRenaming(null);
      setStatus({
        type: "info",
        message: t("boardShelf.status.renamed", { name: record.name }),
      });
      await refresh();
    });

  const deleteBoard = (board: { id: string; name: string }) =>
    run(async () => {
      await BoardShelf.delete(board.id);
      if (activeBoard?.id === board.id) {
        setActiveBoard(null);
      }
      setPendingConfirm(null);
      setStatus({
        type: "info",
        message: t("boardShelf.status.deleted", { name: board.name }),
      });
      await refresh();
    });

  const confirmJSX = pendingConfirm && (
    <div
      className="BoardShelf__confirm"
      role="alertdialog"
      aria-labelledby="board-shelf-confirm-title"
      aria-describedby="board-shelf-confirm-description"
      ref={confirmRef}
      data-testid="board-shelf-confirm"
      onKeyDown={(event) => {
        if (event.key === KEYS.ESCAPE) {
          // cancel the confirmation only, not the whole dialog
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation();
          setPendingConfirm(null);
        }
      }}
    >
      <h3 id="board-shelf-confirm-title" className="BoardShelf__confirmTitle">
        {pendingConfirm.type === "open"
          ? t("boardShelf.confirm.openTitle", {
              name: pendingConfirm.board.name,
            })
          : t("boardShelf.confirm.deleteTitle", {
              name: pendingConfirm.board.name,
            })}
      </h3>
      <p id="board-shelf-confirm-description">
        {pendingConfirm.type === "open"
          ? t("boardShelf.confirm.openDescription", {
              name: pendingConfirm.board.name,
            })
          : t("boardShelf.confirm.deleteDescription")}
      </p>
      <div className="BoardShelf__actions">
        <DialogActionButton
          label={t("buttons.cancel")}
          data-confirm-cancel
          data-testid="board-shelf-confirm-cancel"
          onClick={() => setPendingConfirm(null)}
        />
        <DialogActionButton
          label={
            pendingConfirm.type === "open"
              ? t("boardShelf.confirm.openButton")
              : t("boardShelf.confirm.deleteButton")
          }
          actionType="danger"
          data-testid="board-shelf-confirm-action"
          onClick={() =>
            pendingConfirm.type === "open"
              ? openBoard(pendingConfirm.board)
              : deleteBoard(pendingConfirm.board)
          }
        />
      </div>
    </div>
  );

  return (
    <Dialog
      size="regular"
      onCloseRequest={onClose}
      title={t("boardShelf.title")}
      className="BoardShelfDialog"
    >
      <div ref={rootRef} tabIndex={-1} className="BoardShelf__root">
        <p className="BoardShelf__localOnly">{t("boardShelf.localOnly")}</p>

        <section className="BoardShelf__current">
          <p data-testid="board-shelf-current">
            {activeBoard
              ? t("boardShelf.currentBoard", { name: activeBoard.name })
              : t("boardShelf.noCurrentBoard")}
          </p>
          <div className="BoardShelf__saveRow">
            {activeBoard && (
              <DialogActionButton
                label={t("boardShelf.save")}
                actionType="primary"
                data-testid="board-shelf-save"
                onClick={() => save(false)}
              />
            )}
            <TextField
              label={t("boardShelf.newBoardName")}
              placeholder={t("boardShelf.defaultName")}
              value={newBoardName}
              onChange={setNewBoardName}
              onKeyDown={(event) => {
                if (event.key === KEYS.ENTER) {
                  event.preventDefault();
                  save(true);
                }
              }}
            />
            <DialogActionButton
              label={t("boardShelf.saveAsNew")}
              actionType={activeBoard ? undefined : "primary"}
              data-testid="board-shelf-save-new"
              onClick={() => save(true)}
            />
          </div>
        </section>

        <div
          className={`BoardShelf__status BoardShelf__status--${
            status?.type ?? "info"
          }`}
          role={status?.type === "error" ? "alert" : "status"}
          data-testid="board-shelf-status"
        >
          {status?.message}
        </div>

        {confirmJSX}

        <section aria-labelledby="board-shelf-list-title">
          <h3 id="board-shelf-list-title" className="BoardShelf__listTitle">
            {t("boardShelf.savedBoards")}
          </h3>
          {isCollaborating && (
            <p className="BoardShelf__hint">
              {t("boardShelf.openDisabledWhileCollaborating")}
            </p>
          )}
          {!boards.length && !unreadable.length ? (
            <p className="BoardShelf__hint">{t("boardShelf.empty")}</p>
          ) : (
            <ul className="BoardShelf__list">
              {boards.map((board) => (
                <li
                  key={board.id}
                  className="BoardShelf__item"
                  data-testid={`board-shelf-item-${board.id}`}
                >
                  {renaming?.id === board.id ? (
                    <form
                      className="BoardShelf__renameForm"
                      onSubmit={(event) => {
                        event.preventDefault();
                        commitRename();
                      }}
                    >
                      <TextField
                        label={t("boardShelf.renameLabel", {
                          name: board.name,
                        })}
                        value={renaming.name}
                        selectOnRender
                        onChange={(name) => setRenaming({ id: board.id, name })}
                        onKeyDown={(event) => {
                          if (event.key === KEYS.ENTER) {
                            event.preventDefault();
                            commitRename();
                          } else if (event.key === KEYS.ESCAPE) {
                            event.stopPropagation();
                            event.nativeEvent.stopImmediatePropagation();
                            setRenaming(null);
                          }
                        }}
                      />
                      <DialogActionButton
                        label={t("boardShelf.rename")}
                        type="submit"
                        data-testid="board-shelf-rename-submit"
                      />
                      <DialogActionButton
                        label={t("buttons.cancel")}
                        onClick={() => setRenaming(null)}
                      />
                    </form>
                  ) : (
                    <>
                      <div className="BoardShelf__itemText">
                        <span className="BoardShelf__itemName">
                          {board.name}
                          {activeBoard?.id === board.id ? " ✓" : ""}
                        </span>
                        <span className="BoardShelf__itemMeta">
                          {t("boardShelf.updated", {
                            date: formatDate(board.updatedAt),
                          })}
                        </span>
                      </div>
                      <div className="BoardShelf__itemActions">
                        <DialogActionButton
                          label={t("boardShelf.open")}
                          aria-label={`${t("boardShelf.open")}: ${board.name}`}
                          data-testid="board-shelf-open"
                          disabled={isCollaborating}
                          onClick={() => requestOpen(board)}
                        />
                        <DialogActionButton
                          label={t("boardShelf.rename")}
                          aria-label={`${t("boardShelf.rename")}: ${
                            board.name
                          }`}
                          data-testid="board-shelf-rename"
                          onClick={() =>
                            setRenaming({ id: board.id, name: board.name })
                          }
                        />
                        <DialogActionButton
                          label={t("boardShelf.delete")}
                          aria-label={`${t("boardShelf.delete")}: ${
                            board.name
                          }`}
                          actionType="danger"
                          data-testid="board-shelf-delete"
                          onClick={() =>
                            setPendingConfirm({
                              type: "delete",
                              board: { id: board.id, name: board.name },
                            })
                          }
                        />
                      </div>
                    </>
                  )}
                </li>
              ))}
              {unreadable.map((entry) => (
                <li
                  key={entry.id}
                  className="BoardShelf__item BoardShelf__item--unreadable"
                  data-testid={`board-shelf-unreadable-${entry.id}`}
                >
                  <div className="BoardShelf__itemText">
                    <span className="BoardShelf__itemName">
                      {t("boardShelf.unreadable")}
                    </span>
                    <span className="BoardShelf__itemMeta">
                      {t("boardShelf.unreadableHint")}
                    </span>
                  </div>
                  <div className="BoardShelf__itemActions">
                    <DialogActionButton
                      label={t("boardShelf.delete")}
                      actionType="danger"
                      onClick={() =>
                        setPendingConfirm({
                          type: "delete",
                          board: {
                            id: entry.id,
                            name: t("boardShelf.unreadable"),
                          },
                        })
                      }
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Dialog>
  );
};

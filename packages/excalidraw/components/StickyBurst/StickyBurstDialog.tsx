import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { KEYS } from "@excalidraw/common";

import { trackEvent } from "../../analytics";
import { useUIAppState } from "../../context/ui-appState";
import { t } from "../../i18n";
import { exportToSvg } from "../../scene/export";
import { useApp, useExcalidrawContainer } from "../App";
import { Dialog } from "../Dialog";
import DialogActionButton from "../DialogActionButton";

import {
  STICKY_BURST_MAX_LENGTH,
  STICKY_BURST_MAX_NOTES,
  getStickyNoteElements,
  parseStickyLines,
} from "./stickyNotes";

import "./StickyBurstDialog.scss";

const StickyBurstPreview = ({ lines }: { lines: readonly string[] }) => {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const { theme } = useUIAppState();

  useLayoutEffect(() => {
    const previewNode = previewRef.current!;
    if (!lines.length) {
      previewNode.replaceChildren();
      return;
    }
    let canceled = false;

    (async () => {
      const svg = await exportToSvg(
        getStickyNoteElements(lines),
        {
          exportBackground: false,
          viewBackgroundColor: "#fff",
          exportWithDarkMode: theme === "dark",
        },
        null,
        {
          skipInliningFonts: true,
        },
      );
      if (canceled) {
        return;
      }
      svg.querySelector(".style-fonts")?.remove();
      previewNode.replaceChildren(svg);
    })();

    return () => {
      canceled = true;
    };
  }, [lines, theme]);

  return (
    <div
      className="StickyBurst__preview"
      ref={previewRef}
      data-testid="sticky-burst-preview"
    />
  );
};

export const StickyBurstDialog = ({ onClose }: { onClose: () => void }) => {
  const { onInsertElements, focusContainer } = useApp();
  const { id } = useExcalidrawContainer();
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const inputId = `${id}-sticky-burst-input`;
  const statusId = `${id}-sticky-burst-status`;

  const parsed = useMemo(() => parseStickyLines(text), [text]);
  const { lines, droppedCount, shortenedCount } = parsed;

  useEffect(() => {
    // focus the input once the dialog has mounted
    const timeout = setTimeout(() => textareaRef.current?.focus());
    return () => clearTimeout(timeout);
  }, []);

  const closeDialog = () => {
    onClose();
    // return focus to the editor rather than leaving it on the document body
    focusContainer();
  };

  const insertNotes = () => {
    if (!lines.length) {
      return;
    }
    onInsertElements(getStickyNoteElements(lines));
    trackEvent("stickyBurst", "insert", undefined, lines.length);
    closeDialog();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === KEYS.ENTER && event[KEYS.CTRL_OR_CMD]) {
      // leave an active IME composition alone instead of submitting it
      if (event.nativeEvent.isComposing || event.keyCode === 229) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      insertNotes();
    }
  };

  let status = lines.length
    ? t("stickyBurst.count", { count: lines.length })
    : t("stickyBurst.empty");
  if (droppedCount) {
    status += ` ${t("stickyBurst.dropped", {
      count: droppedCount,
      max: STICKY_BURST_MAX_NOTES,
    })}`;
  }
  if (shortenedCount) {
    status += ` ${t("stickyBurst.shortened", {
      count: shortenedCount,
      max: STICKY_BURST_MAX_LENGTH,
    })}`;
  }

  return (
    <Dialog
      size="wide"
      onCloseRequest={closeDialog}
      title={t("stickyBurst.title")}
      className="StickyBurstDialog"
      autofocus={false}
    >
      <div className="StickyBurst__body">
        <div className="StickyBurst__inputPanel">
          <label htmlFor={inputId} className="StickyBurst__label">
            {t("stickyBurst.inputLabel")}
          </label>
          <textarea
            id={inputId}
            ref={textareaRef}
            className="StickyBurst__input"
            data-testid="sticky-burst-input"
            value={text}
            placeholder={t("stickyBurst.placeholder")}
            aria-describedby={statusId}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <p
            id={statusId}
            className="StickyBurst__status"
            data-testid="sticky-burst-status"
            role="status"
          >
            {status}
          </p>
        </div>
        <section
          className="StickyBurst__previewPanel"
          aria-label={t("stickyBurst.preview")}
        >
          <StickyBurstPreview lines={lines} />
        </section>
      </div>
      <div className="StickyBurst__actions">
        <DialogActionButton
          label={t("buttons.cancel")}
          data-testid="sticky-burst-cancel"
          onClick={closeDialog}
        />
        <DialogActionButton
          label={t("stickyBurst.insert", { count: lines.length })}
          actionType="primary"
          data-testid="sticky-burst-insert"
          disabled={!lines.length}
          onClick={insertNotes}
        />
      </div>
    </Dialog>
  );
};

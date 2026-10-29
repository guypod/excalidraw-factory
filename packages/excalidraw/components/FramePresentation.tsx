import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { CODES, EVENT, KEYS } from "@excalidraw/common";

import { getFrameLikeTitle, isFrameLikeElement } from "@excalidraw/element";

import type {
  ExcalidrawFrameLikeElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { atom, editorJotaiStore, useAtomValue } from "../editor-jotai";
import { t } from "../i18n";

import { useApp } from "./App";
import { ArrowRightIcon, CloseIcon, chevronLeftIcon } from "./icons";

import "./FramePresentation.scss";

import type { AppClassProperties, AppState } from "../types";

/** viewport to restore when the presentation ends */
export type PresentationViewport = Pick<
  AppState,
  "scrollX" | "scrollY" | "zoom"
>;

/**
 * Every editor shares one jotai store, so the session records which editor
 * started it and only that editor presents.
 */
export const framePresentationAtom = atom<{
  editorId: AppClassProperties["id"];
  savedViewport: PresentationViewport;
} | null>(null);

export const isPresentingFrames = (editorId: AppClassProperties["id"]) =>
  editorJotaiStore.get(framePresentationAtom)?.editorId === editorId;

export type PresentationSlide = {
  id: ExcalidrawFrameLikeElement["id"];
  title: string;
};

/**
 * Frames in reading order: top to bottom, then left to right, with the id as
 * the tie-break so frames at the same position always keep the same order.
 * Deleted frames and frames with nothing in them are skipped.
 */
export const getPresentationSlides = (
  elements: readonly NonDeletedExcalidrawElement[],
): PresentationSlide[] => {
  const frames: ExcalidrawFrameLikeElement[] = [];
  const nonEmptyFrameIds = new Set<string>();

  for (const element of elements) {
    if (element.isDeleted) {
      continue;
    }
    if (isFrameLikeElement(element)) {
      frames.push(element);
    } else if (element.frameId) {
      nonEmptyFrameIds.add(element.frameId);
    }
  }

  return frames
    .filter((frame) => nonEmptyFrameIds.has(frame.id))
    .sort(
      (a, b) =>
        a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map((frame) => ({ id: frame.id, title: getFrameLikeTitle(frame) }));
};

const NEXT_KEYS: readonly string[] = [
  KEYS.ARROW_RIGHT,
  KEYS.ARROW_DOWN,
  KEYS.PAGE_DOWN,
];
const PREVIOUS_KEYS: readonly string[] = [
  KEYS.ARROW_LEFT,
  KEYS.ARROW_UP,
  KEYS.PAGE_UP,
];
/** browser zoom shortcuts, left to the browser while presenting */
const BROWSER_ZOOM_CODES: readonly string[] = [
  CODES.EQUAL,
  CODES.MINUS,
  CODES.ZERO,
  CODES.NUM_ADD,
  CODES.NUM_SUBTRACT,
  CODES.NUM_ZERO,
];

export const FramePresentation = () => {
  const app = useApp();
  const presentation = useAtomValue(framePresentationAtom);

  if (presentation?.editorId !== app.id) {
    return null;
  }

  const exit = () => {
    app.updateEditorAtom(framePresentationAtom, null);
    const { scrollX, scrollY, zoom } = presentation.savedViewport;
    app.setAppState({ scrollX, scrollY, zoom });
    app.focusContainer();
  };

  return <FramePresentationInner onExit={exit} />;
};

const FramePresentationInner = ({ onExit }: { onExit: () => void }) => {
  const app = useApp();
  const rootRef = useRef<HTMLDivElement>(null);

  // follow the scene, so a frame deleted or emptied while presenting drops
  // out instead of leaving a blank slide
  const [sceneNonce, setSceneNonce] = useState(app.scene.getSceneNonce());
  useEffect(() => {
    const unsubscribe = app.scene.onUpdate(() =>
      setSceneNonce(app.scene.getSceneNonce()),
    );
    return () => {
      // when the whole editor unmounts, `scene.destroy()` has already
      // dropped every callback and unsubscribing again would throw
      try {
        unsubscribe();
      } catch {}
    };
  }, [app]);

  const slides = useMemo(
    () => getPresentationSlides(app.scene.getNonDeletedElements()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sceneNonce, app],
  );

  const [currentId, setCurrentId] = useState<string | null>(
    slides[0]?.id ?? null,
  );
  // when the current slide goes away, the slide now at its position (or the
  // last one) takes its place
  const lastIndexRef = useRef(0);
  let index = slides.findIndex((slide) => slide.id === currentId);
  if (index === -1 && slides.length) {
    index = Math.min(lastIndexRef.current, slides.length - 1);
  }
  lastIndexRef.current = Math.max(index, 0);
  const slide = index === -1 ? null : slides[index];

  useEffect(() => {
    if (slide && slide.id !== currentId) {
      setCurrentId(slide.id);
    }
  }, [slide, currentId]);

  // fit the current frame when it changes, and when the window is resized
  const { width, height } = app.state;
  useLayoutEffect(() => {
    const frame = slide && app.scene.getNonDeletedElementsMap().get(slide.id);
    if (frame) {
      app.scrollToContent(frame, {
        fitToViewport: true,
        viewportZoomFactor: 0.9,
        animate: false,
      });
    }
  }, [app, slide, width, height]);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const goTo = (nextIndex: number) => {
    const next = slides[nextIndex];
    if (next) {
      lastIndexRef.current = nextIndex;
      setCurrentId(next.id);
    }
  };

  const onKeyDownRef = useRef<(event: KeyboardEvent) => void>(() => {});
  onKeyDownRef.current = (event: KeyboardEvent) => {
    const onButton = event.target instanceof HTMLButtonElement;
    if (event.key === KEYS.ESCAPE) {
      onExit();
    } else if (
      NEXT_KEYS.includes(event.key) ||
      (event.key === KEYS.SPACE && !event.shiftKey && !onButton)
    ) {
      goTo(index + 1);
    } else if (
      PREVIOUS_KEYS.includes(event.key) ||
      (event.key === KEYS.SPACE && event.shiftKey && !onButton)
    ) {
      goTo(index - 1);
    } else if (event.key === "Home") {
      goTo(0);
    } else if (event.key === "End") {
      goTo(slides.length - 1);
    } else {
      // Tab, Enter or Space on a button, and browser zoom keep their usual
      // meaning. No key reaches the editor, so no shortcut can edit the
      // drawing
      event.stopPropagation();
      const isBrowserZoom =
        (event.ctrlKey || event.metaKey) &&
        BROWSER_ZOOM_CODES.includes(event.code);
      if (event.key !== KEYS.TAB && !onButton && !isBrowserZoom) {
        event.preventDefault();
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  // the editor listens on the document, so listen on the window in the
  // capture phase to see keys and clipboard events before it does
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => onKeyDownRef.current(event);
    const stop = (event: Event) => event.stopPropagation();
    const block = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener(EVENT.KEYDOWN, onKeyDown, true);
    window.addEventListener(EVENT.KEYUP, stop, true);
    window.addEventListener(EVENT.PASTE, block, true);
    window.addEventListener(EVENT.CUT, block, true);
    return () => {
      window.removeEventListener(EVENT.KEYDOWN, onKeyDown, true);
      window.removeEventListener(EVENT.KEYUP, stop, true);
      window.removeEventListener(EVENT.PASTE, block, true);
      window.removeEventListener(EVENT.CUT, block, true);
    };
  }, []);

  // keep focus inside the presentation while it is open
  const onBlur = (event: React.FocusEvent) => {
    const root = rootRef.current;
    if (root && !root.contains(event.relatedTarget as Node | null)) {
      root.focus();
    }
  };

  const exitButton = (
    <button
      type="button"
      className="FramePresentation__button FramePresentation__exit"
      onClick={onExit}
      title={`${t("framePresentation.exit")} (Esc)`}
    >
      {CloseIcon}
      <span>{t("framePresentation.exit")}</span>
    </button>
  );

  return (
    <div
      ref={rootRef}
      className="FramePresentation"
      role="dialog"
      aria-modal="true"
      aria-label={t("framePresentation.title")}
      aria-describedby="FramePresentation__hint"
      tabIndex={-1}
      onBlur={onBlur}
      onContextMenu={(event) => event.preventDefault()}
    >
      <p id="FramePresentation__hint" className="FramePresentation__sr-only">
        {t("framePresentation.hint")}
      </p>
      {slide ? (
        <div className="FramePresentation__controls">
          <button
            type="button"
            className="FramePresentation__button"
            onClick={() => goTo(index - 1)}
            disabled={index <= 0}
            aria-label={t("framePresentation.previous")}
            title={t("framePresentation.previous")}
          >
            {chevronLeftIcon}
          </button>
          <div
            className="FramePresentation__status"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-testid="frame-presentation-status"
          >
            <span className="FramePresentation__title">{slide.title}</span>
            <span className="FramePresentation__position">
              {t("framePresentation.position", {
                current: index + 1,
                total: slides.length,
              })}
            </span>
          </div>
          <button
            type="button"
            className="FramePresentation__button"
            onClick={() => goTo(index + 1)}
            disabled={index >= slides.length - 1}
            aria-label={t("framePresentation.next")}
            title={t("framePresentation.next")}
          >
            {ArrowRightIcon}
          </button>
          {exitButton}
        </div>
      ) : (
        <div
          className="FramePresentation__empty"
          role="status"
          data-testid="frame-presentation-empty"
        >
          <p className="FramePresentation__empty-title">
            {t("framePresentation.emptyTitle")}
          </p>
          <p>{t("framePresentation.emptyHint")}</p>
          {exitButton}
        </div>
      )}
    </div>
  );
};

/** ends the session without restoring, when its editor goes away */
export const endFramePresentationForEditor = (
  editorId: AppClassProperties["id"],
) => {
  if (isPresentingFrames(editorId)) {
    editorJotaiStore.set(framePresentationAtom, null);
  }
};

/**
 * Starts presenting frames, saving the viewport to restore on exit. The
 * editor UI is hidden while presenting, but view mode, selection and the
 * scene are left as they are, so the editor comes back exactly as it was.
 */
export const startFramePresentation = (app: AppClassProperties) => {
  const { scrollX, scrollY, zoom } = app.state;
  app.updateEditorAtom(framePresentationAtom, {
    editorId: app.id,
    savedViewport: { scrollX, scrollY, zoom },
  });
};

import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";

import { KEYS } from "@excalidraw/common";

import {
  CaptureUpdateAction,
  getBoundTextElement,
  getFrameLikeTitle,
  isFrameLikeElement,
  isTextElement,
  selectGroupsForSelectedElements,
} from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { t } from "../i18n";

import { useUIAppState } from "../context/ui-appState";

import { useApp } from "./App";
import { TextIcon, frameToolIcon } from "./icons";

import "./CanvasOutline.scss";

import type { AppClassProperties } from "../types";

export type OutlineItem = {
  id: ExcalidrawElement["id"];
  kind: "frame" | "label";
  label: string;
};

const MAX_LABEL_LENGTH = 80;

const toSingleLine = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > MAX_LABEL_LENGTH
    ? `${line.slice(0, MAX_LABEL_LENGTH - 1)}…`
    : line;
};

const byPosition = (a: ExcalidrawElement, b: ExcalidrawElement) =>
  a.y - b.y || a.x - b.x;

/**
 * Builds the outline from the scene without touching any element: frames
 * first, then text-labelled elements (free text, and shapes or arrows with a
 * bound label) in reading order. Bound text is listed through its container.
 */
export const getOutlineItems = (
  elements: readonly NonDeletedExcalidrawElement[],
  elementsMap: ElementsMap,
): { frames: OutlineItem[]; labels: OutlineItem[] } => {
  const frames: OutlineItem[] = [];
  const labels: OutlineItem[] = [];

  for (const element of [...elements].sort(byPosition)) {
    if (element.isDeleted) {
      continue;
    }
    if (isFrameLikeElement(element)) {
      frames.push({
        id: element.id,
        kind: "frame",
        label: toSingleLine(getFrameLikeTitle(element)),
      });
    } else if (isTextElement(element)) {
      if (element.containerId) {
        continue;
      }
      const label = toSingleLine(element.originalText);
      if (label) {
        labels.push({ id: element.id, kind: "label", label });
      }
    } else {
      const boundText = getBoundTextElement(element, elementsMap);
      const label = boundText && toSingleLine(boundText.originalText);
      if (label) {
        labels.push({ id: element.id, kind: "label", label });
      }
    }
  }

  return { frames, labels };
};

const selectAndZoomTo = (app: AppClassProperties, id: string) => {
  const element = app.scene.getNonDeletedElementsMap().get(id);
  if (!element) {
    return;
  }

  // selection goes through the action path so it is one undo step, like
  // other selection changes, and no element is mutated
  app.syncActionResult({
    appState: {
      ...app.state,
      ...selectGroupsForSelectedElements(
        { editingGroupId: null, selectedElementIds: { [id]: true } },
        app.scene.getNonDeletedElements(),
        app.state,
        app,
      ),
      selectedLinearElement: null,
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  app.scrollToContent(element, {
    fitToContent: true,
    animate: true,
    duration: 300,
    canvasOffsets: app.getEditorUIOffsets(),
  });
};

export const CanvasOutline = () => {
  const app = useApp();
  const appState = useUIAppState();

  // rebuild on every scene change, including in-place edits, undo, redo and
  // deletion
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

  const { frames, labels } = useMemo(
    () =>
      getOutlineItems(
        app.scene.getNonDeletedElements(),
        app.scene.getNonDeletedElementsMap(),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sceneNonce, app],
  );
  const items = useMemo(() => [...frames, ...labels], [frames, labels]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // keep the roving tab stop on an item that still exists
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.id === activeId),
  );

  useEffect(() => {
    if (activeId && !items.some((item) => item.id === activeId)) {
      setActiveId(items[0]?.id ?? null);
    }
  }, [items, activeId]);

  const focusItem = (index: number) => {
    const item = items[index];
    if (!item) {
      return;
    }
    setActiveId(item.id);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-outline-id="${CSS.escape(item.id)}"]`)
      ?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === KEYS.ARROW_DOWN) {
      nextIndex = Math.min(index + 1, items.length - 1);
    } else if (event.key === KEYS.ARROW_UP) {
      nextIndex = Math.max(index - 1, 0);
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
    } else if (event.key === KEYS.ENTER || event.key === KEYS.SPACE) {
      event.preventDefault();
      event.stopPropagation();
      selectAndZoomTo(app, items[index].id);
      return;
    } else {
      return;
    }
    // stop the editor from treating arrows as "move selected elements"
    event.preventDefault();
    event.stopPropagation();
    focusItem(nextIndex);
  };

  if (!items.length) {
    return (
      <div className="CanvasOutline" data-testid="canvas-outline">
        <div className="CanvasOutline__empty" role="status">
          <p className="CanvasOutline__empty-title">
            {t("canvasOutline.emptyTitle")}
          </p>
          <p>{t("canvasOutline.emptyHint")}</p>
        </div>
      </div>
    );
  }

  const renderGroup = (
    groupItems: OutlineItem[],
    heading: string,
    icon: React.ReactNode,
    offset: number,
  ) =>
    groupItems.length > 0 && (
      <div role="group" aria-label={heading}>
        <div className="CanvasOutline__heading" aria-hidden="true">
          {heading}
        </div>
        {groupItems.map((item, i) => {
          const index = offset + i;
          const selected = !!appState.selectedElementIds[item.id];
          const kindLabel =
            item.kind === "frame"
              ? t("canvasOutline.frame")
              : t("canvasOutline.labelled");
          return (
            <div
              key={item.id}
              role="option"
              data-outline-id={item.id}
              data-testid="canvas-outline-item"
              aria-selected={selected}
              aria-label={`${kindLabel}: ${item.label}`}
              tabIndex={index === activeIndex ? 0 : -1}
              className={clsx("CanvasOutline__item", {
                "CanvasOutline__item--selected": selected,
              })}
              onFocus={() => setActiveId(item.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              onClick={() => {
                setActiveId(item.id);
                selectAndZoomTo(app, item.id);
              }}
            >
              <span className="CanvasOutline__icon" aria-hidden="true">
                {icon}
              </span>
              <span className="CanvasOutline__label">{item.label}</span>
            </div>
          );
        })}
      </div>
    );

  return (
    <div className="CanvasOutline" data-testid="canvas-outline">
      <p className="CanvasOutline__hint" id="canvas-outline-hint">
        {t("canvasOutline.hint")}
      </p>
      <div
        ref={listRef}
        role="listbox"
        aria-label={t("canvasOutline.title")}
        aria-describedby="canvas-outline-hint"
        className="CanvasOutline__list"
      >
        {renderGroup(frames, t("canvasOutline.frames"), frameToolIcon, 0)}
        {renderGroup(
          labels,
          t("canvasOutline.labels"),
          TextIcon,
          frames.length,
        )}
      </div>
    </div>
  );
};

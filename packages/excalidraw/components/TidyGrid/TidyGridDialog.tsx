import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { KEYS } from "@excalidraw/common";
import {
  CaptureUpdateAction,
  updateFrameMembershipOfSelectedElements,
} from "@excalidraw/element";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { trackEvent } from "../../analytics";
import { useUIAppState } from "../../context/ui-appState";
import { t } from "../../i18n";
import { exportToSvg } from "../../scene/export";
import { useApp, useExcalidrawContainer } from "../App";
import { Dialog } from "../Dialog";
import DialogActionButton from "../DialogActionButton";

import {
  DEFAULT_TIDY_GAP,
  MAX_TIDY_GAP,
  applyTidyLayout,
  clampTidyOptions,
  getTidyUnits,
} from "./tidyGrid";

import "./TidyGridDialog.scss";

import type { TidyDirection, TidyOptions } from "./tidyGrid";

const TidyGridPreview = ({
  elements,
}: {
  elements: readonly NonDeletedExcalidrawElement[];
}) => {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const { theme } = useUIAppState();

  useLayoutEffect(() => {
    const previewNode = previewRef.current!;
    if (!elements.length) {
      previewNode.replaceChildren();
      return;
    }
    let canceled = false;

    (async () => {
      const svg = await exportToSvg(
        elements,
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
  }, [elements, theme]);

  return (
    <div
      className="TidyGrid__preview"
      ref={previewRef}
      data-testid="tidy-grid-preview"
    />
  );
};

const DIRECTIONS: readonly TidyDirection[] = ["rows", "columns"];

export const TidyGridDialog = ({ onClose }: { onClose: () => void }) => {
  const app = useApp();
  const { selectedElementIds } = useUIAppState();
  const { id } = useExcalidrawContainer();
  const statusId = `${id}-tidy-grid-status`;

  // the selection is read once: the dialog is modal, so it cannot change
  // underneath it
  const { units, skippedCount } = useMemo(
    () =>
      getTidyUnits(
        app.scene.getSelectedElements({
          selectedElementIds,
        }),
        app.scene.getNonDeletedElementsMap(),
        app.state,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [direction, setDirection] = useState<TidyDirection>("rows");
  const [perLineInput, setPerLineInput] = useState(() =>
    String(Math.max(1, Math.ceil(Math.sqrt(units.length)))),
  );
  const [gapInput, setGapInput] = useState(String(DEFAULT_TIDY_GAP));

  const options: TidyOptions = clampTidyOptions(
    {
      direction,
      perLine: Number(perLineInput),
      gap: Number(gapInput),
    },
    units.length,
  );

  const canApply = units.length > 1;

  const previewElements = useMemo(() => {
    if (!canApply) {
      return [];
    }
    const { elements, changedIds } = applyTidyLayout(
      app.scene.getNonDeletedElements(),
      units,
      options,
    );
    const unitIds = new Set(
      units.flatMap((unit) => unit.elements.map((element) => element.id)),
    );
    return elements.filter(
      (element) => unitIds.has(element.id) || changedIds.has(element.id),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, canApply, options.direction, options.perLine, options.gap]);

  // the editor listens for keys on the document (or its container), so keys
  // pressed inside the portaled dialog would otherwise reach it too: typing a
  // number would switch tools, and Enter on a focused button would start
  // editing the selected shape's label. Escape still bubbles to the Modal.
  const isolateEditorKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== KEYS.ESCAPE) {
      event.stopPropagation();
    }
  };

  const closeDialog = () => {
    onClose();
    // return focus to the editor rather than leaving it on the document body
    app.focusContainer();
  };

  const applyLayout = () => {
    if (!canApply) {
      return;
    }
    // laid out again on the latest scene so nothing previewed is reused
    const { elements } = applyTidyLayout(
      app.scene.getElementsIncludingDeleted(),
      units,
      options,
    );
    app.syncActionResult({
      // items moved into or out of a frame join or leave it, as with align
      // and distribute
      elements: updateFrameMembershipOfSelectedElements(
        elements,
        app.state,
        app,
      ),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    trackEvent("tidyGrid", "apply", options.direction, units.length);
    closeDialog();
  };

  let status = canApply
    ? t("tidyGrid.count", { count: units.length })
    : t("tidyGrid.empty");
  if (skippedCount) {
    status += ` ${t("tidyGrid.skipped", { count: skippedCount })}`;
  }

  const perLineLabel =
    direction === "rows" ? t("tidyGrid.perRow") : t("tidyGrid.perColumn");

  return (
    <Dialog
      size="wide"
      onCloseRequest={closeDialog}
      title={t("tidyGrid.title")}
      className="TidyGridDialog"
    >
      <div onKeyDown={isolateEditorKeys}>
        <div className="TidyGrid__body">
          <div className="TidyGrid__controls">
            <fieldset className="TidyGrid__direction" disabled={!canApply}>
              <legend>{t("tidyGrid.direction")}</legend>
              {DIRECTIONS.map((item) => (
                <label key={item} className="TidyGrid__radio">
                  <input
                    type="radio"
                    name={`${id}-tidy-grid-direction`}
                    value={item}
                    checked={direction === item}
                    data-testid={`tidy-grid-direction-${item}`}
                    onChange={() => setDirection(item)}
                  />
                  {t(`tidyGrid.directions.${item}`)}
                </label>
              ))}
            </fieldset>
            <label className="TidyGrid__field">
              {perLineLabel}
              <input
                type="number"
                min={1}
                max={Math.max(1, units.length)}
                step={1}
                value={perLineInput}
                disabled={!canApply}
                aria-describedby={statusId}
                data-testid="tidy-grid-per-line"
                onChange={(event) => setPerLineInput(event.target.value)}
                onBlur={() => setPerLineInput(String(options.perLine))}
              />
            </label>
            <label className="TidyGrid__field">
              {t("tidyGrid.gap")}
              <input
                type="number"
                min={0}
                max={MAX_TIDY_GAP}
                step={1}
                value={gapInput}
                disabled={!canApply}
                data-testid="tidy-grid-gap"
                onChange={(event) => setGapInput(event.target.value)}
                onBlur={() => setGapInput(String(options.gap))}
              />
            </label>
            <p
              id={statusId}
              className="TidyGrid__status"
              data-testid="tidy-grid-status"
              role="status"
            >
              {status}
            </p>
          </div>
          <section
            className="TidyGrid__previewPanel"
            aria-label={t("tidyGrid.preview")}
          >
            <TidyGridPreview elements={previewElements} />
          </section>
        </div>
        <div className="TidyGrid__actions">
          <DialogActionButton
            label={t("buttons.cancel")}
            data-testid="tidy-grid-cancel"
            onClick={closeDialog}
          />
          <DialogActionButton
            label={t("tidyGrid.apply", { count: units.length })}
            actionType="primary"
            data-testid="tidy-grid-apply"
            disabled={!canApply}
            onClick={applyLayout}
          />
        </div>
      </div>
    </Dialog>
  );
};

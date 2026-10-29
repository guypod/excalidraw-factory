import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { CaptureUpdateAction } from "@excalidraw/element";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { trackEvent } from "../../analytics";
import { useUIAppState } from "../../context/ui-appState";
import { t } from "../../i18n";
import { exportToSvg } from "../../scene/export";
import { useApp, useExcalidrawContainer } from "../App";
import { Dialog } from "../Dialog";
import DialogActionButton from "../DialogActionButton";

import {
  STYLE_PRESETS,
  applyStylePreset,
  getStylePresetTargets,
} from "./stylePresets";

import "./StylePresetsDialog.scss";

import type { StylePreset } from "./stylePresets";

const StylePresetPreview = ({
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
      className="StylePresets__preview"
      ref={previewRef}
      data-testid="style-presets-preview"
    />
  );
};

export const StylePresetsDialog = ({ onClose }: { onClose: () => void }) => {
  const app = useApp();
  const { selectedElementIds } = useUIAppState();
  const { id } = useExcalidrawContainer();
  const [preset, setPreset] = useState<StylePreset>(STYLE_PRESETS[0]);
  const statusId = `${id}-style-presets-status`;

  // the selection is read once: the dialog is modal, so it cannot change
  // underneath it
  const { targetIds, previewSource, skippedCount } = useMemo(() => {
    const selected = app.scene.getSelectedElements({ selectedElementIds });
    const targets = getStylePresetTargets(selected);
    const targetIds = new Set(targets.map((element) => element.id));
    return {
      targetIds,
      // bound text gives the preview the same content as the canvas
      previewSource: app.scene
        .getSelectedElements({
          selectedElementIds,
          includeBoundTextElement: true,
        })
        .filter(
          (element) =>
            targetIds.has(element.id) ||
            ("containerId" in element &&
              element.containerId !== null &&
              targetIds.has(element.containerId)),
        ),
      skippedCount: selected.length - targets.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previewElements = useMemo(
    () => applyStylePreset(previewSource, targetIds, preset),
    [previewSource, targetIds, preset],
  );

  const closeDialog = () => {
    onClose();
    // return focus to the editor rather than leaving it on the document body
    app.focusContainer();
  };

  const applyPreset = () => {
    if (!targetIds.size) {
      return;
    }
    app.syncActionResult({
      elements: applyStylePreset(
        app.scene.getElementsIncludingDeleted(),
        targetIds,
        preset,
      ),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    trackEvent("stylePresets", "apply", preset.id, targetIds.size);
    closeDialog();
  };

  let status = targetIds.size
    ? t("stylePresets.count", { count: targetIds.size })
    : t("stylePresets.empty");
  if (targetIds.size && skippedCount) {
    status += ` ${t("stylePresets.skipped", { count: skippedCount })}`;
  }

  return (
    <Dialog
      size="wide"
      onCloseRequest={closeDialog}
      title={t("stylePresets.title")}
      className="StylePresetsDialog"
    >
      <div className="StylePresets__body">
        <div className="StylePresets__choices">
          <div
            role="radiogroup"
            aria-label={t("stylePresets.choose")}
            aria-describedby={statusId}
            className="StylePresets__list"
          >
            {STYLE_PRESETS.map((item) => {
              const checked = item.id === preset.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  className="StylePresets__option"
                  data-testid={`style-preset-${item.id}`}
                  disabled={!targetIds.size}
                  onClick={() => setPreset(item)}
                >
                  <span
                    className="StylePresets__swatch"
                    aria-hidden="true"
                    style={{
                      borderColor: item.style.strokeColor,
                      borderWidth: item.style.strokeWidth,
                      borderStyle: item.style.strokeStyle,
                      background: item.style.backgroundColor,
                      borderRadius: item.style.rounded ? 6 : 0,
                    }}
                  />
                  {t(`stylePresets.presets.${item.id}`)}
                </button>
              );
            })}
          </div>
          <p
            id={statusId}
            className="StylePresets__status"
            data-testid="style-presets-status"
            role="status"
          >
            {status}
          </p>
        </div>
        <section
          className="StylePresets__previewPanel"
          aria-label={t("stylePresets.preview")}
        >
          <StylePresetPreview elements={previewElements} />
        </section>
      </div>
      <div className="StylePresets__actions">
        <DialogActionButton
          label={t("buttons.cancel")}
          data-testid="style-presets-cancel"
          onClick={closeDialog}
        />
        <DialogActionButton
          label={t("stylePresets.apply", { count: targetIds.size })}
          actionType="primary"
          data-testid="style-presets-apply"
          disabled={!targetIds.size}
          onClick={applyPreset}
        />
      </div>
    </Dialog>
  );
};

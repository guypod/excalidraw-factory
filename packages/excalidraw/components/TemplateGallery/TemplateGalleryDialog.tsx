import clsx from "clsx";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { KEYS } from "@excalidraw/common";

import { trackEvent } from "../../analytics";
import { useUIAppState } from "../../context/ui-appState";
import { t } from "../../i18n";
import { exportToSvg } from "../../scene/export";
import { useApp, useExcalidrawContainer } from "../App";
import { Dialog } from "../Dialog";
import DialogActionButton from "../DialogActionButton";

import { WORKSHOP_TEMPLATES, getWorkshopTemplateElements } from "./templates";

import "./TemplateGalleryDialog.scss";

import type { WorkshopTemplate } from "./templates";

const TemplatePreview = ({ template }: { template: WorkshopTemplate }) => {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const { theme } = useUIAppState();

  useLayoutEffect(() => {
    const previewNode = previewRef.current!;
    let canceled = false;

    (async () => {
      const svg = await exportToSvg(
        getWorkshopTemplateElements(template),
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
      previewNode.replaceChildren();
    };
  }, [template, theme]);

  return (
    <div
      className="TemplateGallery__preview"
      ref={previewRef}
      data-testid="template-gallery-preview"
    />
  );
};

export const TemplateGalleryDialog = ({ onClose }: { onClose: () => void }) => {
  const { onInsertElements, focusContainer } = useApp();
  const { id } = useExcalidrawContainer();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = WORKSHOP_TEMPLATES[selectedIndex];
  const previewTitleId = `${id}-template-gallery-preview-title`;

  useEffect(() => {
    // focus the selected template once the dialog has mounted
    const timeout = setTimeout(() => optionRefs.current[0]?.focus());
    return () => clearTimeout(timeout);
  }, []);

  const closeDialog = () => {
    onClose();
    // the element that opened the dialog may be gone, so return focus to the
    // editor rather than leaving it on the document body
    focusContainer();
  };

  const insertTemplate = (template: WorkshopTemplate) => {
    onInsertElements(getWorkshopTemplateElements(template));
    trackEvent("template", "insert", template.id);
    closeDialog();
  };

  const moveSelection = (index: number) => {
    const count = WORKSHOP_TEMPLATES.length;
    const nextIndex = (index + count) % count;
    setSelectedIndex(nextIndex);
    optionRefs.current[nextIndex]?.focus();
  };

  const handleOptionKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case KEYS.ENTER:
        insertTemplate(selected);
        break;
      case KEYS.ARROW_DOWN:
      case KEYS.ARROW_RIGHT:
        moveSelection(selectedIndex + 1);
        break;
      case KEYS.ARROW_UP:
      case KEYS.ARROW_LEFT:
        moveSelection(selectedIndex - 1);
        break;
      case "Home":
        moveSelection(0);
        break;
      case "End":
        moveSelection(WORKSHOP_TEMPLATES.length - 1);
        break;
      default:
        return;
    }
    // keep handled keys away from the editor's shortcuts, which would
    // otherwise move or edit the selected scene elements
    event.preventDefault();
    event.stopPropagation();
  };

  const labels = useMemo(
    () => WORKSHOP_TEMPLATES.map((template) => template.getLabel()),
    [],
  );

  return (
    <Dialog
      size="wide"
      onCloseRequest={closeDialog}
      title={t("templateGallery.title")}
      className="TemplateGalleryDialog"
      autofocus={false}
    >
      <p className="TemplateGallery__description">
        {t("templateGallery.description")}
      </p>
      <div className="TemplateGallery__body">
        <div
          className="TemplateGallery__options"
          role="radiogroup"
          aria-label={t("templateGallery.templates")}
        >
          {WORKSHOP_TEMPLATES.map((template, index) => {
            const isSelected = index === selectedIndex;
            return (
              <button
                key={template.id}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                type="button"
                role="radio"
                aria-checked={isSelected}
                tabIndex={isSelected ? 0 : -1}
                data-testid={`template-gallery-option-${template.id}`}
                className={clsx("TemplateGallery__option", {
                  "TemplateGallery__option--selected": isSelected,
                })}
                onClick={() => setSelectedIndex(index)}
                onKeyDown={handleOptionKeyDown}
              >
                <span className="TemplateGallery__optionLabel">
                  {labels[index]}
                </span>
                <span className="TemplateGallery__optionDescription">
                  {template.getDescription()}
                </span>
              </button>
            );
          })}
        </div>
        <section
          className="TemplateGallery__previewPanel"
          aria-labelledby={previewTitleId}
        >
          <h3 id={previewTitleId} className="TemplateGallery__previewTitle">
            {t("templateGallery.preview")}: {labels[selectedIndex]}
          </h3>
          <TemplatePreview template={selected} />
        </section>
      </div>
      <div className="TemplateGallery__actions">
        <DialogActionButton
          label={t("buttons.cancel")}
          data-testid="template-gallery-cancel"
          onClick={closeDialog}
        />
        <DialogActionButton
          label={t("templateGallery.insert")}
          actionType="primary"
          data-testid="template-gallery-insert"
          onClick={() => insertTemplate(selected)}
        />
      </div>
    </Dialog>
  );
};

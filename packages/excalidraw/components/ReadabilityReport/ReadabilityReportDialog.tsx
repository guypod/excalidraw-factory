import { useMemo } from "react";

import { KEYS } from "@excalidraw/common";

import { useUIAppState } from "../../context/ui-appState";
import { t } from "../../i18n";
import { useApp, useExcalidrawContainer } from "../App";
import { Dialog } from "../Dialog";
import DialogActionButton from "../DialogActionButton";

import { MIN_READABLE_FONT_SIZE, getReadabilityReport } from "./readability";

import "./ReadabilityReportDialog.scss";

import type { ReadabilityFinding } from "./readability";

const MAX_TEXT_PREVIEW_LENGTH = 40;

const getTextPreview = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > MAX_TEXT_PREVIEW_LENGTH
    ? `${line.slice(0, MAX_TEXT_PREVIEW_LENGTH - 1)}…`
    : line;
};

const FindingItem = ({ finding }: { finding: ReadabilityFinding }) => {
  const readable = !finding.issues.length;
  const details: string[] = [];

  details.push(
    finding.issues.includes("tinyText")
      ? t("readabilityReport.tinyText", {
          size: finding.fontSize,
          min: MIN_READABLE_FONT_SIZE,
        })
      : t("readabilityReport.fontSize", { size: finding.fontSize }),
  );

  if (finding.contrastRatio !== null) {
    const ratio = finding.contrastRatio.toFixed(1);
    const required = finding.requiredContrastRatio.toFixed(1);
    details.push(
      finding.issues.includes("lowContrast")
        ? t("readabilityReport.lowContrast", { ratio, required })
        : t("readabilityReport.contrast", { ratio, required }),
    );
  } else if (finding.limitation) {
    details.push(t(`readabilityReport.limitations.${finding.limitation}`));
  }

  return (
    <li
      className="ReadabilityReport__finding"
      data-testid={`readability-finding-${finding.id}`}
      data-status={readable ? "readable" : "issue"}
      tabIndex={0}
    >
      <span className="ReadabilityReport__findingStatus">
        {readable
          ? t("readabilityReport.readable")
          : t("readabilityReport.needsAttention")}
      </span>
      <span className="ReadabilityReport__findingText">
        {getTextPreview(finding.text) || t("readabilityReport.emptyText")}
      </span>
      <span className="ReadabilityReport__findingDetails">
        {details.join(" ")}
      </span>
    </li>
  );
};

export const ReadabilityReportDialog = ({
  onClose,
}: {
  onClose: () => void;
}) => {
  const app = useApp();
  const { selectedElementIds, theme, viewBackgroundColor } = useUIAppState();
  const { id } = useExcalidrawContainer();
  const summaryId = `${id}-readability-report-summary`;

  // the report is a snapshot: the dialog is modal, so the selection cannot
  // change underneath it, and nothing in the scene is changed
  const report = useMemo(
    () =>
      getReadabilityReport(
        app.scene.getSelectedElements({ selectedElementIds }),
        app.scene.getNonDeletedElementsMap(),
        { theme, viewBackgroundColor },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const issueCount = report.findings.filter(
    (finding) => finding.issues.length,
  ).length;
  const hasLimitations = report.findings.some((finding) => finding.limitation);

  let summary: string;
  if (!report.findings.length) {
    summary = t("readabilityReport.empty");
  } else if (issueCount) {
    summary = t("readabilityReport.summaryIssues", {
      count: issueCount,
      total: report.findings.length,
    });
  } else {
    summary = t("readabilityReport.summaryReadable", {
      total: report.findings.length,
    });
  }
  if (report.findings.length && report.skippedCount) {
    summary += ` ${t("readabilityReport.skipped", {
      count: report.skippedCount,
    })}`;
  }

  // keep keys pressed inside the portaled dialog away from the editor's
  // global handlers; Escape still bubbles to the Modal
  const isolateEditorKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== KEYS.ESCAPE) {
      event.stopPropagation();
    }
  };

  const closeDialog = () => {
    onClose();
    app.focusContainer();
  };

  return (
    <Dialog
      size="regular"
      onCloseRequest={closeDialog}
      title={t("readabilityReport.title")}
      className="ReadabilityReportDialog"
    >
      <div onKeyDown={isolateEditorKeys}>
        <p
          id={summaryId}
          className="ReadabilityReport__summary"
          data-testid="readability-report-summary"
          role="status"
        >
          {summary}
        </p>
        {report.findings.length > 0 && (
          <ul
            className="ReadabilityReport__findings"
            aria-label={t("readabilityReport.findings")}
            aria-describedby={summaryId}
          >
            {report.findings.map((finding) => (
              <FindingItem key={finding.id} finding={finding} />
            ))}
          </ul>
        )}
        <section
          className="ReadabilityReport__notes"
          aria-label={t("readabilityReport.notesTitle")}
          data-testid="readability-report-notes"
        >
          <p>{t("readabilityReport.notes.advisory")}</p>
          <p>{t("readabilityReport.notes.background")}</p>
          {hasLimitations && <p>{t("readabilityReport.notes.unmeasured")}</p>}
        </section>
        <div className="ReadabilityReport__actions">
          <DialogActionButton
            label={t("buttons.close")}
            data-testid="readability-report-close"
            onClick={closeDialog}
          />
        </div>
      </div>
    </Dialog>
  );
};

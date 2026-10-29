import { useMemo } from "react";

import { KEYS } from "@excalidraw/common";

import { useUIAppState } from "../../context/ui-appState";
import { t } from "../../i18n";
import { useApp, useExcalidrawContainer } from "../App";
import { Dialog } from "../Dialog";
import DialogActionButton from "../DialogActionButton";

import {
  MIN_READABLE_FONT_SIZE,
  getFindingStatus,
  getReadabilityReport,
} from "./readability";

import "./ReadabilityReportDialog.scss";

import type { ReadabilityFinding, ReadabilityStatus } from "./readability";

// the full text stays in the DOM so screen readers can tell entries apart;
// the stylesheet truncates it visually
const getTextPreview = (text: string) => text.replace(/\s+/g, " ").trim();

const STATUS_LABELS: Record<
  ReadabilityStatus,
  | "readabilityReport.readable"
  | "readabilityReport.needsAttention"
  | "readabilityReport.notChecked"
> = {
  readable: "readabilityReport.readable",
  issue: "readabilityReport.needsAttention",
  unchecked: "readabilityReport.notChecked",
};

const FindingItem = ({ finding }: { finding: ReadabilityFinding }) => {
  const status = getFindingStatus(finding);
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

  const preview = getTextPreview(finding.text);

  return (
    <li
      className="ReadabilityReport__finding"
      data-testid={`readability-finding-${finding.id}`}
      data-status={status}
      tabIndex={0}
    >
      <span className="ReadabilityReport__findingStatus">
        {t(STATUS_LABELS[status])}
      </span>
      <span className="ReadabilityReport__findingText" title={preview}>
        {preview || t("readabilityReport.emptyText")}
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

  const statuses = report.findings.map(getFindingStatus);
  const issueCount = statuses.filter((status) => status === "issue").length;
  const uncheckedCount = statuses.filter(
    (status) => status === "unchecked",
  ).length;
  const hasLimitations = report.findings.some((finding) => finding.limitation);

  let summary: string;
  if (!report.findings.length) {
    summary = t("readabilityReport.empty");
  } else if (issueCount || uncheckedCount) {
    const parts: string[] = [];
    if (issueCount) {
      parts.push(
        t("readabilityReport.summaryIssues", {
          count: issueCount,
          total: report.findings.length,
        }),
      );
    }
    if (uncheckedCount) {
      parts.push(
        t("readabilityReport.summaryUnchecked", {
          count: uncheckedCount,
          total: report.findings.length,
        }),
      );
    }
    summary = parts.join(" ");
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

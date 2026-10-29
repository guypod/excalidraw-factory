import React from "react";

import { KEYS, THEME, arrayToMap, reseed } from "@excalidraw/common";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  MIN_READABLE_FONT_SIZE,
  getContrastRatio,
  getReadabilityReport,
  hasReadabilityTargets,
} from "../components/ReadabilityReport/readability";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import {
  act,
  fireEvent,
  queryByTestId,
  render,
  unmountComponent,
  waitFor,
} from "./test-utils";

const { h } = window;

const LIGHT = { theme: THEME.LIGHT, viewBackgroundColor: "#ffffff" } as const;

const reportFor = (
  selected: readonly ExcalidrawElement[],
  all: readonly ExcalidrawElement[] = selected,
  appState: {
    theme: typeof THEME[keyof typeof THEME];
    viewBackgroundColor: string;
  } = LIGHT,
) => getReadabilityReport(selected as any, arrayToMap(all) as any, appState);

let labelledCount = 0;

/** A container with a bound label, built without a rendered editor. */
const createLabelled = ({
  container = {},
  label = {},
}: {
  container?: Partial<ExcalidrawElement>;
  label?: { text?: string; fontSize?: number; strokeColor?: string };
} = {}) => {
  labelledCount++;
  const boxId = `box-${labelledCount}`;
  const textId = `label-${labelledCount}`;
  const box = API.createElement({
    type: "rectangle",
    id: boxId,
    boundElements: [{ type: "text", id: textId }],
    ...(container as any),
  });
  const text = API.createElement({
    type: "text",
    id: textId,
    text: label.text ?? "label",
    fontSize: label.fontSize ?? 20,
    strokeColor: label.strokeColor ?? "#1e1e1e",
    containerId: boxId,
  });
  return [box, text] as const;
};

/** A readable label and an unreadable one: tiny, pale text on a pale fill. */
const createExampleScene = () => {
  const readable = API.createElement({
    type: "text",
    text: "Readable heading",
    fontSize: 20,
    strokeColor: "#1e1e1e",
  });
  const [box, label] = createLabelled({
    container: { backgroundColor: "#ffec99", fillStyle: "solid" },
    label: { text: "faint fine print", fontSize: 8, strokeColor: "#ffd8a8" },
  });
  return { readable, box, label };
};

describe("readability checks", () => {
  it("computes WCAG contrast ratios", () => {
    const black = { r: 0, g: 0, b: 0 };
    const white = { r: 255, g: 255, b: 255 };
    expect(getContrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(getContrastRatio(white, white)).toBeCloseTo(1, 5);
    // #767676 on white is the classic 4.5:1 boundary
    expect(
      getContrastRatio({ r: 0x76, g: 0x76, b: 0x76 }, white),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("passes readable text and flags tiny, low-contrast text", () => {
    const { readable, box, label } = createExampleScene();
    const all = [readable, box, label];

    const ok = reportFor([readable], all);
    expect(ok.findings).toHaveLength(1);
    expect(ok.findings[0]).toEqual(
      expect.objectContaining({
        id: readable.id,
        issues: [],
        backgroundSource: "canvas",
        limitation: null,
      }),
    );
    expect(ok.findings[0].contrastRatio).toBeGreaterThan(15);

    // selecting the container reports its bound label against its fill
    const bad = reportFor([box], all);
    expect(bad.findings).toHaveLength(1);
    expect(bad.findings[0]).toEqual(
      expect.objectContaining({
        id: label.id,
        selectedId: box.id,
        text: "faint fine print",
        fontSize: 8,
        backgroundSource: "container",
        issues: ["tinyText", "lowContrast"],
      }),
    );
    expect(bad.findings[0].contrastRatio).toBeLessThan(2);
  });

  it("uses the lower WCAG threshold for large text", () => {
    const large = API.createElement({
      type: "text",
      fontSize: 28,
      strokeColor: "#868e96",
    });
    const small = API.createElement({
      type: "text",
      fontSize: 16,
      strokeColor: "#868e96",
    });
    const [largeFinding] = reportFor([large]).findings;
    const [smallFinding] = reportFor([small]).findings;
    expect(largeFinding.requiredContrastRatio).toBe(3);
    expect(largeFinding.issues).toEqual([]);
    expect(smallFinding.requiredContrastRatio).toBe(4.5);
    expect(smallFinding.issues).toEqual(["lowContrast"]);
  });

  it("flags text below the minimum size regardless of contrast", () => {
    const tiny = API.createElement({
      type: "text",
      fontSize: MIN_READABLE_FONT_SIZE - 1,
    });
    const minimum = API.createElement({
      type: "text",
      fontSize: MIN_READABLE_FONT_SIZE,
    });
    expect(reportFor([tiny]).findings[0].issues).toEqual(["tinyText"]);
    expect(reportFor([minimum]).findings[0].issues).toEqual([]);
  });

  it("checks against the canvas when the container has no fill", () => {
    const [box, label] = createLabelled();
    const { findings } = reportFor([box], [box, label], {
      theme: THEME.LIGHT,
      viewBackgroundColor: "#1e1e1e",
    });
    expect(findings[0].backgroundSource).toBe("canvas");
    expect(findings[0].issues).toEqual(["lowContrast"]);
  });

  it("measures the colors as painted in dark mode", () => {
    const text = API.createElement({ type: "text", strokeColor: "#1e1e1e" });
    const light = reportFor([text]).findings[0];
    const dark = reportFor([text], [text], {
      theme: THEME.DARK,
      viewBackgroundColor: "#ffffff",
    }).findings[0];
    // both inverted together, so both stay readable
    expect(light.issues).toEqual([]);
    expect(dark.issues).toEqual([]);
    expect(dark.contrastRatio).not.toBe(light.contrastRatio);
  });

  it("explains instead of guessing for transparent and pattern backgrounds", () => {
    const fadedText = API.createElement({ type: "text", opacity: 50 });
    expect(reportFor([fadedText]).findings[0]).toEqual(
      expect.objectContaining({
        contrastRatio: null,
        limitation: "transparentText",
        issues: [],
      }),
    );

    const [hatched, label] = createLabelled({
      container: { backgroundColor: "#a5d8ff", fillStyle: "hachure" },
    });
    expect(reportFor([hatched], [hatched, label]).findings[0]).toEqual(
      expect.objectContaining({
        contrastRatio: null,
        limitation: "patternBackground",
      }),
    );

    const [faded, fadedLabel] = createLabelled({
      container: {
        backgroundColor: "#a5d8ff",
        fillStyle: "solid",
        opacity: 40,
      },
    });
    expect(reportFor([faded], [faded, fadedLabel]).findings[0].limitation).toBe(
      "transparentBackground",
    );

    const text = API.createElement({ type: "text" });
    expect(
      reportFor([text], [text], {
        theme: THEME.LIGHT,
        viewBackgroundColor: "transparent",
      }).findings[0].limitation,
    ).toBe("transparentCanvas");
  });

  it("skips selected elements without text and reports each text once", () => {
    const [box, label] = createLabelled();
    const image = API.createElement({ type: "image" });
    const arrow = API.createElement({ type: "arrow" });
    // the container and its own label both selected
    const report = reportFor([box, label, image, arrow], [box, label, image]);
    expect(report.findings.map((finding) => finding.id)).toEqual([label.id]);
    expect(report.skippedCount).toBe(2);

    expect(hasReadabilityTargets([image, arrow])).toBe(false);
    expect(hasReadabilityTargets([image, box])).toBe(true);
  });
});

describe("<ReadabilityReportDialog/>", () => {
  beforeEach(async () => {
    unmountComponent();
    reseed(7);
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  const getDialog = () =>
    document.querySelector(".ReadabilityReportDialog") as HTMLElement | null;

  const openDialog = async () => {
    act(() => {
      API.setAppState({ openDialog: { name: "readabilityReport" } });
    });
    await waitFor(() => expect(getDialog()).not.toBeNull());
  };

  it("opens from the selection actions only when the selection has text", async () => {
    const image = API.createElement({ type: "image" });
    const { readable } = createExampleScene();
    API.setElements([image, readable]);

    API.setSelectedElements([image]);
    await waitFor(() =>
      expect(
        queryByTestId(document.body, "readability-report-button"),
      ).toBeNull(),
    );

    API.setSelectedElements([image, readable]);
    await waitFor(() =>
      expect(
        queryByTestId(document.body, "readability-report-button"),
      ).not.toBeNull(),
    );
    fireEvent.click(queryByTestId(document.body, "readability-report-button")!);
    expect(h.state.openDialog).toEqual({ name: "readabilityReport" });
  });

  it("reports readable and unreadable text without changing the scene", async () => {
    const { readable, box, label } = createExampleScene();
    API.setElements([readable, box, label]);
    API.setSelectedElements([readable, box]);
    const before = h.elements;
    const selectionBefore = h.state.selectedElementIds;
    const undoStackSize = API.getUndoStack().length;

    await openDialog();
    const dialog = getDialog()!;
    expect(
      queryByTestId(dialog, "readability-report-summary")!.textContent,
    ).toBe("1 of 2 text(s) may be hard to read.");

    const ok = queryByTestId(dialog, `readability-finding-${readable.id}`)!;
    expect(ok.getAttribute("data-status")).toBe("readable");
    expect(ok.textContent).toContain("Readable heading");

    const bad = queryByTestId(dialog, `readability-finding-${label.id}`)!;
    expect(bad.getAttribute("data-status")).toBe("issue");
    expect(bad.textContent).toContain("Tiny text: font size 8");
    expect(bad.textContent).toContain("Low contrast");

    expect(
      queryByTestId(dialog, "readability-report-notes")!.textContent,
    ).toContain("does not change your drawing");

    fireEvent.click(queryByTestId(dialog, "readability-report-close")!);
    expect(getDialog()).toBeNull();
    expect(h.elements).toBe(before);
    expect(h.state.selectedElementIds).toEqual(selectionBefore);
    expect(API.getUndoStack().length).toBe(undoStackSize);
  });

  it("explains limitations when contrast cannot be measured", async () => {
    const faded = API.createElement({ type: "text", opacity: 30 });
    API.setElements([faded]);
    API.setSelectedElements([faded]);

    await openDialog();
    expect(
      queryByTestId(getDialog()!, `readability-finding-${faded.id}`)!
        .textContent,
    ).toContain("Contrast not checked: the text is semi-transparent.");
    expect(
      queryByTestId(getDialog()!, "readability-report-notes")!.textContent,
    ).toContain("Check those by eye.");
  });

  it("is keyboard accessible and keeps keys away from the editor", async () => {
    const { readable } = createExampleScene();
    API.setElements([readable]);
    API.setSelectedElements([readable]);

    await openDialog();
    const finding = queryByTestId(
      getDialog()!,
      `readability-finding-${readable.id}`,
    )!;
    // findings are reachable with Tab so screen reader users can read each
    expect(finding.tabIndex).toBe(0);
    expect(
      getDialog()!.querySelector('[role="status"]')!.textContent,
    ).toBeTruthy();

    // Delete inside the dialog does not delete the selected element
    finding.focus();
    fireEvent.keyDown(finding, { key: KEYS.DELETE });
    expect(h.elements.find((el) => el.id === readable.id)!.isDeleted).toBe(
      false,
    );

    fireEvent.keyDown(getDialog()!, { key: KEYS.ESCAPE });
    expect(getDialog()).toBeNull();
    expect(document.activeElement).toBe(
      document.querySelector(".excalidraw-container"),
    );
  });
});

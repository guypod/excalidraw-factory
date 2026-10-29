import {
  THEME,
  applyDarkModeFilter,
  colorToHex,
  isTransparent,
} from "@excalidraw/common";
import {
  getBoundTextElement,
  hasBoundTextElement,
  isBoundToContainer,
  isTextElement,
} from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawTextElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import type { AppState } from "../../types";

/** Smallest font size, in scene px at 100% zoom, the report calls readable. */
export const MIN_READABLE_FONT_SIZE = 12;

/** WCAG 2.x minimum contrast ratios (AA). */
export const MIN_CONTRAST_RATIO = 4.5;
export const MIN_LARGE_TEXT_CONTRAST_RATIO = 3;
/** 18pt, the WCAG "large text" size, in px. */
export const LARGE_TEXT_FONT_SIZE = 24;

export type ReadabilityIssue = "tinyText" | "lowContrast";

/**
 * Why contrast could not be measured. The report only knows the text's own
 * colors and the one surface it is drawn on, so anything that lets other
 * pixels show through is reported rather than guessed.
 */
export type ReadabilityLimitation =
  | "transparentText"
  | "transparentBackground"
  | "patternBackground"
  | "transparentCanvas";

export type ReadabilityBackgroundSource = "container" | "canvas";

export type ReadabilityFinding = {
  /** the text element that was checked */
  id: ExcalidrawTextElement["id"];
  /** the selected element the text belongs to (itself or its container) */
  selectedId: ExcalidrawElement["id"];
  text: string;
  fontSize: number;
  /** null when a limitation prevents measuring it */
  contrastRatio: number | null;
  requiredContrastRatio: number;
  backgroundSource: ReadabilityBackgroundSource;
  issues: ReadabilityIssue[];
  limitation: ReadabilityLimitation | null;
};

export type ReadabilityReport = {
  findings: ReadabilityFinding[];
  /** selected elements that carry no text the report can check */
  skippedCount: number;
};

type RGB = { r: number; g: number; b: number };

const toLinear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const relativeLuminance = ({ r, g, b }: RGB) =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

/** WCAG contrast ratio of two opaque colors, from 1 to 21. */
export const getContrastRatio = (a: RGB, b: RGB) => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** The color as it is painted in the given theme, or null if not opaque. */
const getOpaqueRenderedColor = (
  color: string,
  theme: AppState["theme"],
): RGB | null => {
  const hex = colorToHex(applyDarkModeFilter(color, theme === THEME.DARK));
  // #RRGGBBAA means the color is not fully opaque
  if (!hex || hex.length !== 7) {
    return null;
  }
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
};

/** The text elements a selected element contributes, if any. */
const getCheckableTexts = (
  element: NonDeletedExcalidrawElement,
  elementsMap: ElementsMap,
): ExcalidrawTextElement[] => {
  if (isTextElement(element)) {
    return [element];
  }
  const boundText = getBoundTextElement(element, elementsMap);
  return boundText && !boundText.isDeleted ? [boundText] : [];
};

const measureContrast = (
  text: ExcalidrawTextElement,
  container: ExcalidrawElement | null,
  appState: Pick<AppState, "theme" | "viewBackgroundColor">,
): Pick<
  ReadabilityFinding,
  "contrastRatio" | "backgroundSource" | "limitation"
> => {
  let backgroundSource: ReadabilityBackgroundSource = "canvas";
  let background = appState.viewBackgroundColor;

  if (container && !isTransparent(container.backgroundColor)) {
    backgroundSource = "container";
    if (container.fillStyle !== "solid") {
      return {
        contrastRatio: null,
        backgroundSource,
        limitation: "patternBackground",
      };
    }
    if (container.opacity < 100) {
      return {
        contrastRatio: null,
        backgroundSource,
        limitation: "transparentBackground",
      };
    }
    background = container.backgroundColor;
  }

  const backgroundColor = getOpaqueRenderedColor(background, appState.theme);
  if (!backgroundColor) {
    return {
      contrastRatio: null,
      backgroundSource,
      limitation:
        backgroundSource === "canvas"
          ? "transparentCanvas"
          : "transparentBackground",
    };
  }

  const textColor =
    text.opacity < 100
      ? null
      : getOpaqueRenderedColor(text.strokeColor, appState.theme);
  if (!textColor) {
    return {
      contrastRatio: null,
      backgroundSource,
      limitation: "transparentText",
    };
  }

  return {
    contrastRatio: getContrastRatio(textColor, backgroundColor),
    backgroundSource,
    limitation: null,
  };
};

/**
 * Checks the text in the selected elements for tiny font sizes and low
 * text/background contrast. Advisory only: it reads the scene and never
 * changes it.
 */
export const getReadabilityReport = (
  selectedElements: readonly NonDeletedExcalidrawElement[],
  elementsMap: ElementsMap,
  appState: Pick<AppState, "theme" | "viewBackgroundColor">,
): ReadabilityReport => {
  const findings: ReadabilityFinding[] = [];
  const seen = new Set<string>();
  let skippedCount = 0;

  for (const element of selectedElements) {
    const texts = getCheckableTexts(element, elementsMap);
    if (!texts.length) {
      skippedCount++;
      continue;
    }
    for (const text of texts) {
      if (seen.has(text.id)) {
        continue;
      }
      seen.add(text.id);

      const container = isBoundToContainer(text)
        ? elementsMap.get(text.containerId) ?? null
        : null;
      const contrast = measureContrast(text, container, appState);
      const requiredContrastRatio =
        text.fontSize >= LARGE_TEXT_FONT_SIZE
          ? MIN_LARGE_TEXT_CONTRAST_RATIO
          : MIN_CONTRAST_RATIO;

      const issues: ReadabilityIssue[] = [];
      if (text.fontSize < MIN_READABLE_FONT_SIZE) {
        issues.push("tinyText");
      }
      if (
        contrast.contrastRatio !== null &&
        contrast.contrastRatio < requiredContrastRatio
      ) {
        issues.push("lowContrast");
      }

      findings.push({
        id: text.id,
        selectedId: element.id,
        text: text.originalText || text.text,
        fontSize: text.fontSize,
        requiredContrastRatio,
        issues,
        ...contrast,
      });
    }
  }

  return { findings, skippedCount };
};

/** Whether the selection has any text the report can check. */
export const hasReadabilityTargets = (
  selectedElements: readonly ExcalidrawElement[],
) =>
  selectedElements.some(
    (element) => isTextElement(element) || hasBoundTextElement(element),
  );

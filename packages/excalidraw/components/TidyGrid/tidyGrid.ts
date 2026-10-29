import {
  Scene,
  deepCopyElement,
  getCommonBoundingBox,
  getSelectedElementsByGroup,
  isArrowElement,
  isBoundToContainer,
  isFrameLikeElement,
  updateBoundElements,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import type { AppState } from "../../types";

export type TidyDirection = "rows" | "columns";

export type TidyOptions = {
  /** "rows" fills rows left to right, "columns" fills columns top to bottom */
  direction: TidyDirection;
  /** items per row (rows) or per column (columns) */
  perLine: number;
  gap: number;
};

export const DEFAULT_TIDY_GAP = 20;
export const MAX_TIDY_GAP = 400;

/** A selected element or group, with its bound text, that moves as one. */
export type TidyUnit = {
  elements: ExcalidrawElement[];
  box: ReturnType<typeof getCommonBoundingBox>;
};

/**
 * Frames move their children with them, and an arrow bound to something
 * outside its own unit is placed by its bindings, so neither is laid out.
 */
const isTidyable = (unit: readonly ExcalidrawElement[]) => {
  const ids = new Set(unit.map((element) => element.id));
  return unit.every((element) => {
    if (isFrameLikeElement(element)) {
      return false;
    }
    if (isArrowElement(element)) {
      return [element.startBinding, element.endBinding].every(
        (binding) => !binding || ids.has(binding.elementId),
      );
    }
    return true;
  });
};

/**
 * Splits the selection into units to arrange and units left in place. Units
 * are sorted in reading order (top, then left, then id) so the same selection
 * always gives the same layout.
 */
export const getTidyUnits = (
  selectedElements: NonDeletedExcalidrawElement[],
  elementsMap: Parameters<typeof getSelectedElementsByGroup>[1],
  appState: Readonly<AppState>,
) => {
  const units: TidyUnit[] = [];
  let skippedCount = 0;
  for (const group of getSelectedElementsByGroup(
    selectedElements.filter((element) => !element.isDeleted),
    elementsMap,
    appState,
  )) {
    if (!group.length) {
      continue;
    }
    if (!isTidyable(group)) {
      skippedCount++;
      continue;
    }
    units.push({ elements: group, box: getCommonBoundingBox(group) });
  }
  const firstId = (unit: TidyUnit) =>
    unit.elements.map((element) => element.id).sort()[0];
  units.sort(
    (a, b) =>
      a.box.minY - b.box.minY ||
      a.box.minX - b.box.minX ||
      (firstId(a) < firstId(b) ? -1 : 1),
  );
  return { units, skippedCount };
};

export const clampTidyOptions = (
  options: TidyOptions,
  unitCount: number,
): TidyOptions => ({
  direction: options.direction,
  perLine: Math.min(
    Math.max(1, Math.round(options.perLine) || 1),
    Math.max(1, unitCount),
  ),
  gap: Math.min(Math.max(0, Math.round(options.gap) || 0), MAX_TIDY_GAP),
});

/**
 * Returns the x/y offset for each unit. The grid starts at the top-left of
 * the units' common bounds; each column is as wide as its widest item and
 * each row as tall as its tallest, and items sit at the top-left of a cell.
 */
export const getTidyTranslations = (
  units: readonly TidyUnit[],
  options: TidyOptions,
) => {
  if (!units.length) {
    return [];
  }
  const { direction, perLine, gap } = clampTidyOptions(options, units.length);
  const cells = units.map((_, index) =>
    direction === "rows"
      ? { row: Math.floor(index / perLine), col: index % perLine }
      : { row: index % perLine, col: Math.floor(index / perLine) },
  );

  const widths: number[] = [];
  const heights: number[] = [];
  units.forEach((unit, index) => {
    const { row, col } = cells[index];
    widths[col] = Math.max(widths[col] ?? 0, unit.box.width);
    heights[row] = Math.max(heights[row] ?? 0, unit.box.height);
  });
  const offsets = (sizes: number[]) => {
    const result: number[] = [];
    let position = 0;
    for (const size of sizes) {
      result.push(position);
      position += size + gap;
    }
    return result;
  };
  const colX = offsets(widths);
  const rowY = offsets(heights);

  const originX = Math.min(...units.map((unit) => unit.box.minX));
  const originY = Math.min(...units.map((unit) => unit.box.minY));

  return units.map((unit, index) => {
    const { row, col } = cells[index];
    return {
      x: originX + colX[col] - unit.box.minX,
      y: originY + rowY[row] - unit.box.minY,
    };
  });
};

/**
 * Returns `elements` with the units moved into the grid and arrows bound to
 * them rerouted. The work happens on copies in a scratch scene, so the
 * passed elements are never mutated, and elements that did not change keep
 * their identity.
 */
export const applyTidyLayout = <T extends ExcalidrawElement>(
  elements: readonly T[],
  units: readonly TidyUnit[],
  options: TidyOptions,
): { elements: T[]; changedIds: Set<string> } => {
  const translations = getTidyTranslations(units, options);
  const scene = new Scene(
    elements.map((element) => deepCopyElement<ExcalidrawElement>(element)),
    { skipValidation: true },
  );
  // the scene may bump versions while repairing indices, so changes are
  // measured from here
  const baseVersions = new Map(
    scene
      .getElementsIncludingDeleted()
      .map((element) => [element.id, element.version]),
  );

  units.forEach((unit, index) => {
    const { x, y } = translations[index];
    if (!x && !y) {
      return;
    }
    const copies = unit.elements
      .map((element) => scene.getElement(element.id))
      .filter((element): element is ExcalidrawElement => !!element);
    for (const copy of copies) {
      scene.mutateElement(copy, { x: copy.x + x, y: copy.y + y });
    }
    for (const copy of copies) {
      if (!copy.isDeleted) {
        updateBoundElements(copy, scene, { simultaneouslyUpdated: copies });
      }
    }
  });

  const changedIds = new Set<string>();
  const next = elements.map((element) => {
    const copy = scene.getElement(element.id);
    if (!copy || copy.version === baseVersions.get(element.id)) {
      return element;
    }
    changedIds.add(element.id);
    return copy as T;
  });
  return { elements: next, changedIds };
};

/** Whether the selection is worth offering a tidy for: two or more items. */
export const hasTidyTargets = (
  selectedElements: readonly NonDeletedExcalidrawElement[],
) =>
  selectedElements.filter(
    (element) => !isBoundToContainer(element) && !isFrameLikeElement(element),
  ).length > 1;

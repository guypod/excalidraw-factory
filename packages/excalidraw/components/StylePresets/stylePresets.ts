import { COLOR_PALETTE, ROUGHNESS, ROUNDNESS } from "@excalidraw/common";
import { newElementWith } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

/** Closed shapes whose stroke, fill and edges a preset can restyle. */
const STYLE_PRESET_TYPES = new Set<ExcalidrawElement["type"]>([
  "rectangle",
  "diamond",
  "ellipse",
]);

export type StylePresetId = "clean" | "sketch" | "highlight" | "bold" | "muted";

export type StylePreset = {
  id: StylePresetId;
  style: Pick<
    ExcalidrawElement,
    | "strokeColor"
    | "backgroundColor"
    | "fillStyle"
    | "strokeWidth"
    | "strokeStyle"
    | "roughness"
    | "opacity"
  > & { rounded: boolean };
};

export const STYLE_PRESETS: readonly StylePreset[] = [
  {
    id: "clean",
    style: {
      strokeColor: COLOR_PALETTE.black,
      backgroundColor: COLOR_PALETTE.transparent,
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: ROUGHNESS.architect,
      opacity: 100,
      rounded: true,
    },
  },
  {
    id: "sketch",
    style: {
      strokeColor: COLOR_PALETTE.black,
      backgroundColor: COLOR_PALETTE.gray[1],
      fillStyle: "hachure",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: ROUGHNESS.cartoonist,
      opacity: 100,
      rounded: false,
    },
  },
  {
    id: "highlight",
    style: {
      strokeColor: COLOR_PALETTE.orange[4],
      backgroundColor: COLOR_PALETTE.yellow[1],
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: ROUGHNESS.artist,
      opacity: 100,
      rounded: true,
    },
  },
  {
    id: "bold",
    style: {
      strokeColor: COLOR_PALETTE.blue[4],
      backgroundColor: COLOR_PALETTE.blue[1],
      fillStyle: "solid",
      strokeWidth: 4,
      strokeStyle: "solid",
      roughness: ROUGHNESS.architect,
      opacity: 100,
      rounded: true,
    },
  },
  {
    id: "muted",
    style: {
      strokeColor: COLOR_PALETTE.gray[3],
      backgroundColor: COLOR_PALETTE.gray[0],
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "dashed",
      roughness: ROUGHNESS.architect,
      opacity: 100,
      rounded: true,
    },
  },
];

export const isStylePresetCompatible = (element: ExcalidrawElement) =>
  STYLE_PRESET_TYPES.has(element.type);

/** Selected elements a preset will restyle; everything else is left alone. */
export const getStylePresetTargets = (
  selectedElements: readonly NonDeletedExcalidrawElement[],
) => selectedElements.filter(isStylePresetCompatible);

const getRoundness = (
  element: ExcalidrawElement,
  rounded: boolean,
): ExcalidrawElement["roundness"] => {
  if (!rounded) {
    return null;
  }
  // keep an existing rounding type so the shape's corners do not jump
  if (element.roundness) {
    return element.roundness;
  }
  return {
    type:
      element.type === "rectangle"
        ? ROUNDNESS.ADAPTIVE_RADIUS
        : ROUNDNESS.PROPORTIONAL_RADIUS,
  };
};

/**
 * Returns `elements` with the preset applied to every compatible element whose
 * id is in `targetIds`. Only style properties change, so text, bindings,
 * grouping and position are preserved, and other elements keep their identity.
 */
export const applyStylePreset = <T extends ExcalidrawElement>(
  elements: readonly T[],
  targetIds: ReadonlySet<string>,
  preset: StylePreset,
): T[] => {
  const { rounded, ...style } = preset.style;
  return elements.map((element) => {
    if (!targetIds.has(element.id) || !isStylePresetCompatible(element)) {
      return element;
    }
    return newElementWith(element as ExcalidrawElement, {
      ...style,
      roundness: getRoundness(element, rounded),
    }) as T;
  });
};

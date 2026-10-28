import { COLOR_PALETTE } from "@excalidraw/common";
import { convertToExcalidrawElements } from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { LocalPoint } from "@excalidraw/math";

import { t } from "../../i18n";

export type WorkshopTemplateId =
  | "retrospective"
  | "decisionMatrix"
  | "storyMap";

export type WorkshopTemplate = {
  id: WorkshopTemplateId;
  getLabel: () => string;
  getDescription: () => string;
  getSkeleton: () => ExcalidrawElementSkeleton[];
};

const STICKY_SIZE = 160;
const GAP = 20;

const title = (text: string): ExcalidrawElementSkeleton => ({
  type: "text",
  x: 0,
  y: 0,
  text,
  fontSize: 36,
});

const labeledBox = (opts: {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  backgroundColor?: string;
  fontSize?: number;
}): ExcalidrawElementSkeleton => ({
  type: "rectangle",
  x: opts.x,
  y: opts.y,
  width: opts.width,
  height: opts.height,
  backgroundColor: opts.backgroundColor ?? "transparent",
  fillStyle: "solid",
  roundness: { type: 3 },
  label: { text: opts.text, fontSize: opts.fontSize ?? 20 },
});

const getRetrospectiveSkeleton = (): ExcalidrawElementSkeleton[] => {
  const columnWidth = 300;
  const columns = [
    {
      text: t("templateGallery.retrospective.wentWell"),
      color: COLOR_PALETTE.green[1],
    },
    {
      text: t("templateGallery.retrospective.toImprove"),
      color: COLOR_PALETTE.red[1],
    },
    {
      text: t("templateGallery.retrospective.actionItems"),
      color: COLOR_PALETTE.blue[1],
    },
  ];

  return [
    title(t("templateGallery.retrospective.label")),
    ...columns.flatMap((column, index) => {
      const x = index * (columnWidth + GAP);
      return [
        labeledBox({
          x,
          y: 70,
          width: columnWidth,
          height: 60,
          text: column.text,
          backgroundColor: column.color,
        }),
        {
          type: "rectangle",
          x,
          y: 140,
          width: columnWidth,
          height: 420,
          roundness: { type: 3 },
        } as const,
        labeledBox({
          x: x + (columnWidth - STICKY_SIZE) / 2,
          y: 160,
          width: STICKY_SIZE,
          height: STICKY_SIZE * 0.6,
          text: t("templateGallery.note"),
          backgroundColor: COLOR_PALETTE.yellow[1],
          fontSize: 16,
        }),
      ];
    }),
  ];
};

const getDecisionMatrixSkeleton = (): ExcalidrawElementSkeleton[] => {
  const cellWidth = 160;
  const cellHeight = 70;
  const headers = [
    t("templateGallery.decisionMatrix.option"),
    t("templateGallery.decisionMatrix.impact"),
    t("templateGallery.decisionMatrix.effort"),
    t("templateGallery.decisionMatrix.risk"),
    t("templateGallery.decisionMatrix.score"),
  ];
  const options = ["A", "B", "C"].map((letter) =>
    t("templateGallery.decisionMatrix.optionName", { letter }),
  );
  const top = 70;

  return [
    title(t("templateGallery.decisionMatrix.label")),
    ...headers.map((text, col) =>
      labeledBox({
        x: col * cellWidth,
        y: top,
        width: cellWidth,
        height: cellHeight,
        text,
        backgroundColor: COLOR_PALETTE.blue[1],
      }),
    ),
    ...options.flatMap((option, row) =>
      headers.map((_, col) => {
        const x = col * cellWidth;
        const y = top + (row + 1) * cellHeight;
        return col === 0
          ? labeledBox({
              x,
              y,
              width: cellWidth,
              height: cellHeight,
              text: option,
              backgroundColor: COLOR_PALETTE.gray[1],
            })
          : ({
              type: "rectangle",
              x,
              y,
              width: cellWidth,
              height: cellHeight,
            } as const);
      }),
    ),
  ];
};

const getStoryMapSkeleton = (): ExcalidrawElementSkeleton[] => {
  const cardWidth = 200;
  const cardHeight = 80;
  const activities = [1, 2, 3].map((n) =>
    t("templateGallery.storyMap.activity", { n }),
  );
  const journeyY = 70;
  const activityY = journeyY + 50;
  const releaseY = activityY + cardHeight + GAP + 2 * (cardHeight + GAP);
  const totalWidth =
    activities.length * cardWidth + (activities.length - 1) * GAP;

  return [
    title(t("templateGallery.storyMap.label")),
    {
      type: "arrow",
      x: 0,
      y: journeyY,
      width: totalWidth,
      height: 0,
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(totalWidth, 0),
      ],
      label: { text: t("templateGallery.storyMap.journey"), fontSize: 16 },
    },
    ...activities.flatMap((activity, col) => {
      const x = col * (cardWidth + GAP);
      return [
        labeledBox({
          x,
          y: activityY,
          width: cardWidth,
          height: cardHeight,
          text: activity,
          backgroundColor: COLOR_PALETTE.blue[1],
        }),
        ...[1, 2].map((row) =>
          labeledBox({
            x,
            y: activityY + row * (cardHeight + GAP),
            width: cardWidth,
            height: cardHeight,
            text: t("templateGallery.storyMap.story"),
            backgroundColor: COLOR_PALETTE.yellow[1],
            fontSize: 16,
          }),
        ),
      ];
    }),
    {
      type: "line",
      x: 0,
      y: releaseY,
      width: totalWidth,
      height: 0,
      strokeStyle: "dashed",
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(totalWidth, 0),
      ],
    },
    {
      type: "text",
      x: 0,
      y: releaseY + 10,
      text: t("templateGallery.storyMap.release"),
      fontSize: 16,
    },
  ];
};

export const WORKSHOP_TEMPLATES: readonly WorkshopTemplate[] = [
  {
    id: "retrospective",
    getLabel: () => t("templateGallery.retrospective.label"),
    getDescription: () => t("templateGallery.retrospective.description"),
    getSkeleton: getRetrospectiveSkeleton,
  },
  {
    id: "decisionMatrix",
    getLabel: () => t("templateGallery.decisionMatrix.label"),
    getDescription: () => t("templateGallery.decisionMatrix.description"),
    getSkeleton: getDecisionMatrixSkeleton,
  },
  {
    id: "storyMap",
    getLabel: () => t("templateGallery.storyMap.label"),
    getDescription: () => t("templateGallery.storyMap.description"),
    getSkeleton: getStoryMapSkeleton,
  },
];

/** Builds a fresh set of elements (with fresh ids) for a template. */
export const getWorkshopTemplateElements = (
  template: WorkshopTemplate,
): ExcalidrawElement[] =>
  convertToExcalidrawElements(template.getSkeleton(), {
    regenerateIds: true,
  });

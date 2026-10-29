import React from "react";

import { KEYS, ROUGHNESS, reseed } from "@excalidraw/common";
import { CaptureUpdateAction } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  STYLE_PRESETS,
  applyStylePreset,
  getStylePresetTargets,
} from "../components/StylePresets/stylePresets";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import {
  act,
  fireEvent,
  queryByTestId,
  render,
  unmountComponent,
  waitFor,
} from "./test-utils";

const { h } = window;

const bold = STYLE_PRESETS.find((preset) => preset.id === "bold")!;

const openDialog = async () => {
  act(() => {
    API.setAppState({ openDialog: { name: "stylePresets" } });
  });
  await waitFor(() =>
    expect(document.querySelector(".StylePresetsDialog")).not.toBeNull(),
  );
};

const getDialog = () =>
  document.querySelector(".StylePresetsDialog") as HTMLElement;

const getApplyButton = () =>
  queryByTestId(getDialog(), "style-presets-apply") as HTMLButtonElement;

const pickPreset = (id: string) =>
  fireEvent.click(queryByTestId(getDialog(), `style-preset-${id}`)!);

const getById = (id: string) => h.elements.find((el) => el.id === id)!;

const createBoundScene = () => {
  const [box, label] = API.createTextContainer({
    label: { text: "keep me" },
  });
  const ellipse = API.createElement({ type: "ellipse", x: 300, y: 0 });
  const arrow = API.createElement({
    type: "arrow",
    x: 100,
    y: 50,
    width: 200,
    height: 0,
    startBinding: {
      elementId: box.id,
      fixedPoint: [1, 0.5],
      mode: "orbit",
    },
    endBinding: {
      elementId: ellipse.id,
      fixedPoint: [0, 0.5],
      mode: "orbit",
    },
  } as any);
  h.app.scene.mutateElement(box, {
    boundElements: [...box.boundElements!, { type: "arrow", id: arrow.id }],
  });
  h.app.scene.mutateElement(ellipse, {
    boundElements: [{ type: "arrow", id: arrow.id }],
  });
  const image = API.createElement({ type: "image", x: 600, y: 0 });
  return { box, label, ellipse, arrow, image };
};

describe("style presets", () => {
  it("offers a small set of distinct presets", () => {
    expect(STYLE_PRESETS.length).toBeGreaterThanOrEqual(3);
    expect(STYLE_PRESETS.length).toBeLessThanOrEqual(6);
    const ids = STYLE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("targets only rectangles, diamonds and ellipses", () => {
    const elements = (
      [
        "rectangle",
        "diamond",
        "ellipse",
        "text",
        "arrow",
        "line",
        "freedraw",
        "image",
        "frame",
      ] as const
    ).map((type) => API.createElement({ type }));
    expect(getStylePresetTargets(elements).map((el) => el.type)).toEqual([
      "rectangle",
      "diamond",
      "ellipse",
    ]);
  });

  it("changes only style properties and leaves other elements untouched", () => {
    const rect = API.createElement({
      type: "rectangle",
      x: 10,
      y: 20,
      groupIds: ["g1"],
    });
    const text = API.createElement({ type: "text", text: "hi" });
    const [styledRect, sameText] = applyStylePreset(
      [rect, text],
      new Set([rect.id, text.id]),
      bold,
    );

    expect(sameText).toBe(text);
    expect(styledRect).toEqual({
      ...rect,
      strokeColor: bold.style.strokeColor,
      backgroundColor: bold.style.backgroundColor,
      fillStyle: bold.style.fillStyle,
      strokeWidth: bold.style.strokeWidth,
      strokeStyle: bold.style.strokeStyle,
      roughness: bold.style.roughness,
      opacity: bold.style.opacity,
      roundness: expect.any(Object),
      version: rect.version + 1,
      versionNonce: expect.any(Number),
      updated: expect.any(Number),
    });
  });

  it("sets or clears corner rounding per preset", () => {
    const rect = API.createElement({ type: "rectangle", roundness: null });
    const sketch = STYLE_PRESETS.find((preset) => preset.id === "sketch")!;
    const [rounded] = applyStylePreset([rect], new Set([rect.id]), bold);
    expect(rounded.roundness).not.toBeNull();
    const [sharp] = applyStylePreset([rounded], new Set([rect.id]), sketch);
    expect(sharp.roundness).toBeNull();
    expect(sharp.roughness).toBe(ROUGHNESS.cartoonist);
  });
});

describe("<StylePresetsDialog/>", () => {
  beforeEach(async () => {
    unmountComponent();
    reseed(7);
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("shows the button only when a compatible shape is selected", async () => {
    const { box, arrow, image } = createBoundScene();
    API.setElements([box, arrow, image]);

    API.setSelectedElements([arrow]);
    await waitFor(() =>
      expect(queryByTestId(document.body, "style-presets-button")).toBeNull(),
    );

    API.setSelectedElements([image, box]);
    await waitFor(() =>
      expect(
        queryByTestId(document.body, "style-presets-button"),
      ).not.toBeNull(),
    );
    fireEvent.click(queryByTestId(document.body, "style-presets-button")!);
    expect(h.state.openDialog).toEqual({ name: "stylePresets" });
  });

  it("previews, then applies to compatible shapes only, keeping content, bindings and selection", async () => {
    const { box, label, ellipse, arrow, image } = createBoundScene();
    API.setElements([box, label, ellipse, arrow, image]);
    API.setSelectedElements([box, ellipse, arrow, image]);
    const selectionBefore = h.state.selectedElementIds;
    const before = new Map(h.elements.map((el) => [el.id, el]));

    await openDialog();
    expect(
      queryByTestId(getDialog(), "style-presets-status")!.textContent,
    ).toContain("2");

    const options = getDialog().querySelectorAll('[role="radio"]');
    expect(options.length).toBe(STYLE_PRESETS.length);
    options.forEach((option) =>
      expect(option.textContent!.trim().length).toBeGreaterThan(0),
    );
    expect(
      getDialog()
        .querySelector('[role="radiogroup"]')!
        .getAttribute("aria-label"),
    ).toBeTruthy();

    pickPreset("bold");
    expect(
      queryByTestId(getDialog(), "style-preset-bold")!.getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
    await waitFor(() =>
      expect(
        queryByTestId(getDialog(), "style-presets-preview")!.querySelector(
          "svg",
        ),
      ).not.toBeNull(),
    );
    // previewing does not touch the scene
    expect(getById(box.id)).toBe(before.get(box.id));

    fireEvent.click(getApplyButton());
    expect(getDialog()).toBeNull();
    expect(h.state.openDialog).toBeNull();

    for (const id of [box.id, ellipse.id]) {
      const el = getById(id);
      const prev = before.get(id)!;
      expect(el).toEqual(
        expect.objectContaining({
          strokeColor: bold.style.strokeColor,
          backgroundColor: bold.style.backgroundColor,
          strokeWidth: bold.style.strokeWidth,
          x: prev.x,
          y: prev.y,
          width: prev.width,
          height: prev.height,
          boundElements: prev.boundElements,
          groupIds: prev.groupIds,
        }),
      );
    }
    // unsupported types and bound text are left as they were
    expect(getById(arrow.id)).toBe(before.get(arrow.id));
    expect(getById(image.id)).toBe(before.get(image.id));
    expect(getById(label.id)).toBe(before.get(label.id));
    expect(h.state.selectedElementIds).toEqual(selectionBefore);
  });

  it("undoes and redoes the whole change in a single step", async () => {
    const a = API.createElement({ type: "rectangle" });
    const b = API.createElement({ type: "diamond", x: 200 });
    API.updateScene({
      elements: [a, b],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    API.setSelectedElements([a, b]);
    const original = (el: ExcalidrawElement) => ({
      strokeColor: el.strokeColor,
      backgroundColor: el.backgroundColor,
      strokeWidth: el.strokeWidth,
    });
    const undoStackSize = API.getUndoStack().length;

    await openDialog();
    pickPreset("bold");
    fireEvent.click(getApplyButton());
    expect(API.getUndoStack().length).toBe(undoStackSize + 1);
    expect(getById(a.id).strokeWidth).toBe(bold.style.strokeWidth);
    expect(getById(b.id).strokeWidth).toBe(bold.style.strokeWidth);

    Keyboard.undo();
    expect(original(getById(a.id))).toEqual(original(a));
    expect(original(getById(b.id))).toEqual(original(b));

    Keyboard.redo();
    expect(getById(a.id).backgroundColor).toBe(bold.style.backgroundColor);
    expect(getById(b.id).backgroundColor).toBe(bold.style.backgroundColor);
  });

  it("cancels with the button or Escape without changing the scene", async () => {
    const rect = API.createElement({ type: "rectangle" });
    API.setElements([rect]);
    API.setSelectedElements([rect]);
    const undoStackSize = API.getUndoStack().length;

    await openDialog();
    pickPreset("highlight");
    fireEvent.click(queryByTestId(getDialog(), "style-presets-cancel")!);
    expect(getDialog()).toBeNull();
    expect(document.activeElement).toBe(
      document.querySelector(".excalidraw-container"),
    );

    await openDialog();
    pickPreset("muted");
    fireEvent.keyDown(getDialog(), { key: KEYS.ESCAPE });
    expect(getDialog()).toBeNull();

    expect(getById(rect.id)).toBe(rect);
    expect(API.getUndoStack().length).toBe(undoStackSize);
  });

  it("disables apply and explains why when nothing compatible is selected", async () => {
    const arrow = API.createElement({ type: "arrow" });
    API.setElements([arrow]);
    API.setSelectedElements([arrow]);

    await openDialog();
    expect(getApplyButton().disabled).toBe(true);
    expect(
      queryByTestId(getDialog(), "style-presets-status")!.textContent,
    ).toMatch(/rectangle, diamond or ellipse/);
    fireEvent.click(getApplyButton());
    expect(getById(arrow.id)).toBe(arrow);
  });
});

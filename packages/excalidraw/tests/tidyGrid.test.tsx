import React from "react";

import { KEYS, reseed } from "@excalidraw/common";
import { CaptureUpdateAction } from "@excalidraw/element";

import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
} from "@excalidraw/element/types";

import {
  applyTidyLayout,
  getTidyTranslations,
  getTidyUnits,
  hasTidyTargets,
} from "../components/TidyGrid/tidyGrid";
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

import type { TidyUnit } from "../components/TidyGrid/tidyGrid";

const { h } = window;

const noGroups = { selectedGroupIds: {}, editingGroupId: null } as any;

const openDialog = async () => {
  act(() => {
    API.setAppState({ openDialog: { name: "tidyGrid" } });
  });
  await waitFor(() =>
    expect(document.querySelector(".TidyGridDialog")).not.toBeNull(),
  );
};

const getDialog = () =>
  document.querySelector(".TidyGridDialog") as HTMLElement;

const getApplyButton = () =>
  queryByTestId(getDialog(), "tidy-grid-apply") as HTMLButtonElement;

const setInput = (testId: string, value: string) =>
  fireEvent.change(queryByTestId(getDialog(), testId)!, {
    target: { value },
  });

const getById = (id: string) => h.elements.find((el) => el.id === id)!;

const box = (x: number, y: number, width: number, height: number) =>
  ({
    elements: [],
    box: {
      minX: x,
      minY: y,
      maxX: x + width,
      maxY: y + height,
      width,
      height,
      midX: x + width / 2,
      midY: y + height / 2,
    },
  } as TidyUnit);

const distanceToBox = ([x, y]: number[], el: ExcalidrawElement) =>
  Math.hypot(
    Math.max(el.x - x, 0, x - (el.x + el.width)),
    Math.max(el.y - y, 0, y - (el.y + el.height)),
  );

/** A labelled box and a box joined by an arrow, and a loose ellipse. */
const createBoundScene = () => {
  const [a, label] = API.createTextContainer({
    label: { text: "keep me" },
  });
  const b = API.createElement({
    type: "rectangle",
    x: 400,
    y: 300,
    width: 100,
    height: 100,
  });
  const arrow = API.createElement({
    type: "arrow",
    x: 100,
    y: 50,
    width: 300,
    height: 300,
    startBinding: { elementId: a.id, fixedPoint: [1, 0.5], mode: "orbit" },
    endBinding: { elementId: b.id, fixedPoint: [0, 0.5], mode: "orbit" },
  } as any) as unknown as ExcalidrawArrowElement;
  h.app.scene.mutateElement(a, {
    boundElements: [...a.boundElements!, { type: "arrow", id: arrow.id }],
  });
  h.app.scene.mutateElement(b, {
    boundElements: [{ type: "arrow", id: arrow.id }],
  });
  const ellipse = API.createElement({
    type: "ellipse",
    x: 900,
    y: 700,
    width: 50,
    height: 50,
  });
  return { a, label, b, arrow, ellipse };
};

describe("tidy grid layout", () => {
  it("fills rows left to right, with columns as wide as their widest item", () => {
    const units = [
      box(0, 0, 100, 50),
      box(500, 10, 40, 80),
      box(300, 200, 60, 30),
      box(50, 400, 10, 10),
    ];
    const translations = getTidyTranslations(units, {
      direction: "rows",
      perLine: 2,
      gap: 10,
    });
    const placed = units.map((unit, i) => [
      unit.box.minX + translations[i].x,
      unit.box.minY + translations[i].y,
    ]);
    expect(placed).toEqual([
      [0, 0],
      [110, 0],
      [0, 90],
      [110, 90],
    ]);
  });

  it("fills columns top to bottom", () => {
    const units = [
      box(0, 0, 100, 50),
      box(0, 100, 40, 80),
      box(0, 300, 60, 30),
    ];
    const translations = getTidyTranslations(units, {
      direction: "columns",
      perLine: 2,
      gap: 0,
    });
    const placed = units.map((unit, i) => [
      unit.box.minX + translations[i].x,
      unit.box.minY + translations[i].y,
    ]);
    expect(placed).toEqual([
      [0, 0],
      [0, 50],
      [100, 0],
    ]);
  });

  it("clamps items per line and gap to sane values", () => {
    const units = [box(0, 0, 10, 10), box(100, 100, 10, 10)];
    const [, second] = getTidyTranslations(units, {
      direction: "rows",
      perLine: 99,
      gap: -5,
    });
    // both in one row, no negative gap
    expect([100 + second.x, 100 + second.y]).toEqual([10, 0]);
  });

  it("orders items by position, then id, so the same selection gives the same layout", () => {
    const first = API.createElement({ type: "rectangle", id: "b", x: 0 });
    const second = API.createElement({ type: "rectangle", id: "a", x: 0 });
    const third = API.createElement({ type: "rectangle", id: "c", x: -50 });
    const order = (elements: ExcalidrawElement[]) =>
      getTidyUnits(elements as any, new Map() as any, noGroups).units.map(
        (unit) => unit.elements[0].id,
      );
    expect(order([first, second, third])).toEqual(["c", "a", "b"]);
    expect(order([third, second, first])).toEqual(["c", "a", "b"]);
  });

  it("skips frames, deleted elements and arrows bound to items outside them", () => {
    const a = API.createElement({ type: "rectangle" });
    const b = API.createElement({ type: "rectangle", x: 400 });
    const arrow = API.createElement({
      type: "arrow",
      startBinding: { elementId: a.id, fixedPoint: [1, 0.5], mode: "orbit" },
      endBinding: { elementId: b.id, fixedPoint: [0, 0.5], mode: "orbit" },
    } as any);
    const frame = API.createElement({ type: "frame", x: 2000 });
    const deleted = API.createElement({ type: "diamond", isDeleted: true });
    const locked = API.createElement({ type: "ellipse", locked: true });
    const loose = API.createElement({ type: "arrow", x: 1500 });
    const elementsMap = new Map(
      [a, b, arrow, frame, deleted, locked, loose].map((el) => [el.id, el]),
    );
    const { units, skippedCount } = getTidyUnits(
      [arrow, frame, deleted, locked, loose] as any,
      elementsMap as any,
      noGroups,
    );
    expect(units.map((unit) => unit.elements[0].id)).toEqual([loose.id]);
    expect(skippedCount).toBe(3);
    expect(hasTidyTargets([frame, loose])).toBe(false);
    expect(hasTidyTargets([a, loose])).toBe(true);
  });
});

describe("<TidyGridDialog/>", () => {
  beforeEach(async () => {
    unmountComponent();
    reseed(7);
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("shows the button only when two or more items are selected", async () => {
    const { a, label, b, arrow } = createBoundScene();
    API.setElements([a, label, b, arrow]);

    API.setSelectedElements([a]);
    await waitFor(() =>
      expect(queryByTestId(document.body, "tidy-grid-button")).toBeNull(),
    );

    API.setSelectedElements([a, b]);
    await waitFor(() =>
      expect(queryByTestId(document.body, "tidy-grid-button")).not.toBeNull(),
    );
    fireEvent.click(queryByTestId(document.body, "tidy-grid-button")!);
    expect(h.state.openDialog).toEqual({ name: "tidyGrid" });
  });

  it("previews without changing the scene, then arranges with labels and arrows following", async () => {
    const { a, label, b, arrow, ellipse } = createBoundScene();
    API.updateScene({
      elements: [a, label, b, arrow, ellipse],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    API.setSelectedElements([a, b, ellipse]);
    const selectionBefore = h.state.selectedElementIds;
    const before = new Map(h.elements.map((el) => [el.id, el]));

    await openDialog();
    expect(
      queryByTestId(getDialog(), "tidy-grid-status")!.textContent,
    ).toContain("3");

    fireEvent.click(queryByTestId(getDialog(), "tidy-grid-direction-rows")!);
    setInput("tidy-grid-per-line", "3");
    setInput("tidy-grid-gap", "10");
    await waitFor(() =>
      expect(
        queryByTestId(getDialog(), "tidy-grid-preview")!.querySelector("svg"),
      ).not.toBeNull(),
    );
    // previewing does not touch the scene
    for (const el of h.elements) {
      expect(el).toBe(before.get(el.id));
    }

    fireEvent.click(getApplyButton());
    expect(getDialog()).toBeNull();
    expect(h.state.openDialog).toBeNull();

    // one row, in reading order, 10px apart, top-aligned to the selection
    expect([getById(a.id).x, getById(a.id).y]).toEqual([a.x, a.y]);
    expect([getById(b.id).x, getById(b.id).y]).toEqual([
      a.x + a.width + 10,
      a.y,
    ]);
    expect([getById(ellipse.id).x, getById(ellipse.id).y]).toEqual([
      a.x + a.width + 10 + b.width + 10,
      a.y,
    ]);

    // the label stays inside its container
    const movedLabel = getById(label.id);
    expect(movedLabel.x - getById(a.id).x).toBeCloseTo(label.x - a.x);
    expect(movedLabel.y - getById(a.id).y).toBeCloseTo(label.y - a.y);

    // the arrow keeps its bindings and its end follows the moved box
    const movedArrow = getById(arrow.id) as typeof arrow;
    expect(movedArrow.startBinding?.elementId).toBe(a.id);
    expect(movedArrow.endBinding?.elementId).toBe(b.id);
    expect(movedArrow).not.toBe(before.get(arrow.id));
    const end = movedArrow.points[movedArrow.points.length - 1];
    expect(
      distanceToBox(
        [movedArrow.x + end[0], movedArrow.y + end[1]],
        getById(b.id),
      ),
    ).toBeLessThan(20);

    expect(getById(a.id).boundElements).toEqual(a.boundElements);
    expect(h.state.selectedElementIds).toEqual(selectionBefore);
  });

  it("undoes and redoes the whole arrangement in a single step", async () => {
    const { a, label, b, arrow, ellipse } = createBoundScene();
    API.updateScene({
      elements: [a, label, b, arrow, ellipse],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    API.setSelectedElements([a, b, ellipse]);
    const position = (id: string) => [getById(id).x, getById(id).y];
    // the label is placed by its container, so it is checked against it
    const labelInside = () => {
      const container = getById(a.id);
      const text = getById(label.id);
      expect(text.x).toBeGreaterThanOrEqual(container.x);
      expect(text.y).toBeGreaterThanOrEqual(container.y);
      expect(text.x + text.width).toBeLessThanOrEqual(
        container.x + container.width,
      );
      expect(text.y + text.height).toBeLessThanOrEqual(
        container.y + container.height,
      );
    };
    // the arrow is routed by its bindings, so it is checked against them
    const arrowFollows = () => {
      const current = getById(arrow.id) as typeof arrow;
      const [startPoint, endPoint] = [
        current.points[0],
        current.points[current.points.length - 1],
      ].map(([x, y]) => [current.x + x, current.y + y]);
      expect(distanceToBox(startPoint, getById(a.id))).toBeLessThan(20);
      expect(distanceToBox(endPoint, getById(b.id))).toBeLessThan(20);
      expect(current.startBinding?.elementId).toBe(a.id);
      expect(current.endBinding?.elementId).toBe(b.id);
    };
    const ids = [a.id, b.id, ellipse.id];
    const original = ids.map(position);
    const undoStackSize = API.getUndoStack().length;

    await openDialog();
    setInput("tidy-grid-per-line", "1");
    fireEvent.click(getApplyButton());
    expect(API.getUndoStack().length).toBe(undoStackSize + 1);
    const arranged = ids.map(position);
    labelInside();
    expect(arranged).not.toEqual(original);

    Keyboard.undo();
    expect(ids.map(position)).toEqual(original);
    labelInside();
    arrowFollows();

    Keyboard.redo();
    expect(ids.map(position)).toEqual(arranged);
    labelInside();
    arrowFollows();
  });

  it("cancels with the button or Escape without changing the scene", async () => {
    const { a, label, b, arrow } = createBoundScene();
    API.setElements([a, label, b, arrow]);
    API.setSelectedElements([a, b]);
    const before = h.elements;
    const undoStackSize = API.getUndoStack().length;

    await openDialog();
    fireEvent.click(queryByTestId(getDialog(), "tidy-grid-direction-columns")!);
    setInput("tidy-grid-gap", "100");
    fireEvent.click(queryByTestId(getDialog(), "tidy-grid-cancel")!);
    expect(getDialog()).toBeNull();
    expect(document.activeElement).toBe(
      document.querySelector(".excalidraw-container"),
    );

    await openDialog();
    setInput("tidy-grid-per-line", "1");
    fireEvent.keyDown(getDialog(), { key: KEYS.ESCAPE });
    expect(getDialog()).toBeNull();

    expect(h.elements).toEqual(before);
    h.elements.forEach((el, i) => expect(el).toBe(before[i]));
    expect(API.getUndoStack().length).toBe(undoStackSize);
  });

  it("keeps typed keys away from the editor", async () => {
    const a = API.createElement({ type: "rectangle" });
    const b = API.createElement({ type: "rectangle", x: 200 });
    API.setElements([a, b]);
    API.setSelectedElements([a, b]);

    await openDialog();
    const input = queryByTestId(getDialog(), "tidy-grid-per-line")!;
    input.focus();
    // "2" would otherwise pick the rectangle tool, Delete would delete
    fireEvent.keyDown(input, { key: "2" });
    fireEvent.keyDown(input, { key: KEYS.DELETE });
    expect(h.state.activeTool.type).toBe("selection");
    expect(getById(a.id).isDeleted).toBe(false);
    expect(getDialog()).not.toBeNull();
  });

  it("arranges the scene as it is when Apply is pressed", async () => {
    const a = API.createElement({ type: "rectangle", width: 100 });
    const b = API.createElement({ type: "rectangle", x: 300, width: 100 });
    API.setElements([a, b]);
    API.setSelectedElements([a, b]);

    await openDialog();
    setInput("tidy-grid-per-line", "2");
    setInput("tidy-grid-gap", "0");
    // the scene is updated while the dialog is open
    act(() => {
      API.updateScene({
        elements: h.elements.map((el) =>
          el.id === b.id ? { ...el, y: 500, width: 50 } : el,
        ),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    });
    fireEvent.click(getApplyButton());

    // b sits right of a, laid out from its new position and size
    expect([getById(a.id).x, getById(a.id).y]).toEqual([a.x, a.y]);
    expect([getById(b.id).x, getById(b.id).y]).toEqual([a.x + 100, a.y]);
    expect(getById(b.id).width).toBe(50);
  });

  it.each([
    ["locked", { locked: true }],
    ["deleted", { isDeleted: true }],
  ])(
    "leaves an item %s while the dialog is open where it is",
    async (_, update) => {
      const a = API.createElement({ type: "rectangle" });
      const b = API.createElement({ type: "rectangle", x: 300 });
      const c = API.createElement({ type: "rectangle", x: 600, y: 300 });
      API.setElements([a, b, c]);
      API.setSelectedElements([a, b, c]);
      const undoStackSize = API.getUndoStack().length;

      await openDialog();
      setInput("tidy-grid-per-line", "1");
      act(() => {
        API.updateScene({
          elements: h.elements.map((el) =>
            el.id === b.id ? { ...el, ...update } : el,
          ),
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      });
      const changed = getById(b.id);
      fireEvent.click(getApplyButton());

      expect(getById(b.id)).toBe(changed);
      expect([getById(a.id).x, getById(a.id).y]).toEqual([a.x, a.y]);
      expect([getById(c.id).x, getById(c.id).y]).toEqual([
        a.x,
        a.y + a.height + 20,
      ]);
      expect(API.getUndoStack().length).toBe(undoStackSize + 1);
    },
  );

  it("applies nothing when fewer than two items are left by Apply", async () => {
    const a = API.createElement({ type: "rectangle" });
    const b = API.createElement({ type: "rectangle", x: 300, y: 300 });
    API.setElements([a, b]);
    API.setSelectedElements([a, b]);
    const undoStackSize = API.getUndoStack().length;

    await openDialog();
    act(() => {
      API.updateScene({
        elements: h.elements.map((el) =>
          el.id === b.id ? { ...el, locked: true } : el,
        ),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    });
    const before = h.elements;
    fireEvent.click(getApplyButton());

    h.elements.forEach((el, i) => expect(el).toBe(before[i]));
    expect(API.getUndoStack().length).toBe(undoStackSize);
  });

  it("never moves a deleted element passed in a unit", () => {
    const a = API.createElement({ type: "rectangle", x: 0 });
    const b = API.createElement({ type: "rectangle", x: 500, y: 500 });
    const { units } = getTidyUnits([a, b], new Map() as any, noGroups);
    const deletedB = { ...b, isDeleted: true };
    const { elements, changedIds } = applyTidyLayout([a, deletedB], units, {
      direction: "rows",
      perLine: 2,
      gap: 0,
    });
    expect(elements[1]).toBe(deletedB);
    expect(changedIds.has(b.id)).toBe(false);
  });

  it("keeps Shift+Tab inside the dialog from the checked radio", async () => {
    const a = API.createElement({ type: "rectangle" });
    const b = API.createElement({ type: "rectangle", x: 200 });
    API.setElements([a, b]);
    API.setSelectedElements([a, b]);

    await openDialog();
    const columns = queryByTestId(getDialog(), "tidy-grid-direction-columns")!;
    fireEvent.click(columns);
    columns.focus();
    fireEvent.keyDown(columns, { key: KEYS.TAB, shiftKey: true });
    expect(document.activeElement).toBe(getApplyButton());
  });

  it("leaves skipped items in place and disables apply when fewer than two remain", async () => {
    const rect = API.createElement({ type: "rectangle" });
    const frame = API.createElement({ type: "frame", x: 500 });
    API.setElements([rect, frame]);
    API.setSelectedElements([rect, frame]);

    await openDialog();
    expect(getApplyButton().disabled).toBe(true);
    const status = queryByTestId(getDialog(), "tidy-grid-status")!.textContent;
    expect(status).toMatch(/two or more/);
    expect(status).toMatch(/frames/);
    fireEvent.click(getApplyButton());
    expect(getById(rect.id)).toBe(rect);
    expect(getById(frame.id)).toBe(frame);
  });

  it("never mutates the elements it is given", () => {
    const a = API.createElement({ type: "rectangle", x: 0 });
    const b = API.createElement({ type: "rectangle", x: 500, y: 500 });
    const snapshot = JSON.stringify([a, b]);
    const { units } = getTidyUnits([a, b], new Map() as any, noGroups);
    const { elements, changedIds } = applyTidyLayout([a, b], units, {
      direction: "rows",
      perLine: 2,
      gap: 0,
    });
    expect(JSON.stringify([a, b])).toBe(snapshot);
    expect(elements[0]).toBe(a);
    expect(changedIds).toEqual(new Set([b.id]));
    expect([elements[1].x, elements[1].y]).toEqual([a.width, 0]);
  });
});

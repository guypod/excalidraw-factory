import React from "react";

import { KEYS, reseed, viewportCoordsToSceneCoords } from "@excalidraw/common";
import {
  CaptureUpdateAction,
  getCommonBounds,
  getContainerElement,
  isBoundToContainer,
  isTextElement,
} from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  WORKSHOP_TEMPLATES,
  getWorkshopTemplateElements,
} from "../components/TemplateGallery/templates";
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

const openGallery = async () => {
  act(() => {
    API.setAppState({ openDialog: { name: "templateGallery" } });
  });
  await waitFor(() =>
    expect(document.querySelector(".TemplateGalleryDialog")).not.toBeNull(),
  );
};

const getDialog = () =>
  document.querySelector(".TemplateGalleryDialog") as HTMLElement;

const expectBoundTextIsConsistent = (
  elements: readonly ExcalidrawElement[],
) => {
  const elementsMap = new Map(elements.map((el) => [el.id, el]));
  const boundTexts = elements.filter(
    (el) => isTextElement(el) && isBoundToContainer(el),
  );
  expect(boundTexts.length).toBeGreaterThan(0);
  for (const text of boundTexts) {
    const container = getContainerElement(text as any, elementsMap);
    expect(container).not.toBeNull();
    expect(container!.boundElements).toEqual(
      expect.arrayContaining([{ type: "text", id: text.id }]),
    );
  }
};

describe("workshop templates", () => {
  it.each(WORKSHOP_TEMPLATES.map((template) => [template.id, template]))(
    "%s: builds elements with unique ids and bound labels",
    (_id, template) => {
      const first = getWorkshopTemplateElements(template);
      const second = getWorkshopTemplateElements(template);

      const ids = first.map((el) => el.id);
      expect(new Set(ids).size).toBe(ids.length);
      // building twice must not reuse ids, so repeated inserts never collide
      expect(second.some((el) => ids.includes(el.id))).toBe(false);

      expectBoundTextIsConsistent(first);
    },
  );
});

describe("<TemplateGalleryDialog/>", () => {
  beforeEach(async () => {
    unmountComponent();
    reseed(7);
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("inserts a template near the viewport center without replacing the scene", async () => {
    const existing = API.createElement({
      type: "rectangle",
      x: -500,
      y: -500,
      width: 100,
      height: 100,
    });
    API.setElements([existing]);
    API.setAppState({ scrollX: 300, scrollY: -200 });

    await openGallery();
    fireEvent.click(queryByTestId(getDialog(), "template-gallery-insert")!);

    expect(getDialog()).toBeNull();
    expect(h.state.openDialog).toBeNull();

    const inserted = h.elements.filter((el) => el.id !== existing.id);
    expect(h.elements.find((el) => el.id === existing.id)).toEqual(
      expect.objectContaining({ isDeleted: false, x: -500, y: -500 }),
    );
    expect(inserted.length).toBe(
      getWorkshopTemplateElements(WORKSHOP_TEMPLATES[0]).length,
    );

    const ids = h.elements.map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    expectBoundTextIsConsistent(h.elements);

    // inserted elements are selected and centered in the viewport
    expect(
      inserted.every(
        (el) =>
          h.state.selectedElementIds[el.id] ||
          (isTextElement(el) && el.containerId),
      ),
    ).toBe(true);
    const [minX, minY, maxX, maxY] = getCommonBounds(inserted);
    const center = viewportCoordsToSceneCoords(
      {
        clientX: h.state.width / 2 + h.state.offsetLeft,
        clientY: h.state.height / 2 + h.state.offsetTop,
      },
      h.state,
    );
    expect(Math.abs((minX + maxX) / 2 - center.x)).toBeLessThan(50);
    expect(Math.abs((minY + maxY) / 2 - center.y)).toBeLessThan(50);
  });

  it("undoes and redoes an insert in a single step", async () => {
    const existing = API.createElement({ type: "rectangle" });
    API.updateScene({
      elements: [existing],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    const undoStackSize = API.getUndoStack().length;

    await openGallery();
    fireEvent.click(queryByTestId(getDialog(), "template-gallery-insert")!);

    const insertedIds = h.elements
      .filter((el) => el.id !== existing.id)
      .map((el) => el.id);
    expect(insertedIds.length).toBeGreaterThan(0);
    expect(API.getUndoStack().length).toBe(undoStackSize + 1);

    Keyboard.undo();
    expect(h.elements.filter((el) => !el.isDeleted).map((el) => el.id)).toEqual(
      [existing.id],
    );

    Keyboard.redo();
    expect(h.elements.filter((el) => !el.isDeleted).map((el) => el.id)).toEqual(
      [existing.id, ...insertedIds],
    );
  });

  it("lets the keyboard choose a template and preview it", async () => {
    await openGallery();
    const dialog = getDialog();
    const retro = queryByTestId(
      dialog,
      "template-gallery-option-retrospective",
    )!;
    const matrix = queryByTestId(
      dialog,
      "template-gallery-option-decisionMatrix",
    )!;

    await waitFor(() => expect(document.activeElement).toBe(retro));
    expect(retro.getAttribute("aria-checked")).toBe("true");
    await waitFor(() =>
      expect(
        queryByTestId(dialog, "template-gallery-preview")!.querySelector("svg"),
      ).not.toBeNull(),
    );

    fireEvent.keyDown(retro, { key: KEYS.ARROW_DOWN });
    expect(document.activeElement).toBe(matrix);
    expect(matrix.getAttribute("aria-checked")).toBe("true");
    expect(retro.getAttribute("aria-checked")).toBe("false");

    fireEvent.keyDown(matrix, { key: KEYS.ENTER });
    expect(getDialog()).toBeNull();
    const texts = h.elements.filter(isTextElement).map((el) => el.originalText);
    expect(texts).toContain(WORKSHOP_TEMPLATES[1].getLabel());
  });

  it("keeps gallery arrow keys from moving selected scene elements", async () => {
    const existing = API.createElement({ type: "rectangle", x: 10, y: 20 });
    API.setElements([existing]);
    API.setSelectedElements([existing]);

    await openGallery();
    const retro = queryByTestId(
      getDialog(),
      "template-gallery-option-retrospective",
    )!;
    fireEvent.keyDown(retro, { key: KEYS.ARROW_DOWN });
    fireEvent.keyDown(document.activeElement!, { key: KEYS.ARROW_RIGHT });

    expect(h.elements).toEqual([
      expect.objectContaining({ id: existing.id, x: 10, y: 20 }),
    ]);
  });

  it("returns focus to the editor on cancel", async () => {
    await openGallery();
    fireEvent.click(queryByTestId(getDialog(), "template-gallery-cancel")!);
    expect(getDialog()).toBeNull();
    expect(document.activeElement).toBe(
      document.querySelector(".excalidraw-container"),
    );
  });

  it("cancels without changing the scene", async () => {
    const existing = API.createElement({ type: "rectangle" });
    API.setElements([existing]);
    const undoStackSize = API.getUndoStack().length;

    await openGallery();
    fireEvent.click(queryByTestId(getDialog(), "template-gallery-cancel")!);
    expect(getDialog()).toBeNull();

    await openGallery();
    fireEvent.keyDown(getDialog(), { key: KEYS.ESCAPE });
    expect(getDialog()).toBeNull();

    expect(h.elements.map((el) => el.id)).toEqual([existing.id]);
    expect(API.getUndoStack().length).toBe(undoStackSize);
  });
});

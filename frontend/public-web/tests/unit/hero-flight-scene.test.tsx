import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { HeroFlightScene } from "@/components/three/HeroFlightScene";

// N20: the landing hero no longer shows the technical «MOTOR 3D · LITE» pill. The scene still
// exposes the engine tier and its render state as data-* attributes.
const engine = vi.hoisted(() => ({ fails: false }));

vi.mock("@/components/three/heroFlightEngine", () => ({
  HeroFlightEngine: class {
    readonly canvas = document.createElement("canvas");

    constructor() {
      if (engine.fails) throw new Error("WebGL is not available");
    }

    resize() {}
    setProgress() {}
    setActive() {}
    renderOnce() {}
    dispose() {}
  },
}));

class InertObserver {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  engine.fails = false;
  vi.stubGlobal("ResizeObserver", InertObserver);
  vi.stubGlobal("IntersectionObserver", InertObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderScene() {
  const { container } = render(<HeroFlightScene />);
  const scene = container.querySelector<HTMLElement>("[data-render-state]");
  if (!scene) throw new Error("The hero scene was not rendered");
  return { container, scene };
}

it("renders the 3D engine without the «MOTOR 3D» pill and keeps the tier and render state", async () => {
  // A phone-width window gets the LITE engine, as on the VPS run.
  vi.stubGlobal("innerWidth", 390);
  const { container, scene } = renderScene();

  await waitFor(() => expect(scene).toHaveAttribute("data-render-state", "ready"));
  expect(scene).toHaveAttribute("data-graphics-tier", "LITE");
  expect(container.querySelector("canvas")).toHaveAttribute("role", "img");
  expect(container).not.toHaveTextContent(/MOTOR 3D/i);
});

it("falls back to the poster without a «RESPALDO VISUAL» pill", async () => {
  engine.fails = true;
  const { container, scene } = renderScene();

  await waitFor(() => expect(scene).toHaveAttribute("data-render-state", "unavailable"));
  expect(scene).toHaveAttribute("data-graphics-tier", "FULL");
  expect(screen.getByRole("img", { name: /Vuelo de Miami a Punta Cana/ })).toBeInTheDocument();
  expect(container).not.toHaveTextContent(/MOTOR 3D|RESPALDO VISUAL/i);
});

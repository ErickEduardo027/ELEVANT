// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import { installFormValidation } from "../../src/lib/forms/formValidation";

let uninstall: () => void;
beforeEach(() => { uninstall = installFormValidation(document); });
afterEach(() => { uninstall(); document.body.innerHTML = ""; });

it("shows the system's own message instead of the browser bubble", () => {
  document.body.innerHTML = `<form><input id="password" type="password" required minlength="14"></form>`;
  const field = document.getElementById("password") as HTMLInputElement;
  const event = new Event("invalid", { cancelable: true });
  field.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(field.getAttribute("aria-invalid")).toBe("true");
  expect(document.body.textContent).toContain("Complete este campo.");
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import styles from "@/components/portal/AirlinePortalPage.module.css";

/*
 * N18: jsdom applies no CSS module, so a unit test cannot read a computed style. This helper reads the portal
 * stylesheet and tells which of its declarations reach an element rendered in jsdom, through the class names Vitest
 * gives the module. Only top-level rules count (no @media or @container block), and the cascade between rules is
 * not resolved: the computed styles are checked in a browser by tests/e2e/portal.spec.ts.
 */
const SOURCE = resolve(__dirname, "../../../src/components/portal/AirlinePortalPage.module.css");

interface Rule { selector: string; declarations: string[] }

function topLevelRules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  let depth = 0;
  let start = 0;
  let selector = "";
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "{") {
      if (depth === 0) { selector = text.slice(start, index).trim(); start = index + 1; }
      depth += 1;
    } else if (text[index] === "}") {
      depth -= 1;
      if (depth !== 0) continue;
      if (!selector.startsWith("@")) rules.push({ selector, declarations: text.slice(start, index).split(";")
        .map(item => item.trim().replace(/\s+/g, " ")).filter(Boolean) });
      start = index + 1;
    }
  }
  return rules;
}

// The stylesheet's class names become the ones the components render under Vitest.
const rules = topLevelRules(readFileSync(SOURCE, "utf8")).map(rule => ({ ...rule,
  selector: rule.selector.replace(/\.(-?[A-Za-z_][\w-]*)/g, (_, name: string) => `.${styles[name]}`) }));

function selects(element: Element, selector: string) {
  try { return element.matches(selector); } catch { return false; } // A selector jsdom cannot parse selects nothing.
}

/** Every declaration of a portal rule that selects the element, as written in the stylesheet. */
export function portalDeclarations(element: Element): string[] {
  return rules.filter(rule => selects(element, rule.selector)).flatMap(rule => rule.declarations);
}

/** The filled blue of the button that sends a portal form. */
export const PRIMARY_BUTTON = "background: #1757d8";
/** The white, bordered look of a secondary action, such as «Reintentar». */
export const SECONDARY_BUTTON = ["background: #fff", "border: 1px solid #b8c9df", "color: #1155b4"];
/** The field of the flight search, which the portal forms reuse. */
export const FIELD = ["min-height: 2.75rem", "padding: .7rem .85rem", "border: 1px solid #b8c9db",
  "border-radius: .55rem", "background: #fff", "color: #102138"];

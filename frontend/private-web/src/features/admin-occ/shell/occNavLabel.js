/**
 * The name of an OCC module in the active language: `nav.<id>` of occShellMessages, or the module's own `label` when
 * the messages lack that key (the translator then answers with the key itself). The status bar names the current
 * module through it, so it never shows a raw key such as `nav.master-data`; the rail keeps its own copy of the same
 * fallback until it is regrouped.
 */
export function occNavLabel(t, item) {
  const key = `nav.${item.id}`;
  const text = t(key);
  return typeof text === 'string' && text !== key ? text : item.label;
}

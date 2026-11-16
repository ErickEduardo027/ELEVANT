/**
 * The four access levels of a menu option (Ver · Crear · Editar · Completo) over the codes of the server catalog
 * (ADR-0019). Levels are cumulative and only choose codes the catalog already has: the API receives the same
 * `<department>.<module>.<action>` codes as before, and every level includes «Ver», as Normalize implies.
 */

/** Selector order; «none» is «Sin acceso». */
export const LEVELS = ['none', 'read', 'create', 'edit', 'full'];
const RANK = Object.fromEntries(LEVELS.map((level, index) => [level, index]));

const LEGACY_KINDS = { read: 'read', create: 'create', update: 'update', edit: 'update', delete: 'delete', retire: 'delete' };

/** Matrix column of an action; catalogs from older APIs have no `kind`. */
export const actionKind = action => action.kind ?? LEGACY_KINDS[action.action] ?? 'other';

/**
 * Level that grants each workflow verb of DepartmentPermissionCatalog (kind «other»). Reading out (export) is «Ver»;
 * working a record forward is «Editar»; undoing, withdrawing or cutting off what exists is «Completo», with delete.
 */
export const VERB_LEVELS = Object.freeze({
  // Ver: consulting and taking a copy of what one can already see.
  export: 'read',
  // Editar: the day-to-day work of the option; nothing that exists is undone.
  assign: 'edit', attend: 'edit', write: 'edit', validate: 'edit', decide: 'edit', verify: 'edit', approve: 'edit',
  reject: 'edit', sign: 'edit', issue: 'edit', publish: 'edit', pay: 'edit', apply: 'edit', confirm: 'edit',
  activate: 'edit', validity: 'edit', refund: 'edit',
  // Completo: destructive or reversing actions, at the level of «Eliminar».
  delete: 'full', revoke: 'full', reverse: 'full', unbind: 'full', reopen: 'full', retire: 'full', cancel: 'full',
  lifecycle: 'full',
});

const KIND_LEVELS = { read: 'read', create: 'create', update: 'edit', delete: 'full' };

/** Lowest level that grants an action. An unknown workflow verb needs «Completo», never less. */
export function actionLevel(action) {
  const kind = actionKind(action);
  return kind === 'other' ? VERB_LEVELS[action.action] ?? 'full' : KIND_LEVELS[kind];
}

/** Codes of the option a level grants: every action up to that level, always with «Ver». */
export function levelCodes(module, level) {
  if (level === 'none') return [];
  return module.actions.filter(action => actionKind(action) === 'read' || RANK[actionLevel(action)] <= RANK[level])
    .map(action => action.code).sort();
}

/** Levels worth offering: a level that grants nothing more than the one before it is hidden. */
export function moduleLevels(module) {
  const offered = ['none'];
  let previous = 0;
  for (const level of LEVELS.slice(1)) {
    const size = levelCodes(module, level).length;
    if (size > previous) { offered.push(level); previous = size; }
  }
  return offered;
}

/** Level the stored codes of an option match exactly, or «custom» when they match none. */
export function accessLevel(codes, module) {
  const granted = module.actions.filter(action => codes.includes(action.code)).map(action => action.code).sort();
  if (!granted.length) return 'none';
  const match = moduleLevels(module).find(level => {
    const expected = levelCodes(module, level);
    return expected.length === granted.length && expected.every((code, index) => code === granted[index]);
  });
  return match ?? 'custom';
}

const readOf = module => module?.actions.find(item => actionKind(item) === 'read')?.code;

/** Sub-windows of an option, so forbidding a screen also forbids what lives inside it. */
const childrenOf = (catalog, module) => (catalog?.modules ?? []).filter(item => item.parent === module.key);

/** The option that contains a sub-window, when the catalog knows it. */
const parentOf = (catalog, module) => module.parent ? (catalog?.modules ?? []).find(item => item.key === module.parent) : undefined;

/** Grants «Ver» of every screen that contains the option, like Normalize does on the server. */
export function grantParentRead(next, catalog, module) {
  for (let parent = parentOf(catalog, module), seen = 0; parent && seen < 10; parent = parentOf(catalog, parent), seen += 1) {
    const parentRead = readOf(parent);
    if (parentRead) next.add(parentRead);
  }
}

/** Removes the option and every sub-window inside it. */
export function forbid(next, catalog, module) {
  module.actions.forEach(item => next.delete(item.code));
  childrenOf(catalog, module).forEach(child => forbid(next, catalog, child));
}

/**
 * Applies a level to an option: its grants are replaced by the level's set (custom choices included). «Sin acceso»
 * removes the option and its sub-windows; any other level also grants «Ver» of the screen that contains it.
 */
export function setAccessLevel(codes, module, level, catalog) {
  const next = new Set(codes);
  if (level === 'none') {
    forbid(next, catalog, module);
    return [...next].sort();
  }
  module.actions.forEach(action => next.delete(action.code));
  levelCodes(module, level).forEach(code => next.add(code));
  grantParentRead(next, catalog, module);
  return [...next].sort();
}

/**
 * Grants or revokes one action of a menu option. Choosing any action also grants the option's «Ver» and, for a
 * sub-window, «Ver» of the screen that contains it; clearing «Ver» clears the whole option and its sub-windows,
 * matching how the API normalises grants.
 */
export function togglePermission(codes, module, action, checked, catalog) {
  const next = new Set(codes);
  const read = readOf(module);
  if (checked) {
    next.add(action.code);
    if (read) next.add(read);
    grantParentRead(next, catalog, module);
  } else if (action.code === read) {
    forbid(next, catalog, module);
  } else {
    next.delete(action.code);
  }
  return [...next].sort();
}

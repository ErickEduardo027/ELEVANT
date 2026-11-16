/**
 * What a panel says when its read came back with nothing (design F and H.1): one sentence that says what is absent
 * (`title`, «No hay escalas registradas para esta estación y fecha local.»), an optional second line in secondary text
 * (`description`), and at most one action (`action`, a button or a link the caller builds). No illustration and no
 * icon: the sentence is the state. It has no padding of its own: the panel around it places it.
 */
export default function OccEmptyState({ title, description, action, className = '' }) {
  return (
    <div data-occ-empty="" className={className}>
      <p className="text-sm text-occ-text">{title}</p>
      {description ? <p className="mt-1 text-sm text-occ-muted">{description}</p> : null}
      {action ? <div className="mt-3 flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

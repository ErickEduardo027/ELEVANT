import PositionListItem from './PositionListItem';
import EmptyPositionsState from './EmptyPositionsState';

// 42 posiciones no requieren virtualización de lista todavía; si el catálogo crece
// considerablemente, sustituir este map por una ventana virtualizada (ver skill.md).
export default function PositionsSidePanel({ positions, emptyReason, selectedPositionId, onSelectPosition }) {
  return (
    <div
      data-testid="positions-side-panel"
      className="flex h-full flex-col gap-2 overflow-y-auto rounded-2xl border border-black/5 bg-white/70 p-3 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card"
    >
      {emptyReason ? (
        <EmptyPositionsState reason={emptyReason} />
      ) : (
        positions.map(position => (
          <PositionListItem
            key={position.id}
            position={position}
            selected={position.id === selectedPositionId}
            onSelect={onSelectPosition}
          />
        ))
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';

export function useReviewSelection() {
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  function toggle(id) {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll(visibleIds) {
    setSelectedIds(current => {
      const allSelected = visibleIds.length > 0 && visibleIds.every(id => current.has(id));
      if (allSelected) return new Set();
      return new Set(visibleIds);
    });
  }

  function clear() {
    setSelectedIds(new Set());
  }

  const selectedIdList = useMemo(() => [...selectedIds], [selectedIds]);

  return {
    selectedIds,
    selectedIdList,
    selectedCount: selectedIds.size,
    isSelected: id => selectedIds.has(id),
    toggle,
    toggleAll,
    clear,
  };
}

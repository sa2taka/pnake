/**
 * Arrow-key navigation for our tree / listbox views.
 *
 * The listbox container gets `tabIndex={0}` and the returned handler;
 * each row gets a stable DOM `id` matching its entry in the `ids`
 * array. ↑↓ move the selection by one, Home / End jump to ends, and
 * Enter / Space confirm (which is a no-op on top of the click path
 * but keeps the activation key intuitive). After moving, the new row
 * is scrolled into view via document.getElementById.
 *
 * The container should also set `aria-activedescendant` to the
 * currently selected id so screen readers track the visible cursor.
 */

import { useCallback, type KeyboardEventHandler } from "react";

type Options = {
  ids: readonly string[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
};

export function useListboxNav({
  ids,
  selectedId,
  onSelect,
}: Options): KeyboardEventHandler<HTMLElement> {
  return useCallback(
    (event) => {
      if (ids.length === 0) return;
      const currentIndex = selectedId ? ids.indexOf(selectedId) : -1;
      let nextIndex: number;

      switch (event.key) {
        case "ArrowDown":
          nextIndex = currentIndex < 0 ? 0 : Math.min(ids.length - 1, currentIndex + 1);
          break;
        case "ArrowUp":
          nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = ids.length - 1;
          break;
        case "Enter":
        case " ":
          // Re-confirm the current row (rarely useful, but lets keyboard users
          // re-dispatch a selection without leaving the keyboard).
          if (currentIndex >= 0) {
            event.preventDefault();
            const id = ids[currentIndex];
            if (id) onSelect(id);
          }
          return;
        default:
          return;
      }

      event.preventDefault();
      const nextId = ids[nextIndex];
      if (!nextId) return;
      if (nextId !== selectedId) onSelect(nextId);
      // Scroll the newly-focused row into view. The id-based lookup
      // works even when the row was just rendered for the first time
      // because the dispatch has already settled before this scroll.
      requestAnimationFrame(() => {
        document.getElementById(nextId)?.scrollIntoView({ block: "nearest" });
      });
    },
    [ids, selectedId, onSelect],
  );
}

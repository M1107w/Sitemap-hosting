import { useSyncExternalStore } from 'react';

const subs = new Set<() => void>();
window.addEventListener('popstate', () => subs.forEach((f) => f()));

export function navigate(to: string, replace = false) {
  if (to === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', to);
  subs.forEach((f) => f());
}

export function useLocation() {
  const href = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => location.pathname + location.search,
  );
  const url = new URL(href, location.origin);
  return { path: url.pathname, query: url.searchParams };
}

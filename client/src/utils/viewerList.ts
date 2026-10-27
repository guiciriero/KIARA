export interface ViewerItem {
  id: string;
  name: string;
}

export function addViewer(
  viewers: ViewerItem[],
  viewer: { id: string; name?: string },
): ViewerItem[] {
  const name = viewer.name?.trim() || 'Espectador';
  const existingIndex = viewers.findIndex((v) => v.id === viewer.id);
  if (existingIndex >= 0) {
    const next = [...viewers];
    next[existingIndex] = { id: viewer.id, name };
    return next;
  }
  return [...viewers, { id: viewer.id, name }];
}

export function removeViewer(viewers: ViewerItem[], viewerId: string | undefined): ViewerItem[] {
  if (!viewerId) return viewers;
  return viewers.filter((v) => v.id !== viewerId);
}

export function renameViewer(viewers: ViewerItem[], viewerId: string, newName: string): ViewerItem[] {
  const name = newName.trim() || 'Espectador';
  return viewers.map((v) => (v.id === viewerId ? { ...v, name } : v));
}

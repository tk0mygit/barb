// Session-only, bounded LRU. Keep the decoded element so RESULT can attach it
// without changing the src of an element that still contains the previous fish.
export function createFishImageLoader(createImage = () => new Image()) {
  const entries = new Map();
  return species => {
    if (entries.has(species.id)) {
      const entry = entries.get(species.id);
      entries.delete(species.id); entries.set(species.id, entry);
      return entry.pending;
    }
    const image = createImage();
    image.decoding = 'async'; image.fetchPriority = 'high';
    image.src = species.image;
    const pending = image.decode().then(() => image).catch(error => {
      if (entries.get(species.id)?.pending === pending) entries.delete(species.id);
      throw error;
    });
    entries.set(species.id, { image, pending });
    if (entries.size > 2) {
      const oldest = entries.keys().next().value;
      const evicted = entries.get(oldest);
      entries.delete(oldest);
      if (!evicted.image.complete) evicted.image.removeAttribute('src');
    }
    return pending;
  };
}

// Native lazy loading may fetch several screens ahead. Defer src itself until
// the frame intersects this scroll pane. The first visible image gets the
// connection alone; after it settles, at most two visible images load at once.
export function createVisibleFishImages(root) {
  const tasks = [];
  let running = 0, firstStarted = false, firstFinished = false, disposed = false;
  function pump() {
    if (disposed) return;
    for (const task of tasks) {
      if (running >= (firstFinished ? 2 : 1)) break;
      if (task.started || !task.visible) continue;
      task.started = true; running++;
      const first = !firstStarted;
      firstStarted = true;
      task.image.loading = 'eager';
      task.image.fetchPriority = first ? 'high' : 'auto';
      task.image.src = task.src;
      task.image.decode().catch(() => {}).finally(() => {
        running--; if (first) firstFinished = true;
        refresh();
      });
    }
  }
  function refresh() {
    if (disposed) return;
    const bounds = root.getBoundingClientRect();
    for (const task of tasks) {
      const box = task.image.getBoundingClientRect();
      task.visible = box.width > 0 && box.height > 0 && box.bottom > bounds.top
        && box.top < bounds.bottom && box.right > bounds.left && box.left < bounds.right;
    }
    pump();
  }
  const observer = new IntersectionObserver(refresh, { root, rootMargin: '0px' });
  return {
    add(image, src) {
      image.loading = 'lazy'; image.decoding = 'async';
      tasks.push({ image, src, started: false, visible: false });
      observer.observe(image);
    },
    refresh,
    dispose() {
      disposed = true; observer.disconnect();
      for (const { image, started } of tasks) if (started && !image.complete) image.removeAttribute('src');
    },
  };
}

export function scrollFirstMarkIntoContainer(
  container: HTMLElement | null,
  behavior: ScrollBehavior = 'smooth'
): boolean {
  if (!container) return false;
  const target =
    container.querySelector<HTMLElement>('mark[data-search-match="true"]') ??
    container.querySelector<HTMLElement>('mark');
  if (!target) return false;

  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  if (containerRect.height <= 0 || container.clientHeight <= 0) return false;

  const relativeTop = targetRect.top - containerRect.top + container.scrollTop;
  const desiredOffset = Math.max(
    20,
    Math.min(container.clientHeight * 0.32, (container.clientHeight - targetRect.height) / 2)
  );
  const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
  const nextTop = Math.max(0, Math.min(maxScroll, relativeTop - desiredOffset));

  if (typeof container.scrollTo === 'function') {
    container.scrollTo({ top: nextTop, behavior });
  } else {
    container.scrollTop = nextTop;
  }
  return true;
}

export function scrollElementIntoContainer(
  container: HTMLElement | null,
  element: HTMLElement | null,
  behavior: ScrollBehavior = 'smooth'
): boolean {
  if (!container || !element) return false;
  const containerRect = container.getBoundingClientRect();
  const elRect = element.getBoundingClientRect();
  if (containerRect.height <= 0 || container.clientHeight <= 0) return false;

  const padding = 12;
  const isAbove = elRect.top < containerRect.top + padding;
  const isBelow = elRect.bottom > containerRect.bottom - padding;
  if (!isAbove && !isBelow) return true;

  const relativeTop = elRect.top - containerRect.top + container.scrollTop;
  const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
  const nextTop = isAbove
    ? Math.max(0, relativeTop - padding)
    : Math.min(maxScroll, relativeTop - container.clientHeight + elRect.height + padding);

  if (typeof container.scrollTo === 'function') {
    container.scrollTo({ top: nextTop, behavior });
  } else {
    container.scrollTop = nextTop;
  }
  return true;
}

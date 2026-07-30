export function buildEntryUrlWithoutUiParameter(href: string): string | null {
  const url = new URL(href);

  if (!url.searchParams.has("ui")) {
    return null;
  }

  url.searchParams.delete("ui");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function removeLegacyUiParameter(): void {
  if (typeof window === "undefined") {
    return;
  }

  const canonicalUrl = buildEntryUrlWithoutUiParameter(window.location.href);
  if (canonicalUrl === null) {
    return;
  }

  window.history.replaceState(window.history.state, "", canonicalUrl);
}

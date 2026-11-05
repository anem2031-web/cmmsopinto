/** Presentation filtering over records already authorized by the source reader. */
export function matchesReturnSearch(search: string, ...values: unknown[]): boolean {
  const normalize = (value: unknown) => String(value ?? "").normalize("NFKC").toLocaleLowerCase();
  const query = normalize(search).trim();
  return !query || values.some(value => normalize(value).includes(query));
}

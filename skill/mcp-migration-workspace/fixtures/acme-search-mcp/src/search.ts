export interface Hit {
  id: string;
  title: string;
  score: number;
}

/** Stand-in for the real search backend. */
export async function search(
  tenantId: string,
  query: string,
  limit: number,
): Promise<Hit[]> {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  return terms.slice(0, limit).map((term, i) => ({
    id: `${tenantId}-${i}`,
    title: `Document matching "${term}"`,
    score: 1 - i * 0.1,
  }));
}

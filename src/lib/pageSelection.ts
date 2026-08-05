export function splitSelection(
  totalPages: number,
  selected1Based: number[],
): { selected: number[]; rest: number[] } {
  const sel = new Set(
    selected1Based.filter((p) => p >= 1 && p <= totalPages),
  );
  const selected = [...sel].sort((a, b) => a - b);
  const rest: number[] = [];
  for (let p = 1; p <= totalPages; p++) if (!sel.has(p)) rest.push(p);
  return { selected, rest };
}

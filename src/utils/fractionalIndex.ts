export function between(prev: number | undefined, next: number | undefined): number {
  if (prev == null && next == null) return 1;
  if (prev == null) return (next as number) - 1;
  if (next == null) return prev + 1;
  return (prev + next) / 2;
}

export function rebalanceOrders<T extends { order: number }>(items: T[]): T[] {
  return items
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((item, i) => ({ ...item, order: i + 1 }));
}

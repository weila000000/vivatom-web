export function keyedSingleFlight<T>(task: (key: string) => Promise<T>) {
  const active = new Map<string, Promise<T>>()

  return (key: string): Promise<T> => {
    const existing = active.get(key)
    if (existing) return existing

    const current = task(key)
    active.set(key, current)
    void current.then(
      () => { if (active.get(key) === current) active.delete(key) },
      () => { if (active.get(key) === current) active.delete(key) },
    )
    return current
  }
}

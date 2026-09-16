/** Convert application JSON data, including Vue proxies, into detached plain data. */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

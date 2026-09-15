export type HealthState = "checking" | "ready" | "unavailable"

export async function checkServer(signal?: AbortSignal): Promise<HealthState> {
  try {
    const response = await fetch("/api/health/ready", { signal })
    return response.ok ? "ready" : "unavailable"
  } catch {
    return "unavailable"
  }
}

import type { OpencodeClient } from "@opencode-ai/sdk/v2"

export type QuotaGroup = {
  name: string
  display: string
  used: number
  max: number
  remaining: number
  resetTime?: string
}

const CLAUDE_GROUP_NAMES: Record<string, string> = {
  five_hour: "session",
  seven_day: "weekly",
}

export function formatResetTime(resetIso: string | null | undefined): string {
  if (!resetIso) return ""
  const resetDate = new Date(resetIso)
  const diffMs = resetDate.getTime() - Date.now()
  if (diffMs <= 0) return "now"
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 60) return `${diffMins}m`
  const hours = Math.floor(diffMins / 60)
  const mins = diffMins % 60
  if (hours < 24) return `${hours}h ${mins}m`
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return `${days}d ${remainingHours}h`
}

export async function fetchQuota(
  providerID: "antigravity" | "gemini-cli" | "anthropic",
  client: OpencodeClient,
): Promise<QuotaGroup[]> {
  try {
    let result: { data?: { status?: string; groups?: any[]; five_hour?: any; seven_day?: any } }

    if (providerID === "anthropic") {
      result = await client.provider.usage.claude()
    } else if (providerID === "antigravity") {
      result = await client.provider.usage.antigravity()
    } else {
      result = await client.provider.usage.geminiCli()
    }

    const data = result.data
    if (!data || data.status !== "success") return []

    if (providerID === "anthropic") {
      const groups: QuotaGroup[] = []
      if (data.five_hour) {
        const utilization = data.five_hour.utilization ?? 0
        const remaining = Math.round(100 - utilization)
        groups.push({
          name: "five_hour",
          display: CLAUDE_GROUP_NAMES["five_hour"],
          used: Math.round(utilization),
          max: 100,
          remaining,
          resetTime: data.five_hour.resets_at ? formatResetTime(data.five_hour.resets_at) : undefined,
        })
      }

      if (data.seven_day) {
        const utilization = data.seven_day.utilization ?? 0
        const remaining = Math.round(100 - utilization)
        groups.push({
          name: "seven_day",
          display: CLAUDE_GROUP_NAMES["seven_day"],
          used: Math.round(utilization),
          max: 100,
          remaining,
          resetTime: data.seven_day.resets_at ? formatResetTime(data.seven_day.resets_at) : undefined,
        })
      }
      return groups
    } else {
      return (data.groups || []).map((g: any) => ({
        name: g.name,
        display: g.display,
        used: g.used,
        max: g.max,
        remaining: g.remaining,
        resetTime: g.reset_time_iso ? formatResetTime(g.reset_time_iso) : undefined,
      }))
    }
  } catch {
    return []
  }
}

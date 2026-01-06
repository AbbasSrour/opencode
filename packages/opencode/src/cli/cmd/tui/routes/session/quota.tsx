import { createSignal, createMemo, For, Show, onMount, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard } from "@opentui/solid"
import { useKeybind } from "../../context/keybind"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useSDK } from "../../context/sdk"
import { useCommandDialog } from "../../component/dialog-command"
import { SplitBorder } from "../../component/border"
import { fetchQuota, type QuotaGroup } from "../../util/quota"

type ProviderStatus = "loading" | "success" | "error" | "not_configured"
type Tab = "antigravity" | "gemini-cli" | "claude"

function renderProgressBar(percent: number, width: number = 12): string {
  const filled = Math.round((percent / 100) * width)
  const empty = width - filled
  return "▰".repeat(filled) + "▱".repeat(empty)
}

export function QuotaPrompt(props: { onClose: () => void }) {
  const { theme } = useTheme()
  const keybind = useKeybind()
  const sync = useSync()
  const sdk = useSDK()
  const command = useCommandDialog()

  // Suspend global keybinds when quota view is active to prevent Tab from switching agents
  onMount(() => {
    command.keybinds(false)
  })

  onCleanup(() => {
    command.keybinds(true)
  })

  // Tab state
  const [activeTab, setActiveTab] = createSignal<Tab>("antigravity")

  // Antigravity state
  const [antigravityStatus, setAntigravityStatus] = createSignal<ProviderStatus>("loading")
  const [antigravityError, setAntigravityError] = createSignal<string>("")
  const [antigravityQuotas, setAntigravityQuotas] = createSignal<QuotaGroup[]>([])

  // Gemini CLI state
  const [geminiCliStatus, setGeminiCliStatus] = createSignal<ProviderStatus>("loading")
  const [geminiCliError, setGeminiCliError] = createSignal<string>("")
  const [geminiCliQuotas, setGeminiCliQuotas] = createSignal<QuotaGroup[]>([])

  // Claude state
  const [claudeStatus, setClaudeStatus] = createSignal<ProviderStatus>("loading")
  const [claudeError, setClaudeError] = createSignal<string>("")
  const [claudeQuotas, setClaudeQuotas] = createSignal<QuotaGroup[]>([])

  // Button state
  const [store, setStore] = createStore({
    selected: 0 as number,
  })

  // Provider detection
  const antigravityProvider = createMemo(() => {
    return sync.data.provider.find((p) => p.id === "antigravity")
  })

  const geminiCliProvider = createMemo(() => {
    return sync.data.provider.find((p) => p.id === "gemini-cli")
  })

  const hasClaudeAuth = createMemo(() => {
    const methods = sync.data.provider_auth["anthropic"]
    return methods && methods.length > 0
  })

  // Tab ordering: configured providers first
  const tabs = createMemo((): Tab[] => {
    const result: Tab[] = []

    if (antigravityProvider()) result.push("antigravity")
    if (geminiCliProvider()) result.push("gemini-cli")
    if (hasClaudeAuth()) result.push("claude")

    return result.length > 0 ? result : ["antigravity"]
  })

  // Current status based on active tab
  const currentStatus = createMemo(() => {
    return activeTab() === "antigravity"
      ? antigravityStatus()
      : activeTab() === "gemini-cli"
        ? geminiCliStatus()
        : claudeStatus()
  })

  // Button options based on current tab status
  const options = createMemo(() => {
    const status = currentStatus()
    if (status === "error") return { retry: "Retry", close: "Close" }
    if (status === "loading") return { close: "Close" }
    if (status === "not_configured") return { close: "Close" }
    return { refresh: "Refresh", close: "Close" }
  })

  const keys = createMemo(() => Object.keys(options()) as (keyof ReturnType<typeof options>)[])

  async function fetchAntigravityQuota() {
    setAntigravityStatus("loading")
    setAntigravityError("")

    try {
      const groups = await fetchQuota("antigravity", sdk)
      if (groups.length === 0 && !antigravityProvider()) {
        setAntigravityStatus("not_configured")
        return
      }

      setAntigravityQuotas(groups)
      setAntigravityStatus("success")
    } catch (err) {
      setAntigravityError(err instanceof Error ? err.message : String(err))
      setAntigravityStatus("error")
    }
  }

  async function fetchGeminiCliQuota() {
    setGeminiCliStatus("loading")
    setGeminiCliError("")

    try {
      const groups = await fetchQuota("gemini-cli", sdk)
      if (groups.length === 0 && !geminiCliProvider()) {
        setGeminiCliStatus("not_configured")
        return
      }

      setGeminiCliQuotas(groups)
      setGeminiCliStatus("success")
    } catch (err) {
      setGeminiCliError(err instanceof Error ? err.message : String(err))
      setGeminiCliStatus("error")
    }
  }

  async function fetchClaudeQuota() {
    setClaudeStatus("loading")
    setClaudeError("")

    try {
      const groups = await fetchQuota("anthropic", sdk)
      if (groups.length === 0 && !hasClaudeAuth()) {
        setClaudeStatus("not_configured")
        return
      }
      setClaudeQuotas(groups)
      setClaudeStatus("success")
    } catch (err) {
      setClaudeError(err instanceof Error ? err.message : String(err))
      setClaudeStatus("error")
    }
  }

  function fetchCurrentTab() {
    if (activeTab() === "antigravity") {
      fetchAntigravityQuota()
    } else if (activeTab() === "gemini-cli") {
      fetchGeminiCliQuota()
    } else {
      fetchClaudeQuota()
    }
  }

  onMount(() => {
    // Fetch all on mount
    fetchAntigravityQuota()
    fetchGeminiCliQuota()
    fetchClaudeQuota()
  })

  function handleSelect(option: string) {
    if (option === "close") {
      props.onClose()
      return
    }
    if (option === "refresh" || option === "retry") {
      fetchCurrentTab()
    }
  }

  function switchTab(tab: Tab) {
    setActiveTab(tab)
    setStore("selected", 0)
  }

  useKeyboard((evt) => {
    // Tab switching
    if (evt.name === "tab") {
      evt.preventDefault()
      const currentTabs = tabs()
      const currentIdx = currentTabs.indexOf(activeTab())
      const nextIdx = (currentIdx + 1) % currentTabs.length
      switchTab(currentTabs[nextIdx])
      return
    }

    if (evt.name === "1") {
      evt.preventDefault()
      switchTab(tabs()[0])
      return
    }

    if (evt.name === "2") {
      evt.preventDefault()
      if (tabs()[1]) switchTab(tabs()[1])
      return
    }

    if (evt.name === "3") {
      evt.preventDefault()
      if (tabs()[2]) switchTab(tabs()[2])
      return
    }

    // Button navigation
    if (evt.name === "left" || evt.name === "h") {
      evt.preventDefault()
      const next = (store.selected - 1 + keys().length) % keys().length
      setStore("selected", next)
    }

    if (evt.name === "right" || evt.name === "l") {
      evt.preventDefault()
      const next = (store.selected + 1) % keys().length
      setStore("selected", next)
    }

    if (evt.name === "return") {
      evt.preventDefault()
      handleSelect(keys()[store.selected])
    }

    if (evt.name === "escape" || keybind.match("app_exit", evt)) {
      evt.preventDefault()
      props.onClose()
    }
  })

  const barColor = (percent: number) => {
    if (percent > 70) return theme.success
    if (percent > 30) return theme.warning
    return theme.error
  }

  const currentQuotas = createMemo(() => {
    return activeTab() === "antigravity"
      ? antigravityQuotas()
      : activeTab() === "gemini-cli"
        ? geminiCliQuotas()
        : claudeQuotas()
  })

  const maxDisplayLen = createMemo(() => {
    const displays = currentQuotas().map((q) => q.display)
    return Math.max(...displays.map((d) => d.length), 7)
  })

  const tabLabel = (tab: Tab) => {
    return tab === "antigravity" ? "Antigravity" : tab === "gemini-cli" ? "Gemini CLI" : "Claude"
  }

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.primary}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        {/* Header with tabs */}
        <box flexDirection="row" justifyContent="space-between" paddingLeft={1}>
          <box flexDirection="row" gap={1}>
            <text fg={theme.primary}>{"◈"}</text>
            <text fg={theme.text}>Quota Usage</text>
          </box>
          <box flexDirection="row" gap={1}>
            <For each={tabs()}>
              {(tab, index) => (
                <box
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={activeTab() === tab ? theme.primary : theme.backgroundMenu}
                >
                  <text fg={activeTab() === tab ? theme.selectedListItemText : theme.textMuted}>
                    [{index() + 1}] {tabLabel(tab)}
                  </text>
                </box>
              )}
            </For>
          </box>
        </box>

        {/* Antigravity content */}
        <Show when={activeTab() === "antigravity"}>
          <Show when={antigravityStatus() === "loading"}>
            <box paddingLeft={1}>
              <text fg={theme.textMuted}>{"  ◐ Refreshing quota data..."}</text>
            </box>
          </Show>

          <Show when={antigravityStatus() === "error"}>
            <box paddingLeft={1}>
              <text fg={theme.error}>
                {"  ✗ "}
                {antigravityError()}
              </text>
            </box>
          </Show>

          <Show when={antigravityStatus() === "not_configured"}>
            <box paddingLeft={1} gap={1}>
              <text fg={theme.textMuted}>{"  Antigravity provider not configured."}</text>
              <text fg={theme.textMuted}>{"  Add it to your opencode.json:"}</text>
              <text fg={theme.text}>{""}</text>
              <text fg={theme.textMuted}>{'    "provider": {'}</text>
              <text fg={theme.textMuted}>{'      "antigravity": {'}</text>
              <text fg={theme.textMuted}>{'        "options": { "baseURL": "...", "apiKey": "..." }'}</text>
              <text fg={theme.textMuted}>{"      }"}</text>
              <text fg={theme.textMuted}>{"    }"}</text>
            </box>
          </Show>

          <Show when={antigravityStatus() === "success"}>
            <box paddingLeft={1} gap={0} minHeight={3}>
              <Show when={antigravityQuotas().length === 0}>
                <text fg={theme.textMuted}>{"  No quota data available"}</text>
                <text fg={theme.textMuted}>{"  (No Antigravity credentials configured on proxy)"}</text>
              </Show>
              <For each={antigravityQuotas()}>
                {(quota) => (
                  <text fg={theme.text}>
                    {"  "}
                    <span style={{ fg: theme.textMuted }}>{quota.display.padStart(maxDisplayLen())}</span>
                    {"  "}
                    <span style={{ fg: barColor(quota.remaining) }}>{renderProgressBar(quota.remaining)}</span>
                    {"  "}
                    {String(quota.remaining).padStart(3)}%{"  "}
                    <span style={{ fg: theme.textMuted }}>
                      {String(quota.used).padStart(4)}/{quota.max}
                    </span>
                    <Show when={quota.resetTime}>
                      <span style={{ fg: theme.textMuted }}>
                        {"   resets "}
                        {quota.resetTime}
                      </span>
                    </Show>
                  </text>
                )}
              </For>
            </box>
          </Show>
        </Show>

        {/* Gemini CLI content */}
        <Show when={activeTab() === "gemini-cli"}>
          <Show when={geminiCliStatus() === "loading"}>
            <box paddingLeft={1}>
              <text fg={theme.textMuted}>{"  ◐ Refreshing quota data..."}</text>
            </box>
          </Show>

          <Show when={geminiCliStatus() === "error"}>
            <box paddingLeft={1}>
              <text fg={theme.error}>
                {"  ✗ "}
                {geminiCliError()}
              </text>
            </box>
          </Show>

          <Show when={geminiCliStatus() === "not_configured"}>
            <box paddingLeft={1} gap={1}>
              <text fg={theme.textMuted}>{"  Gemini CLI provider not configured."}</text>
              <text fg={theme.textMuted}>{"  Add it to your opencode.json:"}</text>
              <text fg={theme.text}>{""}</text>
              <text fg={theme.textMuted}>{'    "provider": {'}</text>
              <text fg={theme.textMuted}>{'      "gemini-cli": {'}</text>
              <text fg={theme.textMuted}>{'        "npm": "@ai-sdk/openai-compatible",'}</text>
              <text fg={theme.textMuted}>{'        "options": { "baseURL": "...", "apiKey": "..." }'}</text>
              <text fg={theme.textMuted}>{"      }"}</text>
              <text fg={theme.textMuted}>{"    }"}</text>
            </box>
          </Show>

          <Show when={geminiCliStatus() === "success"}>
            <box paddingLeft={1} gap={0} minHeight={3}>
              <Show when={geminiCliQuotas().length === 0}>
                <text fg={theme.textMuted}>{"  No quota data available"}</text>
                <text fg={theme.textMuted}>{"  (No Gemini CLI credentials configured on proxy)"}</text>
              </Show>
              <For each={geminiCliQuotas()}>
                {(quota) => (
                  <text fg={theme.text}>
                    {"  "}
                    <span style={{ fg: theme.textMuted }}>{quota.display.padStart(maxDisplayLen())}</span>
                    {"  "}
                    <span style={{ fg: barColor(quota.remaining) }}>{renderProgressBar(quota.remaining)}</span>
                    {"  "}
                    {String(quota.remaining).padStart(3)}%{"  "}
                    <span style={{ fg: theme.textMuted }}>
                      {String(quota.used).padStart(4)}/{quota.max}
                    </span>
                    <Show when={quota.resetTime}>
                      <span style={{ fg: theme.textMuted }}>
                        {"   resets "}
                        {quota.resetTime}
                      </span>
                    </Show>
                  </text>
                )}
              </For>
            </box>
          </Show>
        </Show>

        {/* Claude content */}
        <Show when={activeTab() === "claude"}>
          <Show when={claudeStatus() === "loading"}>
            <box paddingLeft={1}>
              <text fg={theme.textMuted}>{"  ◐ Refreshing quota data..."}</text>
            </box>
          </Show>

          <Show when={claudeStatus() === "error"}>
            <box paddingLeft={1}>
              <text fg={theme.error}>
                {"  ✗ "}
                {claudeError()}
              </text>
            </box>
          </Show>

          <Show when={claudeStatus() === "not_configured"}>
            <box paddingLeft={1} gap={1}>
              <text fg={theme.textMuted}>{"  Claude Pro/Max not authenticated."}</text>
              <text fg={theme.text}>{""}</text>
              <text fg={theme.text}>
                {"  Run: "}
                <span style={{ fg: theme.primary }}>/auth anthropic</span>
              </text>
            </box>
          </Show>

          <Show when={claudeStatus() === "success"}>
            <box paddingLeft={1} gap={0} minHeight={3}>
              <For each={claudeQuotas()}>
                {(quota) => (
                  <text fg={theme.text}>
                    {"  "}
                    <span style={{ fg: theme.textMuted }}>{quota.display.padStart(maxDisplayLen())}</span>
                    {"  "}
                    <span style={{ fg: barColor(quota.remaining) }}>{renderProgressBar(quota.remaining)}</span>
                    {"  "}
                    {String(quota.remaining).padStart(3)}%
                    <Show when={quota.resetTime}>
                      <span style={{ fg: theme.textMuted }}>
                        {"     resets "}
                        {quota.resetTime}
                      </span>
                    </Show>
                  </text>
                )}
              </For>
            </box>
          </Show>
        </Show>
      </box>

      {/* Footer with buttons */}
      <box
        flexDirection="row"
        flexShrink={0}
        gap={1}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        backgroundColor={theme.backgroundElement}
        justifyContent="space-between"
      >
        <box flexDirection="row" gap={1}>
          <For each={keys()}>
            {(option) => (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={option === keys()[store.selected] ? theme.primary : theme.backgroundMenu}
              >
                <text fg={option === keys()[store.selected] ? theme.selectedListItemText : theme.textMuted}>
                  {options()[option]}
                </text>
              </box>
            )}
          </For>
        </box>
        <box flexDirection="row" gap={2}>
          <text fg={theme.text}>
            tab/1-3 <span style={{ fg: theme.textMuted }}>switch</span>
          </text>
          <text fg={theme.text}>
            {"⇆"} <span style={{ fg: theme.textMuted }}>select</span>
          </text>
          <text fg={theme.text}>
            enter <span style={{ fg: theme.textMuted }}>confirm</span>
          </text>
        </box>
      </box>
    </box>
  )
}

import { getCurrentProjectId, listProjects } from "../workspace.mjs"

/**
 * Bootstrap data for the workspace SPA. The developer-account lookup is cached
 * (successes and failures alike) so a dead host isn't refetched on every
 * bootstrap; the UI's connect/disconnect routes call `resetAccountCache`.
 */
export function createBootstrap({ sdkVersion, dev, resolveDefaultDir, previewManager }) {
  let accountCache = { at: 0, value: null }

  function resetAccountCache() {
    accountCache = { at: 0, value: null }
  }

  async function accountInfo() {
    let _account
    try {
      const mod = await import("../account.mjs")
      const cfg = mod.loadConfig()
      const auth = mod.developerAuth({}, cfg)
      if (!auth.token) return { connected: false, appUrl: auth.appUrl }
      if (accountCache.value && Date.now() - accountCache.at < 60_000) return accountCache.value
      const me = await fetch(`${auth.appUrl}/api/developers/me`, {
        headers: { Authorization: `Bearer ${auth.token}` },
        signal: AbortSignal.timeout(8000),
      }).then((r) => r.json())
      const value = {
        connected: true,
        appUrl: auth.appUrl,
        email: me?.account?.email,
        name: me?.account?.name,
        status: me?.account?.status,
      }
      accountCache = { at: Date.now(), value }
      return value
    } catch {
      // Cache the failure too — otherwise every bootstrap refetches a dead host.
      const value = { connected: true, appUrl: accountCache.value?.appUrl, unreachable: true }
      accountCache = { at: Date.now(), value }
      return value
    }
  }

  async function bootstrap() {
    let assistant = { configured: false }
    try {
      const { resolveAssistant, assistantSummary } = await import("../plugin/dev/assistant.mjs")
      assistant = assistantSummary(resolveAssistant({ config: {} }))
    } catch {
      // assistant module unavailable
    }
    let userSettings = null
    try {
      const { userSettingsView } = await import("../user-settings.mjs")
      userSettings = userSettingsView()
    } catch {
      // user-settings module unavailable
    }
    const currentId = getCurrentProjectId()
    const currentProject = currentId ? (listProjects().find((entry) => entry.id === currentId) ?? null) : null
    const currentPreview = previewManager.currentPreviewRecord()
    return {
      mode: "workspace",
      sdk: { version: sdkVersion, dev: Boolean(dev) },
      projects: listProjects(),
      current:
        currentProject && !currentProject.missing
          ? {
              project: currentProject,
              url: currentPreview?.url ?? null,
              port: currentPreview?.port ?? null,
              alive: Boolean(currentPreview),
            }
          : null,
      account: await accountInfo(),
      assistant,
      userSettings,
      defaultDir: resolveDefaultDir(),
      previews: previewManager.listPreviews().filter((preview) => preview.alive),
    }
  }

  return { accountInfo, bootstrap, resetAccountCache }
}

import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// Point the user-settings store at a temp file BEFORE any test runs.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-user-settings-"))
process.env.SELLDOES_SETTINGS_FILE = path.join(tempDir, "settings.json")

const {
  applyUserSettingsPatch,
  loadUserSettings,
  maskApiKey,
  migrateProjectAssistantConfigs,
  userSettingsView,
} = await import("./user-settings.mjs")

test("assistant settings: set, keep (undefined) and clear (null)", () => {
  applyUserSettingsPatch({ assistant: { provider: "openrouter", model: "anthropic/claude-sonnet-4", apiKey: "sk-test-1234567890" } })
  let stored = loadUserSettings()
  assert.equal(stored.assistant.provider, "openrouter")
  assert.equal(stored.assistant.apiKey, "sk-test-1234567890")

  // undefined keeps the saved value
  applyUserSettingsPatch({ assistant: { model: "gpt-4o-mini" } })
  stored = loadUserSettings()
  assert.equal(stored.assistant.provider, "openrouter")
  assert.equal(stored.assistant.model, "gpt-4o-mini")

  // null / "" clears the field
  applyUserSettingsPatch({ assistant: { apiKey: null, provider: "" } })
  stored = loadUserSettings()
  assert.equal(stored.assistant.apiKey, undefined)
  assert.equal(stored.assistant.provider, undefined)
  assert.equal(stored.assistant.model, "gpt-4o-mini")
})

test("userSettingsView never exposes the raw key", () => {
  applyUserSettingsPatch({ assistant: { apiKey: "sk-secret-key-abcdef" } })
  const view = userSettingsView()
  assert.equal(view.assistant.apiKeySet, true)
  assert.ok(view.assistant.apiKeyMasked)
  assert.ok(!JSON.stringify(view).includes("sk-secret-key-abcdef"))
  assert.equal(maskApiKey("sk-secret-key-abcdef"), "sk-s…cdef")
  assert.equal(maskApiKey(""), null)
})

test("publish.bump fallback validates against patch/minor/major", () => {
  applyUserSettingsPatch({ publish: { bump: "minor" } })
  assert.equal(userSettingsView().publish.bump, "minor")
  assert.throws(() => applyUserSettingsPatch({ publish: { bump: "banana" } }), /publish.bump/)
  applyUserSettingsPatch({ publish: { bump: null } })
  assert.equal(userSettingsView().publish.bump, null)
})

test("defaultDir is created on disk when missing", () => {
  const target = path.join(tempDir, "projects")
  applyUserSettingsPatch({ defaultDir: target })
  assert.ok(fs.statSync(target).isDirectory())
  assert.throws(() => applyUserSettingsPatch({ defaultDir: process.execPath }), /file, not a folder/)
})

test("editor preference: auto clears, arbitrary commands allowed", () => {
  applyUserSettingsPatch({ editor: "code" })
  assert.equal(userSettingsView().editor, "code")
  applyUserSettingsPatch({ editor: "auto" })
  assert.equal(userSettingsView().editor, null)
  applyUserSettingsPatch({ editor: "my-custom-editor" })
  assert.equal(userSettingsView().editor, "my-custom-editor")
})

test("migration lifts assistant credentials out of project folders", () => {
  // Clean slate — earlier tests left credentials in the user settings.
  applyUserSettingsPatch({ assistant: { provider: null, apiKey: null, model: null, baseUrl: null } })
  // A project as older SDK versions left it: full assistant section with a key.
  const projectDir = fs.mkdtempSync(path.join(tempDir, "project-"))
  fs.writeFileSync(
    path.join(projectDir, "selldoes.config.json"),
    `${JSON.stringify(
      {
        storeId: 7,
        assistant: { provider: "anthropic", apiKey: "sk-project-key-9999", model: "claude-sonnet-4-5" },
      },
      null,
      2,
    )}\n`,
  )
  // A second project with no assistant section — untouched.
  const plainDir = fs.mkdtempSync(path.join(tempDir, "plain-"))
  fs.writeFileSync(path.join(plainDir, "selldoes.config.json"), `${JSON.stringify({ storeId: 2 })}\n`)

  const result = migrateProjectAssistantConfigs([
    { slug: "with-key", path: projectDir },
    { slug: "plain", path: plainDir },
  ])

  assert.deepEqual(result.migrated, ["with-key"])
  const user = loadUserSettings()
  assert.equal(user.assistant.provider, "anthropic")
  assert.equal(user.assistant.apiKey, "sk-project-key-9999")
  // The project keeps only the model as its per-project override.
  const fileConfig = JSON.parse(fs.readFileSync(path.join(projectDir, "selldoes.config.json"), "utf8"))
  assert.deepEqual(fileConfig.assistant, { model: "claude-sonnet-4-5" })
  assert.equal(fileConfig.storeId, 7)
  const plain = JSON.parse(fs.readFileSync(path.join(plainDir, "selldoes.config.json"), "utf8"))
  assert.equal(plain.assistant, undefined)
})

test("migration never overwrites an existing user credential", () => {
  applyUserSettingsPatch({ assistant: { provider: "openai", apiKey: "sk-user-already-here" } })
  const projectDir = fs.mkdtempSync(path.join(tempDir, "project2-"))
  fs.writeFileSync(
    path.join(projectDir, "selldoes.config.json"),
    `${JSON.stringify({ assistant: { provider: "anthropic", apiKey: "sk-other" } })}\n`,
  )
  migrateProjectAssistantConfigs([{ slug: "second", path: projectDir }])
  const user = loadUserSettings()
  assert.equal(user.assistant.provider, "openai")
  assert.equal(user.assistant.apiKey, "sk-user-already-here")
  // The project's credentials are stripped either way.
  const fileConfig = JSON.parse(fs.readFileSync(path.join(projectDir, "selldoes.config.json"), "utf8"))
  assert.equal(fileConfig.assistant, undefined)
})

import { spawnSync } from "node:child_process"
import * as prompts from "@clack/prompts"
import { getUpdateInfo, installCommandFor } from "./update-check.mjs"

export async function updateCommand(args = [], flags = {}) {
  const checkOnly = flags.check === true
  const assumeYes = flags.yes === true || flags.y === true || args.includes("-y")
  const forced = flags.global === true ? "global" : flags.local === true ? "local" : null

  const info = await getUpdateInfo()
  console.log(`Current: ${info.current}`)
  console.log(`Latest:  ${info.latest ?? "unknown (registry unreachable)"}`)

  if (info.latest === null) {
    console.error("✗ Could not reach the npm registry — check your connection and try again.")
    process.exitCode = 1
    return
  }

  if (!info.outdated) {
    console.log("✓ selldoes is up to date")
    return
  }

  const mode = forced ?? info.mode
  if (mode === "npx") {
    console.log("")
    console.log("You are running selldoes from the npx cache — npx fetches on demand.")
    console.log("Use the latest with:   npx selldoes@latest")
    console.log("Or install it globally: npm install -g selldoes@latest")
    return
  }

  const command = installCommandFor(mode)

  if (checkOnly) {
    console.log("")
    console.log(`Update with: ${command}`)
    process.exitCode = 1
    return
  }

  if (!process.stdin.isTTY && !assumeYes) {
    console.log("")
    console.log(`Run this to update: ${command}`)
    console.log("(or pass --yes to run it from a script)")
    process.exitCode = 1
    return
  }

  if (!assumeYes) {
    console.log("")
    const confirmed = await prompts.confirm({ message: `Run \`${command}\`?`, initialValue: true })
    if (prompts.isCancel(confirmed) || confirmed !== true) {
      prompts.cancel("Update cancelled")
      return
    }
  }

  console.log("")
  console.log(`Running ${command} ...`)
  const result = spawnSync(command, { stdio: "inherit", shell: true, windowsHide: true })
  if (result.status === 0) {
    console.log("")
    console.log(`✓ Updated selldoes ${info.current} → ${info.latest}`)
  } else {
    console.error("")
    console.error(
      `✗ Update failed (npm exit ${result.status ?? "unknown"})${result.error?.message ? `: ${result.error.message}` : ""}`
    )
    process.exitCode = result.status || 1
  }
}

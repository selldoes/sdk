/** Builds the mock `ctx.secrets` capability (permission-gated `selldoes.config.json` lookups). */
export function createSecrets({ config, requirePermission }) {
  return {
    async get(name) {
      requirePermission("secrets:read", "ctx.secrets.get")
      const value = config.secrets?.[String(name)]
      return value === undefined || value === null ? null : String(value)
    },
  }
}

# create-selldoes-plugin

Scaffold a new [Selldoes](https://selldoes.com) plugin project.

```bash
npm create selldoes-plugin@latest my-plugin
# or without a dashboard UI:
npm create selldoes-plugin@latest my-plugin -- --no-ui
```

The generated project includes a manifest, a typed sandbox entry with a working
`/notes` API, an optional dashboard UI, dev-server settings, and scripts for
`dev` / `build` / `pack` / `validate` / `publish`.

Local preview:

```bash
cd my-plugin
npm install
npm run dev
```

## License

MIT

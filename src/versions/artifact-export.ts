import { strToU8, zipSync } from "fflate"
import type { Version } from "../types/agent"

export function buildVersionArchive(version: Version): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  for (const [path, source] of Object.entries(version.snapshot.files)) {
    files[path.replace(/^\/+/, "")] = strToU8(source)
  }
  const dependencies = { ...version.snapshot.dependencies }
  files["package.json"] = strToU8(JSON.stringify({
    name: archiveName(version.snapshot.title),
    private: true,
    version: "0.0.0",
    type: "module",
    scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
    dependencies,
    devDependencies: { "@vitejs/plugin-vue": "^6.0.1", vite: "^7.1.5", typescript: "^5.9.3" },
  }, null, 2) + "\n")
  files["index.html"] = strToU8('<!doctype html>\n<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vivatom App</title></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>\n')
  files["vite.config.ts"] = strToU8('import { defineConfig } from "vite"\nimport vue from "@vitejs/plugin-vue"\n\nexport default defineConfig({ plugins: [vue()] })\n')
  files["VIVATOM_VERSION.json"] = strToU8(JSON.stringify({ id: version.id, parentVersionId: version.parentVersionId, prompt: version.prompt, createdAt: version.createdAt }, null, 2) + "\n")
  return zipSync(files, { level: 6 })
}

export function archiveFilename(version: Version): string {
  return `${archiveName(version.snapshot.title)}-${version.id.slice(-8)}.zip`
}

function archiveName(title: string): string {
  const normalized = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  return normalized || "vivatom-app"
}

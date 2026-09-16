<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue"
import { createPreviewRuntimeBridge } from "../services/preview-runtime-bridge"
import { parseHostedPreviewTarget, verifyHostedPreviewTarget } from "../versions/preview-url"

const iframe = ref<HTMLIFrameElement>()
const artifactUrl = ref("")
const error = ref("")
const state = ref<"checking" | "loading" | "ready" | "error">("checking")
const controller = new AbortController()
let runtimeBridge: ((event: MessageEvent) => void) | undefined
let loadTimeout: number | undefined
let frameLoaded = false
let runtimeReady = false
let requiresRuntime = false

onMounted(async () => {
  const target = parseHostedPreviewTarget(window.location.search, window.location.hash)
  if (!target) {
    error.value = "预览地址无效。"
    state.value = "error"
    return
  }
  try {
    await verifyHostedPreviewTarget(target, controller.signal)
    if (controller.signal.aborted) return
    state.value = "loading"
    requiresRuntime = Boolean(target.publicKey)
    artifactUrl.value = target.artifactUrl
    loadTimeout = window.setTimeout(() => fail("正式版本加载超时，请稍后重试。"), 15000)
    if (target.publicKey) {
      const bridge = createPreviewRuntimeBridge({
        projectId: target.projectId,
        publicKey: target.publicKey,
        apiBaseUrl: window.location.origin,
        getPreviewWindow: () => iframe.value?.contentWindow ?? null,
        onReady: () => {
          runtimeReady = true
          completeWhenReady()
        },
      })
      runtimeBridge = (event) => { void bridge(event) }
      window.addEventListener("message", runtimeBridge)
    }
  } catch {
    if (!controller.signal.aborted) fail("正式版本不存在或完整性验证失败。")
  }
})

function frameReady() {
  frameLoaded = true
  completeWhenReady()
}

function completeWhenReady() {
  if (!frameLoaded || (requiresRuntime && !runtimeReady)) return
  if (loadTimeout !== undefined) window.clearTimeout(loadTimeout)
  state.value = "ready"
}

function fail(message: string) {
  if (loadTimeout !== undefined) window.clearTimeout(loadTimeout)
  error.value = message
  state.value = "error"
  artifactUrl.value = ""
}

onBeforeUnmount(() => {
  if (runtimeBridge) window.removeEventListener("message", runtimeBridge)
  if (loadTimeout !== undefined) window.clearTimeout(loadTimeout)
  controller.abort()
})
</script>

<template>
  <main class="artifact-preview">
    <iframe
      v-if="artifactUrl"
      ref="iframe"
      :src="artifactUrl"
      title="Vivatom 正式版本预览"
      sandbox="allow-forms allow-modals allow-popups allow-presentation allow-scripts"
      @load="frameReady"
      @error="fail('正式版本加载失败。')"
    />
    <p v-if="state !== 'ready'">{{ error || (state === "checking" ? "正在验证正式版本..." : "正在加载正式版本...") }}</p>
  </main>
</template>

<style scoped>
.artifact-preview { position: relative; width: 100%; min-height: 100vh; margin: 0; background: #fff; }
.artifact-preview iframe { display: block; width: 100%; height: 100vh; border: 0; }
.artifact-preview p { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; padding: 32px; color: #444; background: #fff; font: 14px/1.6 system-ui, sans-serif; }
</style>

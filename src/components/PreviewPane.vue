<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue"
import { SandpackPreviewAdapter } from "../preview/preview-adapter"
import type { ProjectRuntime } from "../domain/project"
import { createPreviewRuntimeBridge } from "../services/preview-runtime-bridge"
import type { ProjectSnapshot } from "../types/agent"

const props = defineProps<{ snapshot: ProjectSnapshot; projectId?: string; runtime?: ProjectRuntime }>()
const emit = defineEmits<{
  ready: [snapshot: ProjectSnapshot]
  error: [message: string]
}>()

const iframe = ref<HTMLIFrameElement>()
const state = ref<"compiling" | "ready" | "error">("compiling")
const adapter = new SandpackPreviewAdapter()
const controller = new AbortController()
let runtimeBridge: ((event: MessageEvent) => void) | undefined

onMounted(async () => {
  if (!iframe.value) return
  if (props.projectId && props.runtime) {
    const bridge = createPreviewRuntimeBridge({
      projectId: props.projectId,
      publicKey: props.runtime.publicKey,
      apiBaseUrl: window.location.origin,
      getPreviewWindow: () => iframe.value?.contentWindow ?? null,
    })
    runtimeBridge = (event) => { void bridge(event) }
    window.addEventListener("message", runtimeBridge)
  }
  try {
    await adapter.compile(iframe.value, props.snapshot, controller.signal)
    state.value = "ready"
    emit("ready", props.snapshot)
  } catch (cause) {
    if (controller.signal.aborted) return
    state.value = "error"
    emit("error", cause instanceof Error ? cause.message : "预览编译失败")
  }
})

onBeforeUnmount(() => {
  if (runtimeBridge) window.removeEventListener("message", runtimeBridge)
  controller.abort()
  adapter.dispose()
})
</script>

<template>
  <section class="preview-pane">
    <div class="preview-toolbar">
      <strong>运行预览</strong>
      <span :data-state="state">
        {{ state === "compiling" ? "编译中" : state === "ready" ? "编译通过" : "编译失败" }}
      </span>
    </div>
    <iframe
      ref="iframe"
      title="生成应用预览"
      sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"
    />
  </section>
</template>

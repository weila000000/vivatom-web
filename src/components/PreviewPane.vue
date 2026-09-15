<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue"
import { SandpackPreviewAdapter } from "../preview/preview-adapter"
import type { ProjectSnapshot } from "../types/agent"

const props = defineProps<{ snapshot: ProjectSnapshot }>()
const emit = defineEmits<{
  ready: [snapshot: ProjectSnapshot]
  error: [message: string]
}>()

const iframe = ref<HTMLIFrameElement>()
const state = ref<"compiling" | "ready" | "error">("compiling")
const adapter = new SandpackPreviewAdapter()
const controller = new AbortController()

onMounted(async () => {
  if (!iframe.value) return
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

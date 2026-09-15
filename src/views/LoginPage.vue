<script setup lang="ts">
import { ArrowLeft, ArrowRight, LockKeyhole } from "@lucide/vue"
import { ref } from "vue"
import { useRouter } from "vue-router"
import { loginPlatformAccount, PlatformError, registerPlatformAccount } from "../services/platform-client"
import { writeTenantSession } from "../services/tenant-session"

const router = useRouter()
const mode = ref<"login" | "register">("login")
const email = ref("")
const password = ref("")
const name = ref("")
const workspaceName = ref("")
const submitting = ref(false)
const error = ref("")

async function submit() {
  error.value = ""
  submitting.value = true
  try {
    const auth = mode.value === "login"
      ? await loginPlatformAccount(email.value, password.value)
      : await registerPlatformAccount({
        email: email.value,
        password: password.value,
        name: name.value,
        workspaceName: workspaceName.value,
      })
    writeTenantSession(auth)
    await router.push("/app")
  } catch (cause) {
    error.value = cause instanceof PlatformError ? cause.message : "账户服务暂时不可用"
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <RouterLink class="back-link" to="/"><ArrowLeft :size="17" /> 返回官网</RouterLink>
    <section class="login-panel">
      <RouterLink class="logo" to="/"><span>V</span>Vivatom</RouterLink>
      <div class="login-icon"><LockKeyhole :size="24" /></div>
      <h1>{{ mode === "login" ? "登录你的工作区" : "创建 Vivatom 账户" }}</h1>
      <p>{{ mode === "login" ? "继续构建、管理和发布你的 AI 应用。" : "创建账户并拥有你的第一个工作区。" }}</p>
      <div class="login-mode" aria-label="账户操作">
        <button type="button" :class="{ active: mode === 'login' }" @click="mode = 'login'; error = ''">登录</button>
        <button type="button" :class="{ active: mode === 'register' }" @click="mode = 'register'; error = ''">注册</button>
      </div>
      <form @submit.prevent="submit">
        <template v-if="mode === 'register'">
          <label>姓名<input v-model="name" type="text" autocomplete="name" maxlength="60" required /></label>
          <label>工作区名称<input v-model="workspaceName" type="text" maxlength="80" required /></label>
        </template>
        <label>邮箱<input v-model="email" type="email" autocomplete="email" required /></label>
        <label>密码<input v-model="password" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" minlength="8" maxlength="128" required /></label>
        <p v-if="error" class="login-error" role="alert">{{ error }}</p>
        <button class="primary-action" type="submit" :disabled="submitting">{{ submitting ? "请稍候..." : mode === "login" ? "登录" : "创建账户" }} <ArrowRight :size="17" /></button>
      </form>
      <small>{{ mode === "login" ? "还没有账户？切换到注册即可开始。" : "密码至少需要 8 个字符。" }}</small>
    </section>
  </main>
</template>

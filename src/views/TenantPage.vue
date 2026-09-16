<script setup lang="ts">
import { Bell, ChevronDown, CircleHelp, Compass, ExternalLink, Home, LogOut, Menu, PanelLeftClose, Plus, Settings, Sparkles, UserRound, Users, WalletCards, X } from "@lucide/vue"
import { computed, onMounted, ref, watch } from "vue"
import { useRouter } from "vue-router"
import StudioWorkspace from "../components/StudioWorkspace.vue"
import WorkspaceMembers from "../components/WorkspaceMembers.vue"
import { fetchPlatformIdentity, fetchWorkspaceUsage, listWorkspaceProjects, logoutPlatformAccount, PlatformError, type CatalogProject, type WorkspaceUsage } from "../services/platform-client"
import { checkServer } from "../services/health"
import { clearTenantSession, readTenantSession, selectTenantWorkspace, updateTenantIdentity } from "../services/tenant-session"

const router = useRouter()
const mobileOpen = ref(false)
const workspaceOpen = ref(false)
const session = ref(readTenantSession())
const catalogProjects = ref<CatalogProject[]>([])
const selectedProjectId = ref<string>()
const usage = ref<WorkspaceUsage>()
const view = ref<"studio" | "members">("studio")
const initialized = ref(false)
const initializing = ref(false)
const startupError = ref("")
const initials = computed(() => session.value?.user.name.slice(0, 1).toUpperCase() ?? "V")
const activeWorkspace = computed(() => session.value?.workspaces.find((item) => item.id === session.value?.activeWorkspaceId) ?? session.value?.workspaces[0])

onMounted(() => { void initialize() })

async function initialize() {
  if (!session.value) return void router.replace("/login")
  initializing.value = true
  startupError.value = ""
  try {
    let ready = false
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (await checkServer() === "ready") {
        ready = true
        break
      }
      await new Promise((resolve) => window.setTimeout(resolve, 500))
    }
    if (!ready) throw new Error("service unavailable")
    const identity = await fetchPlatformIdentity(session.value.token)
    session.value = updateTenantIdentity(identity.user, identity.workspaces)
    await refreshCatalog()
	await refreshUsage()
    initialized.value = true
  } catch (cause) {
    if (cause instanceof PlatformError && cause.status === 401) {
      clearTenantSession()
      await router.replace("/login")
      return
    }
    startupError.value = "服务仍在启动，请稍后重试。"
  } finally {
    initializing.value = false
  }
}

function chooseWorkspace(id: string) {
  session.value = selectTenantWorkspace(id)
  selectedProjectId.value = undefined
  workspaceOpen.value = false
}

async function refreshCatalog() {
  if (!session.value || !activeWorkspace.value) return
  try {
    catalogProjects.value = await listWorkspaceProjects(activeWorkspace.value.id, session.value.token)
  } catch {
    catalogProjects.value = []
  }
}

async function refreshUsage() {
  if (!session.value || !activeWorkspace.value) return
  try { usage.value = await fetchWorkspaceUsage(activeWorkspace.value.id, session.value.token) }
  catch { usage.value = undefined }
}

async function refreshIdentity() {
  if (!session.value) return
  try {
    const identity = await fetchPlatformIdentity(session.value.token)
    session.value = updateTenantIdentity(identity.user, identity.workspaces)
    await refreshCatalog()
  } catch {
    clearTenantSession()
    await router.replace("/login")
  }
}

function catalogChanged(projectId: string) {
  selectedProjectId.value = projectId
  void refreshCatalog()
}

watch(() => activeWorkspace.value?.id, () => { void refreshCatalog(); void refreshUsage() })

async function logout() {
  const token = session.value?.token
  try {
    if (token) await logoutPlatformAccount(token)
  } finally {
    clearTenantSession()
    await router.push("/")
  }
}
</script>

<template>
  <div class="tenant-page">
    <button class="tenant-mobile-menu icon-button" type="button" aria-label="打开侧栏" @click="mobileOpen = true"><Menu :size="20" /></button>
    <aside :class="{ open: mobileOpen }">
      <div class="tenant-brand"><RouterLink class="logo dark-logo" to="/"><span>V</span>Vivatom</RouterLink><button class="icon-button" aria-label="收起侧栏" @click="mobileOpen = false"><PanelLeftClose :size="18" /></button></div>
      <div class="workspace-picker">
        <button class="workspace-switch" type="button" :aria-expanded="workspaceOpen" @click="workspaceOpen = !workspaceOpen"><span>{{ initials }}</span><strong>{{ activeWorkspace?.name }}</strong><ChevronDown :size="16" /></button>
        <div v-if="workspaceOpen" class="workspace-menu">
          <button v-for="workspace in session?.workspaces" :key="workspace.id" type="button" :class="{ active: workspace.id === activeWorkspace?.id }" @click="chooseWorkspace(workspace.id)"><span>{{ workspace.name }}</span><small>{{ workspace.role === 'owner' ? '所有者' : '成员' }}</small></button>
        </div>
      </div>
      <nav><button type="button" :class="{ active: view === 'studio' }" @click="view = 'studio'"><Home :size="18" />首页</button><a href="#discover"><Compass :size="18" />资源</a><a href="#projects"><WalletCards :size="18" />我的项目</a><button type="button" :class="{ active: view === 'members' }" @click="view = 'members'"><Users :size="18" />成员</button></nav>
      <div class="project-directory">
        <div><span>项目</span><button type="button" aria-label="创建新项目" @click="selectedProjectId = ''"><Plus :size="16" /></button></div>
        <button v-for="item in catalogProjects" :key="item.id" type="button" :class="{ active: selectedProjectId === item.id }" @click="selectedProjectId = item.id"><span>{{ item.title }}</span><small>{{ item.status === 'ready' ? '可用' : '进行中' }}</small></button>
        <p v-if="catalogProjects.length === 0"><Sparkles :size="18" />还没有项目</p>
      </div>
      <div class="account-menu"><div class="account-row"><span class="avatar">{{ initials }}</span><div><strong>{{ session?.user.name }}</strong><small>{{ session?.user.email }}</small></div></div><button @click="view = 'members'"><Settings :size="17" />工作区设置</button><button><UserRound :size="17" />个人主页</button><button><CircleHelp :size="17" />帮助中心</button><RouterLink to="/"><ExternalLink :size="17" />官网首页</RouterLink><button class="danger" @click="logout"><LogOut :size="17" />退出登录</button></div>
    </aside>
    <button v-if="mobileOpen" class="sidebar-scrim" aria-label="关闭侧栏" @click="mobileOpen = false"><X /></button>
    <section class="tenant-main"><div class="tenant-topbar"><span>{{ activeWorkspace?.name }} / {{ view === 'studio' ? '首页' : '成员' }}</span><span class="credit" :title="usage ? `已使用 ${usage.used} / ${usage.limit}` : '额度暂不可用'"><Sparkles :size="15" />{{ usage?.remaining ?? '—' }}</span><button class="icon-button" aria-label="通知"><Bell :size="18" /></button></div><div v-if="initializing" class="tenant-startup-state">正在连接服务...</div><div v-else-if="startupError" class="tenant-startup-state"><p>{{ startupError }}</p><button type="button" @click="initialize">重新连接</button></div><StudioWorkspace v-else-if="initialized && view === 'studio' && session && activeWorkspace" :token="session.token" :workspace-id="activeWorkspace.id" :selected-project-id="selectedProjectId" @catalog-changed="catalogChanged" @usage-changed="refreshUsage" /><WorkspaceMembers v-else-if="initialized && session && activeWorkspace" :token="session.token" :account-id="session.user.id" :workspace-id="activeWorkspace.id" :workspace-name="activeWorkspace.name" :workspace-role="activeWorkspace.role" @identity-changed="refreshIdentity" /></section>
  </div>
</template>

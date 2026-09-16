<script setup lang="ts">
import { Clock3, Copy, MailPlus, RefreshCw, Trash2, Users } from "@lucide/vue"
import { computed, onMounted, ref, watch } from "vue"
import { acceptWorkspaceInvitation, changeWorkspaceMemberRole, inviteWorkspaceMember, listWorkspaceAudit, listWorkspaceMembers, PlatformError, removeWorkspaceMember, type AuditEvent, type WorkspaceInvitation, type WorkspaceMember } from "../services/platform-client"

const props = defineProps<{ workspaceId: string; workspaceName: string; workspaceRole: "owner" | "member"; token: string; accountId: string }>()
const emit = defineEmits<{ identityChanged: [] }>()
const members = ref<WorkspaceMember[]>([])
const activity = ref<AuditEvent[]>([])
const email = ref("")
const role = ref<"owner" | "member">("member")
const invitationToken = ref("")
const invitation = ref<WorkspaceInvitation>()
const loading = ref(false)
const error = ref("")
const isOwner = computed(() => props.workspaceRole === "owner")

onMounted(load)
watch(() => props.workspaceId, load)

async function load() {
  loading.value = true
  error.value = ""
  try { [members.value, activity.value] = await Promise.all([listWorkspaceMembers(props.workspaceId, props.token), listWorkspaceAudit(props.workspaceId, props.token, { limit: 30 })]) }
  catch (cause) { error.value = message(cause) }
  finally { loading.value = false }
}

async function invite() {
  error.value = ""
  try { invitation.value = await inviteWorkspaceMember(props.workspaceId, props.token, email.value, role.value); email.value = ""; await load() }
  catch (cause) { error.value = message(cause) }
}

async function accept() {
  error.value = ""
  try { await acceptWorkspaceInvitation(invitationToken.value.trim(), props.token); invitationToken.value = ""; emit("identityChanged") }
  catch (cause) { error.value = message(cause) }
}

async function changeRole(member: WorkspaceMember, nextRole: "owner" | "member") {
  if (member.role === nextRole) return
  try { await changeWorkspaceMemberRole(props.workspaceId, member.accountId, props.token, nextRole); await load(); emit("identityChanged") }
  catch (cause) { error.value = message(cause) }
}

async function remove(member: WorkspaceMember) {
  try { await removeWorkspaceMember(props.workspaceId, member.accountId, props.token); await load(); emit("identityChanged") }
  catch (cause) { error.value = message(cause) }
}

async function copyToken() { if (invitation.value) await navigator.clipboard.writeText(invitation.value.token) }
function message(cause: unknown) { return cause instanceof PlatformError ? cause.message : "成员服务暂时不可用" }
function agentActionLabel(value: unknown) {
  const labels: Record<string, string> = { plan: "需求规划", build: "源码构建", iterate: "功能迭代", repair: "问题修复", polish: "体验打磨" }
  return typeof value === "string" ? labels[value] ?? value : "Agent 任务"
}
function actionLabel(event: AuditEvent) {
  const labels: Record<string, string> = {
    "member.invited": "创建了成员邀请",
    "member.invitation_accepted": "接受邀请并加入工作区",
    "member.role_changed": `将成员角色调整为${event.metadata.to === "owner" ? "所有者" : "成员"}`,
    "member.removed": "移除了成员",
    "project.created": "创建了项目",
    "project.metadata_updated": "更新了项目状态",
    "project.document_saved": `保存了项目内容（版本 ${event.metadata.revision ?? "-"}）`,
    "project.conflict_resolved": `处理了同步冲突（保留${event.metadata.choice === "cloud" ? "云端" : "本地"}）`,
    "plan.approved": "批准了工程方案",
    "agent.started": `启动了${agentActionLabel(event.metadata.action)}`,
    "agent.completed": event.metadata.status === "succeeded"
      ? `完成了${agentActionLabel(event.metadata.action)}`
      : event.metadata.status === "cancelled"
        ? `取消了${agentActionLabel(event.metadata.action)}`
        : `${agentActionLabel(event.metadata.action)}失败（${event.metadata.resultCode ?? "unknown"}）`,
    "candidate.rejected": `拒绝了过期候选（${event.metadata.reason ?? "unknown"}）`,
    "candidate.compile_failed": `候选编译失败（${event.metadata.resultCode ?? "unknown"}）`,
    "version.restaged": "从历史版本创建了恢复候选",
    "version.committed": "提交并激活了不可变版本",
  }
  return labels[event.action] ?? "更新了工作区"
}
function targetLabel(event: AuditEvent) {
  if (typeof event.metadata.title === "string") return event.metadata.title
  if (typeof event.metadata.email === "string") return event.metadata.email
  return event.targetType === "project" ? "项目" : "成员"
}
</script>

<template>
  <main class="members-page">
    <header><div><p>工作区设置</p><h1>{{ workspaceName }}成员</h1></div><button class="icon-button" type="button" aria-label="刷新成员" @click="load"><RefreshCw :size="18" /></button></header>
    <p v-if="error" class="members-error" role="alert">{{ error }}</p>
    <section v-if="isOwner" class="invite-section">
      <h2>邀请成员</h2>
      <form @submit.prevent="invite"><label>邮箱<input v-model="email" type="email" required /></label><label>角色<select v-model="role"><option value="member">成员</option><option value="owner">所有者</option></select></label><button type="submit"><MailPlus :size="17" />创建邀请</button></form>
      <div v-if="invitation" class="invitation-result"><div><strong>邀请 token</strong><small>有效期至 {{ new Date(invitation.expiresAt).toLocaleString() }}</small></div><code>{{ invitation.token }}</code><button type="button" aria-label="复制邀请 token" @click="copyToken"><Copy :size="17" /></button></div>
    </section>
    <section class="accept-section"><h2>接受邀请</h2><form @submit.prevent="accept"><input v-model="invitationToken" aria-label="邀请 token" placeholder="输入收到的邀请 token" required /><button type="submit">加入工作区</button></form></section>
    <section class="member-section"><div class="member-heading"><h2>成员</h2><span><Users :size="15" />{{ members.length }}</span></div><p v-if="loading">正在读取成员...</p><div v-else class="member-table"><div v-for="member in members" :key="member.accountId" class="member-item"><span class="avatar">{{ member.name.slice(0, 1).toUpperCase() }}</span><div><strong>{{ member.name }}<i v-if="member.accountId === accountId">你</i></strong><small>{{ member.email }}</small></div><select v-if="isOwner" :value="member.role" aria-label="成员角色" @change="changeRole(member, ($event.target as HTMLSelectElement).value as 'owner' | 'member')"><option value="owner">所有者</option><option value="member">成员</option></select><span v-else class="member-role">{{ member.role === 'owner' ? '所有者' : '成员' }}</span><button v-if="isOwner" class="remove-member" type="button" aria-label="移除成员" @click="remove(member)"><Trash2 :size="16" /></button></div></div></section>
    <section class="activity-section"><div class="member-heading"><h2>最近活动</h2><span><Clock3 :size="15" />{{ activity.length }}</span></div><p v-if="loading">正在读取活动...</p><p v-else-if="activity.length === 0" class="activity-empty">还没有工作区活动</p><ol v-else class="activity-list"><li v-for="event in activity" :key="event.id"><span class="activity-mark"></span><div><p><strong>{{ event.actorName }}</strong> {{ actionLabel(event) }}</p><small>{{ targetLabel(event) }} · {{ new Date(event.createdAt).toLocaleString() }}</small></div></li></ol></section>
  </main>
</template>

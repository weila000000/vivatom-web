import { createRouter, createWebHistory } from "vue-router"
import LandingPage from "./views/LandingPage.vue"
import LoginPage from "./views/LoginPage.vue"
import TenantPage from "./views/TenantPage.vue"
import ArtifactPreviewPage from "./views/ArtifactPreviewPage.vue"
import { readTenantSession } from "./services/tenant-session"

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: LandingPage },
    { path: "/login", component: LoginPage },
    { path: "/app", component: TenantPage },
    { path: "/preview", component: ArtifactPreviewPage },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach((to) => {
  if (to.path === "/app" && !readTenantSession()) return "/login"
  if (to.path === "/login" && readTenantSession()) return "/app"
})

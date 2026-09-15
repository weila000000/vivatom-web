<script setup lang="ts">
import { ArrowRight, Blocks, Database, Menu, Play, ShieldCheck, Sparkles, Workflow, X } from "@lucide/vue"
import { ref } from "vue"

const menuOpen = ref(false)
const features = [
  { icon: Sparkles, title: "自然语言构建", text: "说清目标和场景，Vivatom 将需求拆成方案、页面与可运行源码。" },
  { icon: Workflow, title: "过程可审阅", text: "规划、审批、生成、验证、发布逐步推进，每一步都有明确状态。" },
  { icon: Database, title: "自带应用后端", text: "生成项目可直接使用认证、动态集合和按用户隔离的数据空间。" },
  { icon: ShieldCheck, title: "验证后再提交", text: "源码先经过规则检查与沙箱编译，通过后才成为不可变版本。" },
  { icon: Blocks, title: "持续迭代", text: "保留项目上下文和历史版本，在已有成果上修复、打磨和扩展。" },
]
</script>

<template>
  <div class="landing-page">
    <header class="landing-nav">
      <RouterLink class="logo" to="/" aria-label="Vivatom 首页"><span>V</span>Vivatom</RouterLink>
      <nav :class="{ open: menuOpen }" aria-label="官网导航">
        <a href="#product" @click="menuOpen = false">产品</a>
        <a href="#workflow" @click="menuOpen = false">工作方式</a>
        <a href="#runtime" @click="menuOpen = false">Runtime</a>
        <RouterLink class="nav-login" to="/login">登录</RouterLink>
      </nav>
      <RouterLink class="primary-action desktop-action" to="/login">开始构建 <ArrowRight :size="17" /></RouterLink>
      <button class="icon-button menu-button" type="button" aria-label="打开导航" @click="menuOpen = !menuOpen">
        <X v-if="menuOpen" :size="21" /><Menu v-else :size="21" />
      </button>
    </header>

    <main>
      <section class="hero" id="product">
        <div class="hero-copy">
          <div class="announcement"><span>NEW</span> 从想法到可运行应用</div>
          <h1>Vivatom</h1>
          <h2>把产品想法，变成真正能用的软件。</h2>
          <p>描述你的业务，审阅生成方案，然后获得带前端、认证和数据能力的完整应用。</p>
          <div class="hero-actions">
            <RouterLink class="primary-action" to="/login">免费开始 <ArrowRight :size="18" /></RouterLink>
            <a class="secondary-action" href="#workflow"><Play :size="17" fill="currentColor" /> 查看工作方式</a>
          </div>
          <div class="proof"><strong>4 步</strong> 从需求到版本 <i /> <strong>本地优先</strong> 项目持续保存 <i /> <strong>隔离 Runtime</strong> 数据边界清晰</div>
        </div>
      </section>

      <section class="logo-strip" aria-label="Vivatom 能力">
        <span>需求规划</span><span>源码生成</span><span>安全检查</span><span>沙箱编译</span><span>版本恢复</span><span>应用 Runtime</span>
      </section>

      <section class="feature-band" id="workflow">
        <div class="section-heading"><p>完整产品链路</p><h2>从一个清晰流程开始，而不是从空目录开始</h2></div>
        <div class="feature-grid">
          <article v-for="feature in features" :key="feature.title">
            <component :is="feature.icon" :size="24" />
            <h3>{{ feature.title }}</h3><p>{{ feature.text }}</p>
          </article>
        </div>
      </section>

      <section class="workflow-band" id="runtime">
        <div class="workflow-image"><img src="/assets/shipany/feature-workflow.png" alt="自动化产品工作流示意" /></div>
        <div class="workflow-copy">
          <p class="section-kicker">可控的 AI 工程</p>
          <h2>生成只是中间步骤，验证通过才是交付</h2>
          <ol><li><b>01</b><span><strong>先规划</strong>明确页面、功能、数据与验收标准。</span></li><li><b>02</b><span><strong>再构建</strong>经过审批后生成完整源码快照。</span></li><li><b>03</b><span><strong>后验证</strong>安全检查和真实编译都通过后提交版本。</span></li></ol>
          <RouterLink class="text-link" to="/login">进入 Vivatom 工作台 <ArrowRight :size="17" /></RouterLink>
        </div>
      </section>

      <section class="cta-band"><div><p>准备好开始了吗？</p><h2>你的下一个产品，从一句话开始。</h2></div><RouterLink class="primary-action light" to="/login">创建第一个项目 <ArrowRight :size="18" /></RouterLink></section>
    </main>

    <footer><RouterLink class="logo" to="/"><span>V</span>Vivatom</RouterLink><p>AI 应用构建与运行平台</p><p class="attribution">Landing foundation adapted from <a href="https://shipany.ai" target="_blank" rel="noreferrer">ShipAny</a></p><span>© 2026 Vivatom</span></footer>
  </div>
</template>

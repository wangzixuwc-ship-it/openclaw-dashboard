<template>
  <div class="dashboard">
    <!-- ========= 1. 顶部状态栏 ========= -->
    <header class="status-bar">
      <div class="status-bar-inner">
        <div class="brand">
          <el-icon :size="24" class="brand-icon"><Monitor /></el-icon>
          <h1 class="brand-title">
            OpenClaw 监控台
            <span class="brand-version">v{{ APP_VERSION }}</span>
          </h1>
          <span class="brand-time">{{ currentTime }}</span>
        </div>

        <div class="status-indicators">
          <!-- 视图切换 (removed REC-067: project monitor removed) -->

          <!-- Gateway Version -->
          <el-tooltip content="切换版本" placement="bottom">
            <div class="indicator indicator-version" @click="versionDialogVisible = true" style="cursor: pointer;">
              <span class="indicator-label">OpenClaw</span>
              <span class="indicator-value">{{ store.gatewayVersion || '未知' }}</span>
            </div>
          </el-tooltip>

          <!-- Gateway Health (REC-004: 布局合并，保持原有样式) -->
          <el-tooltip content="诊断网关" placement="bottom">
            <div class="indicator" :class="healthClass" @click="doctorDialogVisible = true">
              <el-icon :size="14"><component :is="healthIcon" /></el-icon>
              <span class="indicator-label">网关</span>
              <span>{{ healthDisplay }}</span>
              <span v-if="store.healthStatus === 'unhealthy'"> 点击诊断</span>
            </div>
          </el-tooltip>

          <!-- GPU VRAM Usage (REC-091) -->
          <el-tooltip
            v-if="store.gpuVramPercentage !== null && store.gpuVramPercentage !== undefined"
            :content="`${store.gpuVramUsedMb} / ${store.gpuVramTotalMb} MB`"
            placement="bottom"
            class="gpu-tooltip"
          >
            <div class="indicator indicator-gpu">
              <el-icon :size="14"><Monitor /></el-icon>
              <span class="indicator-label">显存</span>
              <span class="indicator-value">{{ store.gpuVramPercentage }}%</span>
            </div>
          </el-tooltip>

           <!-- Skills Button (REC-005: 替换"刷新"按钮) -->
          <el-tooltip content="技能库" placement="bottom">
            <el-button
              :icon="Briefcase"
              circle
              size="small"
              @click="skillsDialogVisible = true"
              class="refresh-btn"
            />
          </el-tooltip>
        </div>
      </div>
    </header>

    <!-- ========= 2. 统计区 ========= -->
    <section class="stats-section">
        <div class="stats-inner">
          <el-card
            v-for="stat in statsCards"
            :key="stat.label"
            class="stat-card"
            :class="stat.class"
            shadow="hover"
            @click="stat.onClick?.()"
          >
            <div class="stat-card-inner">
              <div class="stat-icon-wrap" :class="stat.iconClass">
                <el-icon :size="26"><component :is="stat.icon" /></el-icon>
              </div>
              <div class="stat-text">
                <div class="stat-number">{{ stat.value }}</div>
                <div class="stat-label">
                  {{ stat.label }}
                  <span v-if="stat.subtitle" class="stat-subtitle">{{ stat.subtitle }}</span>
                </div>
              </div>
            </div>
          </el-card>
        </div>
      </section>

    <!-- ========= 3. 工作流进度步进条 / 分割线 ========= -->
    <div class="workflow-section">
      <div v-if="workflowData.activeStep >= 0 && workflowData.steps.length > 0" class="workflow-steps-wrapper">
        <el-card shadow="hover" class="workflow-card">
          <div class="workflow-steps-simple">
            <template v-for="(step, idx) in workflowData.steps" :key="idx">
              <div class="workflow-step-simple-item" :class="{ 'is-active': idx === workflowData.activeStep }">
                <span class="simple-step-circle" :class="getSimpleStepClass(idx)"></span>
                <span class="simple-step-title">{{ step.title }}</span>
              </div>
              <div
                v-if="idx < workflowData.steps.length - 1"
                class="step-arrow-group"
                :class="getArrowState(idx)"
              >
                <el-icon class="step-arrow-chevron" :style="{ animationDelay: '0ms' }"><ArrowRight /></el-icon>
                <el-icon class="step-arrow-chevron" :style="{ animationDelay: '200ms' }"><ArrowRight /></el-icon>
                <el-icon class="step-arrow-chevron" :style="{ animationDelay: '400ms' }"><ArrowRight /></el-icon>
              </div>
            </template>
          </div>
        </el-card>
      </div>
      <div v-else class="workflow-divider-line" />
    </div>

    <!-- ========= 4. 看板主体（5列：空闲/运行中/已终止/错误/未知） ========= -->
    <main class="board-container">
      <!-- 空闲列 -->
      <div class="board-column board-column-idle">
        <div class="board-column-header" style="border-bottom-color: #f59e0b;">
          <span style="color: #f59e0b; font-weight: 700; font-size: 13px;">
            <el-icon><VideoPause /></el-icon>
            空闲
          </span>
          <el-tag size="small" style="background: rgba(245,158,11,0.15); color: #f59e0b; border-color: #f59e0b;">
            {{ store.idleAgents.length }} 个
          </el-tag>
        </div>
        <div class="board-column-tasks" v-loading="store.loading && store.agents.length === 0">
          <AgentCard
            v-for="agent in store.idleAgents"
            :key="agent.key"
            :agent="agent"
            :latest-messages="store.getAgentBubbles(agent.key)"
            @detail="onAgentDetail"
          />
          <el-empty v-if="store.idleAgents.length === 0 && !store.loading" description="暂无空闲的 Agent" :image-size="50" />
        </div>
      </div>

      <!-- 运行中列 -->
      <div class="board-column board-column-running">
        <div class="board-column-header" style="border-bottom-color: #3b82f6;">
          <span style="color: #3b82f6; font-weight: 700; font-size: 13px;">
            <el-icon><VideoPlay /></el-icon>
            运行中
          </span>
          <el-tag size="small" style="background: rgba(59,130,246,0.15); color: #3b82f6; border-color: #3b82f6;">
            {{ store.runningAgents.length }} 个
          </el-tag>
        </div>
        <div class="board-column-tasks">
          <AgentCard
            v-for="agent in store.runningAgents"
            :key="agent.key"
            :agent="agent"
            :latest-messages="store.getAgentBubbles(agent.key)"
            @detail="onAgentDetail"
          />
          <el-empty v-if="store.runningAgents.length === 0" description="暂无运行中的 Agent" :image-size="50" />
        </div>
      </div>

      <!-- 已终止列 -->
      <div class="board-column board-column-aborted">
        <div class="board-column-header" style="border-bottom-color: #6b7280;">
          <span style="color: #6b7280; font-weight: 700; font-size: 13px;">
            <el-icon><CircleClose /></el-icon>
            已终止
          </span>
          <el-tag size="small" style="background: rgba(107,114,128,0.15); color: #6b7280; border-color: #6b7280;">
            {{ store.abortedAgents.length }} 个
          </el-tag>
        </div>
        <div class="board-column-tasks">
          <AgentCard
            v-for="agent in store.abortedAgents"
            :key="agent.key"
            :agent="agent"
            :latest-messages="store.getAgentBubbles(agent.key)"
            @detail="onAgentDetail"
          />
          <el-empty v-if="store.abortedAgents.length === 0" description="暂无已终止的 Agent" :image-size="50" />
        </div>
      </div>

      <!-- 错误列 -->
      <div class="board-column board-column-error">
        <div class="board-column-header" style="border-bottom-color: #ef4444;">
          <span style="color: #ef4444; font-weight: 700; font-size: 13px;">
            <el-icon><CircleClose /></el-icon>
            错误
          </span>
          <el-tag size="small" style="background: rgba(239,68,68,0.15); color: #ef4444; border-color: #ef4444;">
            {{ store.errorAgents.length }} 个
          </el-tag>
        </div>
        <div class="board-column-tasks">
          <AgentCard
            v-for="agent in store.errorAgents"
            :key="agent.key"
            :agent="agent"
            :latest-messages="store.getAgentBubbles(agent.key)"
            @detail="onAgentDetail"
          />
          <el-empty v-if="store.errorAgents.length === 0" description="暂无错误的 Agent" :image-size="50" />
        </div>
      </div>

      <!-- 未知列 -->
      <div class="board-column board-column-unknown">
        <div class="board-column-header" style="border-bottom-color: #9ca3af;">
          <span style="color: #9ca3af; font-weight: 700; font-size: 13px;">
            <el-icon><QuestionFilled /></el-icon>
            未知
          </span>
          <el-tag size="small" style="background: rgba(156,163,175,0.15); color: #9ca3af; border-color: #9ca3af;">
            {{ store.unknownAgents.length }} 个
          </el-tag>
        </div>
        <div class="board-column-tasks">
          <AgentCard
            v-for="agent in store.unknownAgents"
            :key="agent.key"
            :agent="agent"
            :latest-messages="store.getAgentBubbles(agent.key)"
            @detail="onAgentDetail"
          />
          <el-empty v-if="store.unknownAgents.length === 0" description="暂无未知状态的 Agent" :image-size="50" />
        </div>
      </div>
    </main>

    <!-- Agent Detail Drawer -->
    <AgentDetailDrawer
      v-model:visible="drawerVisible"
      :agent-data="selectedAgent"
    />

    <!-- Token 消耗详情弹窗 -->
    <TokenDetailDialog v-model:visible="tokenDetailVisible" />

    <!-- Version Dialog (REC-068) -->
    <VersionDialog v-model:visible="versionDialogVisible" :current-version="store.gatewayVersion || ''" />

    <!-- Gateway Doctor Dialog (REC-003) -->
    <GatewayDoctorDialog
      v-model:visible="doctorDialogVisible"
      @refresh="refreshAll"
    />

    <!-- Skills Dialog (REC-005) -->
    <SkillsDialog v-model:visible="skillsDialogVisible" />

    <!-- REC-011: 加载超时提示 -->
    <el-alert
      v-if="loadingHintVisible"
      title="正在加载，请稍候..."
      type="info"
      :closable="false"
      show-icon
      class="loading-hint-alert"
      plain
    >
      <template #default>
        <span>数据加载中（已超过 10 秒），请耐心等待...</span>
      </template>
    </el-alert>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAgentStore, type AgentInfo } from '../stores/agent'
import AgentCard from '../components/AgentCard.vue'
import AgentDetailDrawer from '../components/AgentDetailDrawer.vue'
import TokenDetailDialog from '../components/TokenDetailDialog.vue'
import VersionDialog from '../components/VersionDialog.vue'
import GatewayDoctorDialog from '../components/GatewayDoctorDialog.vue'
import SkillsDialog from '../components/SkillsDialog.vue'
import { type WorkflowData } from '../data/workflow-steps'
import {
  Monitor,
  Collection,
  CircleCheck,
  Warning,
  Odometer,
  VideoPlay,
  VideoPause,
  CircleClose,
  Money,
  ArrowRight,
  QuestionFilled,
  Briefcase
} from '@element-plus/icons-vue'
import { el } from 'element-plus/es/locale/index.mjs'

// App version from package.json (injected by Vite define)
const APP_VERSION: string = __APP_VERSION__

const store = useAgentStore()

// Real-time clock in status bar (updates every minute)
const currentTime = ref('')
let clockTimer: ReturnType<typeof setInterval> | null = null

function updateClock(): void {
  const now = new Date()
  const Y = now.getFullYear()
  const M = String(now.getMonth() + 1).padStart(2, '0')
  const D = String(now.getDate()).padStart(2, '0')
  const h = String(now.getHours()).padStart(2, '0')
  const m = String(now.getMinutes()).padStart(2, '0')
  currentTime.value = `${Y}年${M}月${D}日 ${h}:${m}`
}

// Workflow steps data (REC-117: 从文件轮询获取)
const workflowData = ref<WorkflowData>({ activeStep: -1, steps: [] })
let workflowTimer: ReturnType<typeof setInterval> | null = null

async function fetchWorkflowData(): Promise<void> {
  try {
    const res = await fetch('/workflow-progress.json?t=' + Date.now())
    if (res.ok) {
      const data: WorkflowData = await res.json()
      workflowData.value = data
    }
  } catch {
    // 文件不存在或解析失败，保持当前值
  }
}

/** 根据步骤索引返回圆点状态 class (Element Plus Simple 风格) */
function getSimpleStepClass(idx: number): string {
  const active = workflowData.value.activeStep
  if (idx < active) return 'simple-step-finished'
  if (idx === active) return 'simple-step-process'
  return 'simple-step-waiting'
}

/** 根据步骤索引返回箭头组的状态 class */
function getArrowState(idx: number): string {
  const active = workflowData.value.activeStep
  if (idx < active) return 'arrow-finished'   // 已完成节点后的箭头
  if (idx === active) return 'arrow-process'  // 正在执行节点后的箭头
  return 'arrow-waiting'                      // 未完成节点后的箭头
}

// Drawer
const drawerVisible = ref(false)
const selectedAgent = ref<AgentInfo | null>(null)

// Token 详情弹窗
const tokenDetailVisible = ref(false)

// Version dialog
const versionDialogVisible = ref(false)

// Gateway Doctor dialog (REC-003)
const doctorDialogVisible = ref(false)

// Skills dialog (REC-005)
const skillsDialogVisible = ref(false)

// REC-011: 加载超时提示（加载超过 10s 时显示）
const loadingHintVisible = ref(false)
let loadingHintTimer: ReturnType<typeof setTimeout> | null = null
let loadingCheckTimer: ReturnType<typeof setInterval> | null = null

function checkLoadingHint(): void {
  if (store.loading) {
    if (!loadingHintVisible.value && !loadingHintTimer) {
      loadingHintTimer = setTimeout(() => {
        loadingHintVisible.value = true
        loadingHintTimer = null
      }, 10000)
    }
  } else {
    if (loadingHintTimer) {
      clearTimeout(loadingHintTimer)
      loadingHintTimer = null
    }
    loadingHintVisible.value = false
  }
}

// Stats cards
const statsCards = computed(() => [
  {
    label: '总计',
    value: store.totalAgents,
    icon: Odometer,
    iconClass: 'icon-blue',
    class: 'stat-total',
  },
  {
    label: '运行中',
    value: store.runningAgents.length,
    icon: VideoPlay,
    iconClass: 'icon-green',
    class: 'stat-running',
  },
  {
    label: '空闲',
    value: store.idleAgents.length,
    icon: VideoPause,
    iconClass: 'icon-yellow',
    class: 'stat-idle',
  },
  {
    label: '已终止',
    value: store.abortedAgents.length,
    icon: CircleClose,
    iconClass: 'icon-gray',
    class: 'stat-aborted',
  },
  {
    label: '错误',
    value: store.errorAgents.length,
    icon: CircleClose,
    iconClass: 'icon-red',
    class: 'stat-error',
  },
  {
    label: '本次运行时间',
    value: store.formatUptime(store.uptimeMs),
    icon: Monitor,
    iconClass: 'icon-purple',
    class: 'stat-uptime',
  },
  {
    label: '历史消耗Token',
    value: (store.totalTokensUsed || 0).toLocaleString(),
    subtitle: topModelSummary.value,
    icon: Odometer,
    iconClass: 'icon-orange',
    class: 'stat-tokens stat-clickable',
    onClick: () => { tokenDetailVisible.value = true },
  },
  {
    label: '本次运行费用',
    value: store.formatCost(store.totalCostCny),
    subtitle: '',
    icon: Money,
    iconClass: 'icon-green',
    class: 'stat-cost stat-clickable',
    onClick: () => { tokenDetailVisible.value = true },
  },
])

// Token 卡片的模型摘要（最多显示 2 个主要模型）
const topModelSummary = computed(() => {
  const byModel = store.globalUsage.byModel
  if (!byModel) return ''
  const sorted = Object.entries(byModel).sort((a, b) => b[1].tokens - a[1].tokens)
  const names: Record<string, string> = {
    'deepseek-v4-pro': 'DeepSeek', 'MiniMax-M2.7': 'MiniMax',
    'claude-sonnet-4-6': 'Claude', 'claude-sonnet-4-5': 'Claude',
  }
  return sorted.slice(0, 2).map(([m]) => names[m] || m.split('-')[0]).join(' · ')
})

// Health
const healthDisplay = computed(() => {
  switch (store.healthStatus) {
    case 'healthy': return '正常'
    case 'degraded': return '降级'
    case 'unhealthy': return '异常'
    case 'unknown': return '未知'
    default: return '检查中...'
  }
})
const healthClass = computed(() => {
  switch (store.healthStatus) {
    case 'healthy': return 'health-healthy'
    case 'degraded': return 'health-degraded'
    case 'unhealthy': return 'health-unhealthy'
    case 'unknown': return 'health-unknown'
    default: return 'health-unknown'
  }
})
const healthIcon = computed(() => {
  if (store.healthStatus === 'healthy') return CircleCheck
  if (store.healthStatus === 'degraded') return Warning
  return Warning
})

// Actions
function onAgentDetail(agent: AgentInfo): void {
  selectedAgent.value = agent
  drawerVisible.value = true
}

async function refreshAll(): Promise<void> {
  await Promise.all([store.fetchAgents(), store.fetchHealth()])
}

onMounted(() => {
  refreshAll()
  store.subscribeAgents()
  // Start real-time clock
  updateClock()
  clockTimer = setInterval(updateClock, 60 * 1000) // update every minute
  // REC-117: 工作流进度持久化 — 每 5 秒轮询
  fetchWorkflowData()
  workflowTimer = setInterval(fetchWorkflowData, 5000)
  // REC-011: 加载超时提示 — 每 1 秒检查
  checkLoadingHint()
  loadingCheckTimer = setInterval(checkLoadingHint, 1000)
})

onUnmounted(() => {
  if (clockTimer) {
    clearInterval(clockTimer)
    clockTimer = null
  }
  if (workflowTimer) {
    clearInterval(workflowTimer)
    workflowTimer = null
  }
  // REC-011: 清理加载提示定时器
  if (loadingHintTimer) {
    clearTimeout(loadingHintTimer)
    loadingHintTimer = null
  }
  if (loadingCheckTimer) {
    clearInterval(loadingCheckTimer)
    loadingCheckTimer = null
  }
})
</script>

<style scoped>
/* ==================== LAYOUT ==================== */
.dashboard {
  min-height: 100vh;
  background: var(--bg-primary);
  color: var(--text-primary);
}

/* ==================== STATUS BAR ==================== */
.status-bar {
  background: linear-gradient(135deg, #0f172a, #1e293b);
  border-bottom: 1px solid var(--border-color);
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow:0 2px 12px rgba(0, 0, 0, 0.15);
}

.status-bar-inner {
  max-width: 1440px;
  margin: 0 auto;
  padding: 10px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.brand-icon {
  color: var(--accent);
}

 .brand-title {
   color: var(--text-primary);
   font-size: 18px;
   font-weight: 700;
   margin: 0;
   background: linear-gradient(90deg, var(--accent), #42a5f5);
   -webkit-background-clip: text;
   -webkit-text-fill-color: transparent;
   background-clip: text;
   display: flex;
   align-items: baseline;
   gap: 6px;
 }

 .brand-version {
   font-size: 12px;
   font-weight: 400;
   color: var(--text-secondary);
   -webkit-text-fill-color: var(--text-secondary);
 }

 .brand-time {
   color: var(--text-secondary);
   font-size: 13px;
   font-variant-numeric: tabular-nums;
   margin-left: 12px;
   padding-left: 12px;
   border-left: 1px solid var(--border-color);
 }

.status-indicators {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 16px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  transition: all 0.3s;
  cursor: pointer;
}

.indicator:hover {
  border-color: var(--accent);
  box-shadow: 0 0 8px var(--accent-glow);
}

.indicator-label {
  color: var(--text-secondary);
}

.indicator-value {
  color: var(--text-primary);
  font-weight: 600;
}

.health-healthy { background: rgba(76, 175, 80, 0.15); color: #81c784; border-color: rgba(76,175,80,0.3) !important; }
.health-degraded { background: rgba(255, 152, 0, 0.15); color: #ffb74d; border-color: rgba(255,152,0,0.3) !important; }
.health-unhealthy { background: rgba(244, 67, 54, 0.15); color: #e57373; border-color: rgba(244,67,54,0.3) !important; }
.health-unknown { background: rgba(255, 193, 7, 0.15); color: #ffd54f; border-color: rgba(255,193,7,0.3) !important; }

.indicator-version {
  background: rgba(66, 165, 245, 0.15);
  border-color: rgba(66,165,245,0.3) !important;
}

.indicator-version .indicator-label {
  color: #64b5f6;
  font-weight: 600;
}

.indicator-version .indicator-value {
  color: #90caf9;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
}

.indicator-gpu {
  background: rgba(156, 39, 176, 0.15);
  border-color: rgba(156,39,176,0.3) !important;
}

.indicator-gpu .indicator-label {
  color: #ce93d8;
  font-weight: 600;
}

.indicator-gpu .indicator-value {
  color: #e1bee7;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
}

.refresh-btn {
  flex-shrink: 0;
}

.loading-hint-alert {
  position: fixed;
  top: 70px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2000;
  min-width: 280px;
  animation: loadingHintFadeIn 0.3s ease;
}

@keyframes loadingHintFadeIn {
  from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

/* ==================== STATS SECTION ==================== */
.stats-section {
  background: var(--bg-primary);
}

.stats-inner {
  max-width: 1440px;
  margin: 0 auto;
  padding: 16px 24px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}

.stat-card {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  transition: all 0.3s;
}

.stat-card:hover {
  border-color: var(--accent);
  box-shadow: 0 4px 16px var(--accent-glow);
  transform: translateY(-2px);
}

.stat-clickable {
  cursor: pointer;
}

.stat-clickable:hover {
  border-color: #f59e0b !important;
  box-shadow: 0 4px 16px rgba(245,158,11,0.2) !important;
}

.stat-subtitle {
  display: block;
  font-size: 10px;
  color: var(--text-secondary);
  margin-top: 1px;
  opacity: 0.8;
}

.stat-card :deep(.el-card__body) {
  padding: 12px 16px;
}

.stat-card-inner {
  display: flex;
  align-items: center;
  gap: 14px;
}

.stat-icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stat-text {
  display: flex;
  flex-direction: column;
}

.stat-number {
  font-size: 26px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  color: var(--text-primary);
}

.stat-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

 .icon-blue { background: rgba(66, 165, 245, 0.15); color: #42a5f5; }
 .icon-green { background: rgba(76, 175, 80, 0.15); color: #4caf50; }
 .icon-yellow { background: rgba(255, 193, 7, 0.15); color: #ffc107; }
 .icon-red { background: rgba(244, 67, 54, 0.15); color: #f44336; }
 .icon-gray { background: rgba(107, 114, 128, 0.15); color: #6b7280; }
 .icon-purple { background: rgba(139, 92, 246, 0.15); color: #8b5cf6; }
 .icon-orange { background: rgba(249, 115, 22, 0.15); color: #f97316; }

.stat-total { border-left: 3px solid #42a5f5; }
.stat-running { border-left: 3px solid #4caf50; }
.stat-idle { border-left: 3px solid #ffc107; }
.stat-error { border-left: 3px solid #f44336; }

/* ==================== WORKFLOW STEPS / DIVIDER ==================== */
.workflow-section {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 24px;
}

.workflow-steps-wrapper {
  padding: 8px 0;
}

.workflow-card {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  transition: all 0.3s;
}

.workflow-card:hover {
  border-color: var(--accent);
  box-shadow: 0 4px 16px var(--accent-glow);
}

.workflow-card :deep(.el-card__body) {
  padding: 8px 16px;
}

/* 自定义步进条布局 (模仿 Element Plus Simple) */
.workflow-steps-simple {
  display: flex;
  align-items: center;
  gap: 0;
}

.workflow-step-simple-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.workflow-step-simple-item.is-active .simple-step-title {
  color: var(--accent);
  font-weight: 600;
}

/* 圆点指示器 (Element Plus Simple 风格) */
.simple-step-circle {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
  transition: all 0.3s;
}

.simple-step-finished {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.simple-step-process {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  box-shadow: 0 0 8px var(--accent-glow);
}

.simple-step-waiting {
  background: transparent;
  border-color: var(--text-secondary);
  color: var(--text-secondary);
}

/* 步骤标题 */
.simple-step-title {
  font-size: 13px;
  color: var(--text-secondary);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  transition: color 0.3s;
}

.workflow-step-simple-item.is-active .simple-step-title,
.simple-step-finished + .simple-step-title {
  color: var(--accent);
}

/* ==================== 箭头分隔符 ==================== */
.step-arrow-group {
  display: flex;
  align-items: center;
  gap: 2px;
  margin: 0 8px;
  flex-shrink: 0;
}

.step-arrow-chevron {
  width: 12px;
  height: 12px;
  transition: color 0.3s, opacity 0.3s;
}

/* 已完成节点后的箭头 → 高亮，无动画 */
.step-arrow-group.arrow-finished .step-arrow-chevron {
  color: var(--accent);
  opacity: 1;
}

/* 正在执行节点后的箭头 → 波浪流水动画 */
.step-arrow-group.arrow-process .step-arrow-chevron {
  color: var(--accent);
  opacity: 0.5;
  animation: arrowWaveFlow 1s ease-in-out infinite;
}

/* 未完成节点后的箭头 → 灰色，无动画 */
.step-arrow-group.arrow-waiting .step-arrow-chevron {
  color: var(--text-secondary);
  opacity: 0.3;
}

@keyframes arrowWaveFlow {
  0%, 100% {
    opacity: 0.3;
    transform: translateX(0);
  }
  50% {
    opacity: 1;
    transform: translateX(4px);
  }
}

.workflow-divider-line {
  height: 1px;
  background: var(--border-color);
  border-radius: 1px;
}

/* ==================== BOARD LAYOUT ==================== */
.board-container {
  max-width: 1440px;
  margin: 0 auto;
  padding: 20px 24px;
  display: flex;
  gap: 14px;
  align-items: flex-start;
  overflow-x: auto;
  padding-bottom: 16px;
}

.board-column {
  flex: 1;
  min-width: 240px;
  max-width: 400px;
  background: #0f172a;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  overflow: visible;
  transition: border-color 0.2s;
}

.board-column:hover {
  border-color: #334155;
}

.board-column-header {
  padding: 14px 16px;
  border-bottom: 2px solid transparent;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 700;
  font-size: 13px;
}

.board-column-tasks {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ==================== VIEW TRANSITION ==================== */
.view-fade-enter-active,
.view-fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.view-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.view-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* ==================== RESPONSIVE ==================== */
@media (max-width: 1024px) {
  .stats-inner {
    grid-template-columns: repeat(2, 1fr);
  }

  .board-container {
    flex-direction: column;
  }

  .board-column {
    max-width: 100%;
  }
}

@media (max-width: 768px) {
  .status-bar-inner {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .status-indicators {
    width: 100%;
    flex-wrap: wrap;
    gap: 6px;
  }

  .stats-inner {
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    padding: 12px 16px;
  }

  .stat-number {
    font-size: 22px;
  }

  .stat-icon-wrap {
    width: 38px;
    height: 38px;
  }

  .board-container {
    padding: 14px;
  }
}

@media (max-width: 480px) {
  .brand-title {
    font-size: 16px;
  }

  .stats-inner {
    padding: 10px 12px;
  }
}
</style>

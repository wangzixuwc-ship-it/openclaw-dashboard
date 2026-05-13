<template>
  <div class="dashboard">
    <!-- ========= 1. 顶部状态栏 ========= -->
    <header class="status-bar">
      <div class="status-bar-inner">
        <div class="brand">
          <el-icon :size="24" class="brand-icon"><Monitor /></el-icon>
          <h1 class="brand-title">OpenClaw 监控台</h1>
          <span class="brand-time">{{ currentTime }}</span>
        </div>

        <div class="status-indicators">
          <!-- Gateway Version -->
          <div class="indicator indicator-version">
            <span class="indicator-label">OpenClaw</span>
            <span class="indicator-value">{{ store.gatewayVersion || '未知' }}</span>
          </div>

          <!-- Gateway Health -->
          <div class="indicator" :class="healthClass">
            <el-icon :size="14"><component :is="healthIcon" /></el-icon>
            <span class="indicator-label">网关</span>
            <span class="indicator-value">{{ healthDisplay }}</span>
          </div>

          <!-- GPU VRAM Usage (REC-091) -->
          <el-tooltip
            v-if="store.gpuVramPercentage !== null && store.gpuVramPercentage !== undefined"
            :content="`${store.gpuVramUsedMb} / ${store.gpuVramTotalMb} MB`"
            placement="bottom"
          >
            <div class="indicator indicator-gpu">
              <el-icon :size="14"><Monitor /></el-icon>
              <span class="indicator-label">显存</span>
              <span class="indicator-value">{{ store.gpuVramPercentage }}%</span>
            </div>
          </el-tooltip>

          <!-- Refresh Button -->
          <el-button
            :icon="Refresh"
            circle
            size="small"
            @click="refreshAll"
            :loading="store.loading"
            class="refresh-btn"
          />
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
        >
          <div class="stat-card-inner">
            <div class="stat-icon-wrap" :class="stat.iconClass">
              <el-icon :size="26"><component :is="stat.icon" /></el-icon>
            </div>
            <div class="stat-text">
              <div class="stat-number">{{ stat.value }}</div>
              <div class="stat-label">{{ stat.label }}</div>
            </div>
          </div>
        </el-card>
      </div>
    </section>

    <!-- ========= 3. 看板主体（5列：空闲/运行中/已终止/错误/未知） ========= -->
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAgentStore, type AgentInfo } from '../stores/agent'
import AgentCard from '../components/AgentCard.vue'
import AgentDetailDrawer from '../components/AgentDetailDrawer.vue'
import {
  Monitor,
  Refresh,
  CircleCheck,
  Warning,
  Odometer,
  VideoPlay,
  VideoPause,
  CircleClose,
  Money,
} from '@element-plus/icons-vue'

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

// Drawer
const drawerVisible = ref(false)
const selectedAgent = ref<AgentInfo | null>(null)

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
    icon: Odometer,
    iconClass: 'icon-orange',
    class: 'stat-tokens',
  },
  {
    label: '本次运行费用',
    value: store.formatCost(store.totalCostCny),
    icon: Money,
    iconClass: 'icon-green',
    class: 'stat-cost',
  },
])

// Health
const healthDisplay = computed(() => {
  switch (store.healthStatus) {
    case 'healthy': return '正常'
    case 'unhealthy': return '异常'
    case 'unknown': return '未知'
    default: return '检查中...'
  }
})
const healthClass = computed(() => {
  switch (store.healthStatus) {
    case 'healthy': return 'health-healthy'
    case 'unhealthy': return 'health-unhealthy'
    case 'unknown': return 'health-unknown'
    default: return 'health-unknown'
  }
})
const healthIcon = computed(() => {
  return store.healthStatus === 'healthy' ? CircleCheck : Warning
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
})

onUnmounted(() => {
  if (clockTimer) {
    clearInterval(clockTimer)
    clockTimer = null
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
  font-size: 11px;
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
  font-size: 11px;
}

.refresh-btn {
  flex-shrink: 0;
}

/* ==================== STATS SECTION ==================== */
.stats-section {
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-color);
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

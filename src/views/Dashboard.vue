<template>
  <div class="dashboard">
    <!-- ========= 1. 顶部状态栏 ========= -->
    <header class="status-bar">
      <div class="status-bar-inner">
        <div class="brand">
          <el-icon :size="24" class="brand-icon"><Monitor /></el-icon>
          <h1 class="brand-title">OpenClaw 控制台</h1>
        </div>

        <div class="status-indicators">
          <!-- Gateway Health -->
          <div class="indicator" :class="healthClass">
            <el-icon :size="14"><component :is="healthIcon" /></el-icon>
            <span class="indicator-label">网关</span>
            <span class="indicator-value">{{ healthDisplay }}</span>
          </div>

          <!-- WebSocket Connection -->
          <div class="indicator" :class="wsClass">
            <el-icon :size="14"><Connection /></el-icon>
            <span class="indicator-label">实时连接</span>
            <span class="indicator-value">{{ wsDisplay }}</span>
          </div>

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
          v-for="(stat, i) in statsCards"
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

    <!-- ========= 3. 看板主体（3列：运行中/空闲/错误） ========= -->
    <main class="board-container">
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
        <div class="board-column-tasks" v-loading="store.loading && store.agents.length === 0">
          <AgentCard
            v-for="agent in store.runningAgents"
            :key="agent.key"
            :agent="agent"
            @detail="onAgentDetail"
          />
          <el-empty v-if="store.runningAgents.length === 0 && !store.loading" description="暂无运行中的 Agent" :image-size="50" />
        </div>
      </div>

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
        <div class="board-column-tasks">
          <AgentCard
            v-for="agent in store.idleAgents"
            :key="agent.key"
            :agent="agent"
            @detail="onAgentDetail"
          />
          <el-empty v-if="store.idleAgents.length === 0" description="暂无空闲的 Agent" :image-size="50" />
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
    </main>

    <!-- Agent Detail Drawer -->
    <AgentDetailDrawer
      v-model:visible="drawerVisible"
      :agent-data="selectedAgent"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAgentStore, type AgentInfo } from '../stores/agent'
import AgentCard from '../components/AgentCard.vue'
import AgentDetailDrawer from '../components/AgentDetailDrawer.vue'
import {
  Monitor,
  Connection,
  Refresh,
  CircleCheck,
  Warning,
  Odometer,
  VideoPlay,
  VideoPause,
  CircleClose,
} from '@element-plus/icons-vue'

const store = useAgentStore()

// Drawer
const drawerVisible = ref(false)
const selectedAgent = ref<AgentInfo | null>(null)

// Stats cards
const statsCards = computed(() => [
  {
    label: '总计',
    value: store.agentCount,
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
    label: '错误',
    value: store.errorAgents.length,
    icon: CircleClose,
    iconClass: 'icon-red',
    class: 'stat-error',
  },
])

// Health
const healthDisplay = computed(() => {
  switch (store.healthStatus) {
    case 'healthy': return '正常'
    case 'unhealthy': return '异常'
    default: return '检查中...'
  }
})
const healthClass = computed(() => {
  switch (store.healthStatus) {
    case 'healthy': return 'health-healthy'
    case 'unhealthy': return 'health-unhealthy'
    default: return 'health-unknown'
  }
})
const healthIcon = computed(() => {
  return store.healthStatus === 'healthy' ? CircleCheck : Warning
})

// WS — real connection status from WebSocket
const wsDisplay = computed(() => {
  if (store.wsConnected) return '实时连接'
  return '已断开'
})
const wsClass = computed(() => {
  if (store.wsConnected) return 'ws-connected'
  return 'ws-disconnected'
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
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
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

.ws-connected { background: rgba(76, 175, 80, 0.15); color: #81c784; border-color: rgba(76,175,80,0.3) !important; }
.ws-reconnecting { background: rgba(255, 152, 0, 0.15); color: #ffb74d; border-color: rgba(255,152,0,0.3) !important; }
.ws-disconnected { background: rgba(158, 158, 158, 0.15); color: #bdbdbd; border-color: rgba(158,158,158,0.3) !important; }

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
  overflow: hidden;
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
  max-height: calc(100vh - 320px);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #334155 transparent;
}

.board-column-tasks::-webkit-scrollbar {
  width: 4px;
}

.board-column-tasks::-webkit-scrollbar-thumb {
  background: #334155;
  border-radius: 2px;
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

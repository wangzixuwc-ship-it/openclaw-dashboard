<template>
  <div class="dashboard">
    <!-- Top Status Bar -->
    <header class="status-bar">
      <div class="status-bar-inner">
        <div class="brand">
          <el-icon :size="24" class="brand-icon"><Monitor /></el-icon>
          <h1 class="brand-title">OpenClaw 控制台</h1>
        </div>

        <div class="status-indicators">
          <!-- Gateway Health -->
          <div class="indicator" :class="healthClass">
            <el-icon :size="16"><component :is="healthIcon" /></el-icon>
            <span class="indicator-label">网关状态</span>
            <span class="indicator-value">{{ healthDisplay }}</span>
          </div>

          <!-- WebSocket Connection -->
          <div class="indicator" :class="wsClass">
            <el-icon :size="16"><Connection /></el-icon>
            <span class="indicator-label">连接状态</span>
            <span class="indicator-value">{{ wsDisplay }}</span>
          </div>

          <!-- Reconnect Warning -->
          <el-alert
            v-if="wsReconnecting"
            type="warning"
            :closable="false"
            show-icon
            class="reconnect-alert"
          >
            <template #default>
              正在重连...（第 {{ wsReconnectAttempt }}/{{ wsMaxRetries }} 次尝试）
            </template>
          </el-alert>

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

    <!-- Stats Cards -->
    <section class="stats-section">
      <div class="stats-inner">
        <div class="stat-card" :class="'stat-' + i" v-for="(stat, i) in statsCards" :key="stat.label">
          <div class="stat-icon" :class="stat.iconClass">
            <el-icon :size="24"><component :is="stat.icon" /></el-icon>
          </div>
          <div class="stat-content">
            <div class="stat-value">{{ stat.value }}</div>
            <div class="stat-label">{{ stat.label }}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- Main Content -->
    <main class="main-content">
      <!-- Sidebar: Search + Filters -->
      <aside class="sidebar">
        <el-card class="filter-card" shadow="never">
          <template #header>
            <div class="filter-header">
              <el-icon><Filter /></el-icon>
              <span>筛选</span>
            </div>
          </template>

          <!-- Search -->
          <div class="search-section">
            <el-input
              v-model="searchText"
              placeholder="搜索 Agent..."
              :prefix-icon="Search"
              clearable
              maxlength="100"
              @input="onSearch"
              class="search-input"
            />
          </div>

          <!-- Status Filter -->
          <div class="filter-section">
            <span class="filter-label">状态</span>
            <div class="filter-buttons">
              <el-button
                size="small"
                :type="store.filterStatus === 'all' ? 'primary' : 'default'"
                plain
                @click="setFilter('all')"
                class="filter-btn"
              >
                全部
              </el-button>
              <el-button
                size="small"
                :type="store.filterStatus === 'running' ? 'success' : 'default'"
                plain
                @click="setFilter('running')"
                class="filter-btn"
              >
                <span class="dot dot-running"></span>
                运行中
              </el-button>
              <el-button
                size="small"
                :type="store.filterStatus === 'idle' ? 'warning' : 'default'"
                plain
                @click="setFilter('idle')"
                class="filter-btn"
              >
                <span class="dot dot-idle"></span>
                空闲
              </el-button>
              <el-button
                size="small"
                :type="store.filterStatus === 'error' ? 'danger' : 'default'"
                plain
                @click="setFilter('error')"
                class="filter-btn"
              >
                <span class="dot dot-error"></span>
                错误
              </el-button>
            </div>
          </div>

          <!-- Results count -->
          <div class="results-info">
            <el-icon><List /></el-icon>
            <span>{{ store.filteredAgents.length }} / {{ store.agents.length }} 个 Agent</span>
          </div>
        </el-card>
      </aside>

      <!-- Agent Cards Grid -->
      <section class="agents-section">
        <div class="agents-toolbar">
          <h2 class="agents-title">
            <el-icon><UserFilled /></el-icon>
            全部 Agent
            <span class="count-badge">{{ store.filteredAgents.length }}</span>
          </h2>
        </div>

        <!-- Loading state -->
        <div v-if="store.loading && store.agents.length === 0" class="loading-initial">
          <el-icon class="is-loading" :size="32"><Loading /></el-icon>
          <p>正在加载 Agent 列表...</p>
        </div>

        <!-- Empty state -->
        <el-empty
          v-else-if="store.filteredAgents.length === 0 && !store.loading"
          :description="store.agents.length === 0 ? '暂无 Agent 连接' : '没有匹配的 Agent'"
          class="empty-state"
        >
          <el-button type="primary" @click="refreshAll" v-if="store.agents.length > 0">
            <el-icon><Refresh /></el-icon>
            刷新
          </el-button>
        </el-empty>

        <!-- Agent Grid -->
        <TransitionGroup name="card-list" v-else>
          <div
            class="card-grid"
            :class="gridClass"
          >
            <AgentCard
              v-for="agent in store.filteredAgents"
              :key="agent.key"
              :agent="agent"
              @detail="onAgentDetail"
            />
          </div>
        </TransitionGroup>
      </section>
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
import { useAgentStore, type FilterStatus, type AgentInfo } from '../stores/agent'
import AgentCard from '../components/AgentCard.vue'
import AgentDetailDrawer from '../components/AgentDetailDrawer.vue'
import {
  Monitor,
  Connection,
  Refresh,
  Search,
  Filter,
  UserFilled,
  Loading,
  List,
  CircleCheck,
  Warning,
  Odometer,
  VideoPlay,
  VideoPause,
  CircleClose,
} from '@element-plus/icons-vue'
import { useGatewayWebSocket } from '../api/websocket'

const store = useAgentStore()

// Drawer state
const drawerVisible = ref(false)
const selectedAgent = ref<AgentInfo | null>(null)

// Search
const searchText = ref('')

// WS reconnect state
const wsReconnecting = ref(false)
const wsReconnectAttempt = ref(0)
const wsMaxRetries = ref(10)

// Stats cards
const statsCards = computed(() => [
  {
    label: '总数',
    value: store.agentCount,
    icon: Odometer,
    iconClass: 'icon-blue',
  },
  {
    label: '运行中',
    value: store.runningAgents.length,
    icon: VideoPlay,
    iconClass: 'icon-green',
  },
  {
    label: '空闲',
    value: store.idleAgents.length,
    icon: VideoPause,
    iconClass: 'icon-yellow',
  },
  {
    label: '错误',
    value: store.errorAgents.length,
    icon: CircleClose,
    iconClass: 'icon-red',
  },
])

// Health display
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

// WS display
const wsDisplay = computed(() => {
  if (store.wsConnected) return '已连接'
  if (wsReconnecting.value) return '重连中...'
  return '已断开'
})

const wsClass = computed(() => {
  if (store.wsConnected) return 'ws-connected'
  if (wsReconnecting.value) return 'ws-reconnecting'
  return 'ws-disconnected'
})

// Responsive grid
const gridClass = computed(() => {
  return 'grid-responsive'
})

// Actions

/**
 * Sanitize search input: trim, limit length, strip control chars
 */
function sanitizeInput(raw: string): string {
  return raw
    .slice(0, 100)
    .replace(/[^\u0000-\u007F\p{L}\p{N}\s\-_.]/gu, '')
}

function onSearch(val: string): void {
  store.setSearchQuery(sanitizeInput(val))
}

function setFilter(status: FilterStatus): void {
  store.setFilterStatus(status)
}

function onAgentDetail(agent: AgentInfo): void {
  selectedAgent.value = agent
  drawerVisible.value = true
}

async function refreshAll(): Promise<void> {
  await Promise.all([store.fetchAgents(), store.fetchHealth()])
}

// Setup WebSocket reconnect tracking
function setupWsTracking(): void {
  const ws = useGatewayWebSocket()

  ws.onReconnect((attempt, max) => {
    wsReconnecting.value = true
    wsReconnectAttempt.value = attempt
    wsMaxRetries.value = max
  })

  ws.onOpen(() => {
    wsReconnecting.value = false
    wsReconnectAttempt.value = 0
  })

  ws.onClose(() => {
    if (!wsReconnecting.value) {
      wsReconnecting.value = true
    }
  })
}

// Lifecycle
onMounted(() => {
  refreshAll()
  store.subscribeAgents()
  setupWsTracking()
})
</script>

<style scoped>
/* ==================== STATUS BAR ==================== */
.status-bar {
  background: linear-gradient(135deg, #0f172a, #1e293b) !important;
  border-bottom: 1px solid var(--border-color);
  padding: 0;
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
}

.status-bar-inner {
  max-width: 1400px;
  margin: 0 auto;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
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
  gap: 16px;
}

.indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 13px;
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

/* Pulse animation for health/WS indicators */
.indicator {
  animation: indicator-pulse 3s ease-in-out infinite;
}

@keyframes indicator-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.85; }
}

.health-healthy { background: rgba(76, 175, 80, 0.2); color: #81c784; }
.health-unhealthy { background: rgba(244, 67, 54, 0.2); color: #e57373; }
.health-unknown { background: rgba(255, 193, 7, 0.2); color: #ffd54f; }

.ws-connected { background: rgba(76, 175, 80, 0.2); color: #81c784; }
.ws-reconnecting { background: rgba(255, 152, 0, 0.2); color: #ffb74d; }
.ws-disconnected { background: rgba(158, 158, 158, 0.2); color: #bdbdbd; }

.reconnect-alert {
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 4px;
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
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px 24px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  border-radius: 12px;
  background: var(--bg-card);
  transition: all 0.3s;
  border: 1px solid var(--border-color);
}

.stat-card:hover {
  border-color: var(--accent);
  box-shadow: 0 0 20px var(--accent-glow);
}

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  color: var(--text-primary);
}

.stat-label {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.icon-blue { background: rgba(66, 165, 245, 0.15); color: #42a5f5; }
.icon-green { background: rgba(76, 175, 80, 0.15); color: #4caf50; }
.icon-yellow { background: rgba(255, 193, 7, 0.15); color: #ffc107; }
.icon-red { background: rgba(244, 67, 54, 0.15); color: #f44336; }

/* ==================== MAIN CONTENT ==================== */
.main-content {
  max-width: 1400px;
  margin: 0 auto;
  padding: 24px;
  display: flex;
  gap: 24px;
}

/* ==================== SIDEBAR ==================== */
.sidebar {
  width: 260px;
  flex-shrink: 0;
  position: sticky;
  top: 80px;
  align-self: flex-start;
}

.filter-card {
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
}

.filter-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.search-section {
  margin-bottom: 16px;
}

.search-input :deep(.el-input__wrapper) {
  border-radius: 8px;
}

.filter-section {
  margin-bottom: 16px;
}

.filter-label {
  font-size: 12px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
  display: block;
}

.filter-buttons {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.filter-btn {
  width: 100%;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
}

.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.dot-running { background: var(--el-color-success); }
.dot-idle { background: var(--el-color-warning); }
.dot-error { background: var(--el-color-danger); }

.results-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
}

/* ==================== AGENTS SECTION ==================== */
.agents-section {
  flex: 1;
  min-width: 0;
}

.agents-toolbar {
  margin-bottom: 16px;
}

.agents-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary);
}

.count-badge {
  font-size: 13px;
  font-weight: normal;
  color: var(--text-secondary);
}

.loading-initial {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 60px 20px;
  color: var(--text-secondary);
}

.empty-state {
  padding: 40px 20px;
}

/* Card Grid */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

/* ==================== TRANSITIONS ==================== */
.card-list-enter-active {
  transition: all 0.3s ease;
}

.card-list-leave-active {
  transition: all 0.2s ease;
}

.card-list-enter-from {
  opacity: 0;
  transform: translateY(20px);
}

.card-list-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

/* ==================== RESPONSIVE ==================== */
@media (max-width: 1024px) {
  .stats-inner {
    grid-template-columns: repeat(2, 1fr);
  }

  .main-content {
    flex-direction: column;
  }

  .sidebar {
    width: 100%;
    position: static;
  }

  .filter-buttons {
    flex-direction: row;
    flex-wrap: wrap;
  }

  .filter-btn {
    width: auto;
  }
}

@media (max-width: 768px) {
  .status-bar-inner {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .status-indicators {
    width: 100%;
    flex-wrap: wrap;
    gap: 8px;
  }

  .stats-inner {
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }

  .stat-card {
    padding: 12px 14px;
  }

  .stat-value {
    font-size: 22px;
  }

  .stat-icon {
    width: 40px;
    height: 40px;
  }

  .card-grid {
    grid-template-columns: 1fr;
  }

  .main-content {
    padding: 16px;
  }
}

@media (max-width: 480px) {
  .stats-inner {
    grid-template-columns: 1fr 1fr;
    padding: 12px;
  }

  .brand-title {
    font-size: 16px;
  }
}
</style>

<template>
  <el-card
    class="agent-card"
    shadow="hover"
    @click="openDrawer"
  >
    <!-- Header: Name + Status Badge -->
    <div class="card-header">
      <div class="agent-identity">
        <div class="agent-avatar" :class="statusColorClass">
          <el-icon :size="18"><component :is="avatarIcon" /></el-icon>
        </div>
        <span class="agent-name" :title="agent.name">{{ agent.name }}</span>
      </div>
      <el-tag
        :type="statusTagType"
        :effect="agent.status === 'running' ? 'dark' : 'light'"
        size="small"
        class="status-badge"
      >
        <el-icon :size="12"><component :is="statusIcon" /></el-icon>
        {{ displayStatus }}
      </el-tag>
    </div>

    <!-- Body: Metadata + Token -->
    <div class="card-body">
      <div class="meta-grid">
        <div class="meta-item">
          <span class="meta-label">当前任务</span>
          <span class="meta-value key-value" :title="agent.label || agent.key">{{ truncateLabel }}</span>
        </div>

        <div class="meta-item">
          <span class="meta-label">持续时间</span>
          <span class="meta-value duration">{{ durationText }}</span>
        </div>
      </div>

      <!-- Token Usage Progress Bar -->
      <div class="token-section" v-if="agent.tokenUsage">
        <div class="token-header">
          <span class="meta-label">Token 用量</span>
          <span class="token-percent" :class="percentageClass">{{ tokenPercent }}%</span>
        </div>
        <el-progress
          :percentage="agent.tokenUsage.percentage"
          :status="tokenProgressStatus"
          :stroke-width="6"
          :show-text="false"
          class="token-progress"
        />
        <div class="token-detail">
          <span>{{ agent.tokenUsage.current.toLocaleString() }}</span>
          <span class="token-sep">/</span>
          <span>{{ agent.tokenUsage.max.toLocaleString() }}</span>
        </div>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AgentInfo } from '../stores/agent'
import { useAgentStore } from '../stores/agent'
import {
  UserFilled,
  CircleCheckFilled,
  Clock,
  WarningFilled,
  CircleCloseFilled,
  Timer,
  Avatar,
} from '@element-plus/icons-vue'

const props = defineProps<{
  agent: AgentInfo
}>()

const emit = defineEmits<{
  (e: 'detail', agent: AgentInfo): void
}>()

const store = useAgentStore()
const refreshing = ref(false)

const statusTagType = computed(() => {
  switch (props.agent.status) {
    case 'running': return 'success'
    case 'idle': return 'warning'
    case 'error': return 'danger'
    case 'aborted': return 'info'
    default: return 'info'
  }
})

const statusColorClass = computed(() => {
  switch (props.agent.status) {
    case 'running': return 'status-running'
    case 'idle': return 'status-idle'
    case 'error': return 'status-error'
    case 'aborted': return 'status-aborted'
    default: return 'status-unknown'
  }
})

const statusIcon = computed(() => {
  switch (props.agent.status) {
    case 'running': return CircleCheckFilled
    case 'idle': return Clock
    case 'error': return WarningFilled
    case 'aborted': return CircleCloseFilled
    default: return Clock
  }
})

const displayStatus = computed(() => {
  const map: Record<string, string> = {
    running: '运行中',
    idle: '空闲',
    error: '错误',
    aborted: '已终止',
    unknown: '未知',
  }
  return map[props.agent.status] ?? props.agent.status
})

const durationText = computed(() => {
  return store.formatDuration(props.agent.elapsedMs)
})

const tokenPercent = computed(() => {
  return props.agent.tokenUsage?.percentage ?? 0
})

const tokenProgressStatus = computed(() => {
  const p = props.agent.tokenUsage?.percentage ?? 0
  if (p >= 90) return 'exception'
  if (p >= 70) return 'warning'
  return 'success'
})

const percentageClass = computed(() => {
  const p = props.agent.tokenUsage?.percentage ?? 0
  if (p >= 90) return 'text-danger'
  if (p >= 70) return 'text-warning'
  return 'text-success'
})

const truncateLabel = computed(() => {
  const label = props.agent.label || props.agent.key
  return label.length > 24 ? label.slice(0, 24) + '…' : label
})

const isCronSession = computed(() => {
  return props.agent.key.includes(':cron:')
})

const isSpecialAgent = computed(() => {
  return props.agent.name === '副总' || props.agent.name === '执行秘书'
})

const avatarIcon = computed(() => {
  if (isCronSession.value) return Timer
  if (isSpecialAgent.value) return Avatar
  return UserFilled
})

function openDrawer(): void {
  emit('detail', props.agent)
}

async function refreshAgent(): Promise<void> {
  refreshing.value = true
  try {
    await store.fetchAgentStatus(props.agent.key)
  } finally {
    setTimeout(() => { refreshing.value = false }, 500)
  }
}
</script>

<style scoped>
.agent-card {
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
}

.agent-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 6px 20px var(--accent-glow);
  border-color: var(--accent);
}

.agent-card :deep(.el-card__body) {
  padding: 14px;
}

/* --- Header --- */
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.agent-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.agent-avatar {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.agent-name {
  font-weight: 600;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.status-badge {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 3px;
  border-radius: 6px;
  padding: 0 8px;
}

/* --- Body --- */
.card-body {
  font-size: 13px;
}

.meta-grid {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.meta-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 3px 0;
}

.meta-label {
  color: var(--text-secondary);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  flex-shrink: 0;
}

.meta-value {
  color: var(--text-primary);
  font-size: 12px;
  text-align: right;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.key-value {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 11px;
}

.duration {
  font-variant-numeric: tabular-nums;
}

/* --- Token Section --- */
.token-section {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border-color);
}

.token-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.token-percent {
  font-weight: 600;
  font-size: 13px;
}

.token-progress {
  margin-bottom: 2px;
}

.token-detail {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.token-sep {
  color: var(--text-secondary);
  opacity: 0.5;
}

/* --- Footer --- */
.card-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
}

.action-btn {
  padding: 6px 14px !important;
  border-radius: 6px !important;
  font-size: 12px !important;
  font-weight: 500 !important;
  transition: all 0.2s !important;
  border: 1px solid transparent !important;
}

/* 刷新按钮 - 中性色 */
.action-btn:first-child,
.action-btn:first-child:hover,
.action-btn:first-child:focus {
  color: var(--text-secondary) !important;
  background: rgba(255, 255, 255, 0.05) !important;
  border-color: var(--border-color) !important;
}
.action-btn:first-child:hover {
  color: var(--text-primary) !important;
  background: rgba(255, 255, 255, 0.1) !important;
  border-color: var(--accent) !important;
}

/* 详情按钮 - 强调色（覆盖 Element Plus type="primary"） */
.action-btn.el-button--primary,
.action-btn.el-button--primary:hover,
.action-btn.el-button--primary:focus {
  color: #fff !important;
  background: var(--accent) !important;
  border-color: var(--accent) !important;
}
.action-btn.el-button--primary:hover {
  background: var(--accent-hover) !important;
  box-shadow: 0 2px 8px var(--accent-glow) !important;
}

/* --- Status Colors --- */
.status-running { background: rgba(76, 175, 80, 0.15); color: #4caf50; }
.status-idle { background: rgba(255, 193, 7, 0.15); color: #ffc107; }
.status-error { background: rgba(244, 67, 54, 0.15); color: #f44336; }
.status-aborted { background: rgba(107, 114, 128, 0.15); color: #6b7280; }
.status-unknown { background: rgba(156, 163, 175, 0.15); color: #9ca3af; }

/* --- Text Colors --- */
.text-success { color: #4caf50; font-weight: 600; }
.text-warning { color: #ffc107; font-weight: 600; }
.text-danger { color: #f44336; font-weight: 600; }
.text-info { color: #9e9e9e; font-weight: 600; }
</style>

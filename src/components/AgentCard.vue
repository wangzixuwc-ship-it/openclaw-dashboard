<template>
  <el-card
    class="agent-card"
    shadow="hover"
    @click="openDrawer"
  >
    <!-- Header: Name + Status -->
    <div class="card-header">
      <div class="agent-identity">
        <el-icon :size="22" :class="statusColorClass"><UserFilled /></el-icon>
        <span class="agent-name" :title="agent.name">{{ agent.name }}</span>
      </div>
      <el-tag
        :type="statusTagType"
        :effect="agent.status === 'running' ? 'dark' : 'light'"
        size="small"
        class="status-badge"
      >
        <el-icon><component :is="statusIcon" /></el-icon>
        {{ displayStatus }}
      </el-tag>
    </div>

    <!-- Body: Key + Duration -->
    <div class="card-body">
      <div class="meta-row">
        <span class="meta-label">会话 ID</span>
        <span class="meta-value key-value" :title="agent.key">{{ agent.key }}</span>
      </div>

      <div class="meta-row" v-if="agent.model">
        <span class="meta-label">模型</span>
        <span class="meta-value">{{ agent.model }}</span>
      </div>

      <div class="meta-row">
        <span class="meta-label">运行时长</span>
        <span class="meta-value duration">{{ formattedDuration }}</span>
      </div>

      <!-- Token Usage Progress -->
      <div class="token-section" v-if="agent.tokenUsage">
        <div class="token-header">
          <span class="meta-label">Token 用量</span>
          <span class="token-text">{{ tokenDisplay }}</span>
        </div>
        <el-progress
          :percentage="agent.tokenUsage.percentage"
          :status="tokenProgressStatus"
          :stroke-width="8"
          :show-text="false"
        />
        <div class="token-bar-labels">
          <span>{{ agent.tokenUsage.current.toLocaleString() }}</span>
          <span>/</span>
          <span>{{ agent.tokenUsage.max.toLocaleString() }}</span>
        </div>
      </div>
    </div>

    <!-- Footer: Actions -->
    <div class="card-footer">
      <el-button
        size="small"
        text
        @click.stop="refreshAgent"
        :loading="refreshing"
      >
        <el-icon><Refresh /></el-icon>
        刷新
      </el-button>
      <el-button
        size="small"
        text
        type="primary"
        @click.stop="openDrawer"
      >
        <el-icon><View /></el-icon>
        详情
      </el-button>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AgentInfo } from '../stores/agent'
import { useAgentStore } from '../stores/agent'
import {
  UserFilled,
  Refresh,
  View,
  CircleCheckFilled,
  Clock,
  WarningFilled,
  CircleCloseFilled,
  QuestionFilled,
} from '@element-plus/icons-vue'

const props = defineProps<{
  agent: AgentInfo
}>()

const emit = defineEmits<{
  (e: 'detail', agent: AgentInfo): void
}>()

const store = useAgentStore()
const refreshing = ref(false)

// Computed helpers
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
    default: return QuestionFilled
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

const formattedDuration = computed(() => {
  return store.formatDuration(props.agent.elapsedMs)
})

const tokenDisplay = computed(() => {
  const u = props.agent.tokenUsage
  if (!u) return ''
  return `${u.percentage}%`
})

const tokenProgressStatus = computed(() => {
  const p = props.agent.tokenUsage?.percentage ?? 0
  if (p >= 90) return 'exception'
  if (p >= 70) return 'warning'
  return 'success'
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
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
}

.agent-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px var(--accent-glow);
  border-color: var(--accent);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.agent-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.agent-name {
  font-weight: 600;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.status-badge {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.card-body {
  font-size: 13px;
}

.meta-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
}

.meta-label {
  color: var(--text-secondary);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.meta-value {
  color: var(--text-primary);
  font-size: 13px;
  text-align: right;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.key-value {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 12px;
}

.duration {
  font-variant-numeric: tabular-nums;
}

.token-section {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border-color);
}

.token-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.token-text {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-primary);
}

.token-bar-labels {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.card-footer {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border-color);
}

/* Status colors for icons */
.status-running { color: var(--el-color-success); }
.status-idle { color: var(--el-color-warning); }
.status-error { color: var(--el-color-danger); }
.status-aborted { color: var(--el-color-info); }
.status-unknown { color: var(--el-text-color-secondary); }
</style>

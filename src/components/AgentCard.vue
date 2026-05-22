<template>
  <el-popover
    v-if="latestMessage"
    :key="latestMessage"
    placement="right"
    width="400px"
    :offset="12"
    trigger="manual"
    :visible="bubbleVisible"
    class="bubble-popover"
  >
    <div class="markdown-body markdown-bubble" :style="{ maxHeight: '160px', overflowY: 'auto' }" v-html="renderedMessage"></div>

    <template #reference>
      <el-card
        ref="cardRef"
        class="agent-card"
        shadow="hover"
        @click="openDrawer"
      >
        <!-- Header: Name + Status Badge -->
        <div class="card-header">
          <div class="agent-identity">
            <div class="agent-avatar" :class="statusColorClass">
              <!-- 优先显示图片头像，失败则降级到 emoji，再降级到图标 -->
              <img
                v-if="avatarSrc"
                :src="avatarSrc"
                :alt="displayName"
                class="avatar-img"
                @error="onAvatarError"
              />
              <span v-else-if="agent.emoji" class="avatar-emoji">{{ agent.emoji }}</span>
              <el-icon v-else :size="18"><component :is="avatarIcon" /></el-icon>
            </div>
            <span class="agent-name" :title="displayName">{{ displayName }}</span>
          </div>
          <el-tag
            :type="statusTagType"
            :effect="agent.status === 'running' ? 'dark' : 'light'"
            size="small"
            class="status-badge"
            :title="statusDescription"
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

            <div class="meta-item" v-if="historicalTokens > 0">
              <span class="meta-label">历史 Token</span>
              <span class="meta-value hist-token">{{ formatHistoricalTokens(historicalTokens) }}</span>
            </div>

            <div class="meta-item" v-if="agent.model">
              <span class="meta-label">模型</span>
              <span class="meta-value model-tag" :title="agent.model">{{ shortModelName }}</span>
            </div>
          </div>

          <!-- Token Usage Progress Bar -->
          <div class="token-section" v-if="agent.tokenUsage">
            <div class="token-header">
              <span class="meta-label">上下文用量</span>
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
  </el-popover>

   <!-- 没有气泡时直接渲染卡片 -->
  <el-card
    v-else
    ref="cardRef"
    class="agent-card"
    shadow="hover"
    @click="openDrawer"
  >
    <!-- Header: Name + Status Badge -->
    <div class="card-header">
      <div class="agent-identity">
        <div class="agent-avatar" :class="statusColorClass">
          <img
            v-if="avatarSrc"
            :src="avatarSrc"
            :alt="displayName"
            class="avatar-img"
            @error="onAvatarError"
          />
          <span v-else-if="agent.emoji" class="avatar-emoji">{{ agent.emoji }}</span>
          <el-icon v-else :size="18"><component :is="avatarIcon" /></el-icon>
        </div>
        <span class="agent-name" :title="displayName">{{ displayName }}</span>
      </div>
      <el-tag
        :type="statusTagType"
        :effect="agent.status === 'running' ? 'dark' : 'light'"
        size="small"
        class="status-badge"
        :title="statusDescription"
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

        <!-- 历史 Token 用量 -->
        <div class="meta-item" v-if="historicalTokens > 0">
          <span class="meta-label">历史 Token</span>
          <span class="meta-value hist-token">{{ formatHistoricalTokens(historicalTokens) }}</span>
        </div>

        <!-- 使用模型 -->
        <div class="meta-item" v-if="agent.model">
          <span class="meta-label">模型</span>
          <span class="meta-value model-tag" :title="agent.model">{{ shortModelName }}</span>
        </div>
      </div>

      <!-- Token Usage Progress Bar (当前 session) -->
      <div class="token-section" v-if="agent.tokenUsage">
        <div class="token-header">
          <span class="meta-label">上下文用量</span>
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
import { computed, ref, watch } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
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
  latestMessage?: string
}>()

const emit = defineEmits<{
  (e: 'detail', agent: AgentInfo): void
}>()

const store = useAgentStore()

// ========== 头像 ==========
// 从 agent key 提取 agentId（如 agent:main:xxx → main）
const agentId = computed(() => {
  const parts = (props.agent.key || '').split(':')
  return (parts[0] === 'agent' && parts.length >= 2) ? parts[1] : parts[0]
})

// 优先级：.env VITE_AGENT_{ID}_AVATAR > public/avatars/{id}.jpg
const envAvatar = computed(() => {
  const idUpper = agentId.value.replace(/-/g, '_').toUpperCase()
  const envKey = `VITE_AGENT_${idUpper}_AVATAR`
  return (import.meta.env as Record<string, string>)[envKey] || ''
})

const avatarLoadFailed = ref(false)

const avatarSrc = computed(() => {
  if (avatarLoadFailed.value) return ''
  if (envAvatar.value) return envAvatar.value
  return `/avatars/${agentId.value}.jpg`
})

function onAvatarError() {
  avatarLoadFailed.value = true
}

// ========== 历史 Token ==========
const historicalTokens = computed(() => {
  return props.agent.historicalTokens || store.getAgentHistoricalTokens(agentId.value)
})

function formatHistoricalTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K'
  return n.toString()
}

// ========== 模型简称 ==========
const MODEL_SHORT: Record<string, string> = {
  'deepseek-v4-pro': 'DeepSeek V4',
  'deepseek-v3': 'DeepSeek V3',
  'MiniMax-M2.7': 'MiniMax',
  'claude-sonnet-4-6': 'Claude Sonnet',
  'claude-sonnet-4-5': 'Claude Sonnet',
  'claude-opus-4': 'Claude Opus',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
}
const shortModelName = computed(() => {
  const m = props.agent.model || ''
  return MODEL_SHORT[m] || m.split('/').pop() || m
})

const renderedMessage = computed(() => {
  if (!props.latestMessage) return ''
  const html = marked.parse(props.latestMessage) as string
  return DOMPurify.sanitize(html)
})

// el-popover 可见性控制
// REC-080: 完全依赖 store 的 messageBubbles 状态（BUBBLE_DURATION = 10s）
const bubbleVisible = ref(!!props.latestMessage)
const cardRef = ref<HTMLElement>()

watch(() => props.latestMessage, (newVal) => {
  bubbleVisible.value = !!newVal
}, { immediate: true })

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

const statusDescription = computed(() => {
  const descriptions: Record<string, string> = {
    running: 'Agent 正在执行任务',
    idle: 'Agent 处于空闲状态',
    error: 'Agent 发生错误',
    aborted: 'Agent 已被终止',
    unknown: 'Agent 状态未知',
  }
  return descriptions[props.agent.status] || props.agent.status
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

const displayName = computed(() => {
  if (isCronSession.value) return '巡检员'
  return props.agent.name
})

const avatarIcon = computed(() => {
  if (isCronSession.value) return Timer
  if (isSpecialAgent.value) return Avatar
  return UserFilled
})

function openDrawer(): void {
  emit('detail', props.agent)
}
</script>

<style scoped>
/* ==================== Card ==================== */
.agent-card {
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
  border-radius: 10px;
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

/* ==================== Header ==================== */
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

/* ==================== Body ==================== */
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

/* ==================== Token ==================== */
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

/* ==================== Status Colors ==================== */
.status-running { background: rgba(76, 175, 80, 0.15); color: #4caf50; }
.status-idle { background: rgba(255, 193, 7, 0.15); color: #ffc107; }
.status-error { background: rgba(244, 67, 54, 0.15); color: #f44336; }
.status-aborted { background: rgba(107, 114, 128, 0.15); color: #6b7280; }
.status-unknown { background: rgba(156, 163, 175, 0.15); color: #9ca3af; }

.text-success { color: #4caf50; font-weight: 600; }
.text-warning { color: #ffc107; font-weight: 600; }
.text-danger { color: #f44336; font-weight: 600; }
.text-info { color: #9e9e9e; font-weight: 600; }

</style>

<!-- ════════════════════════════════════════════════
     非 scoped 样式：el-popover 使用 Teleport 渲染到 body 层，
     scoped 样式无法穿透，必须放在非 scoped 块中
     ════════════════════════════════════════════════ -->
<style>
/* ==================== REC-071: 气泡弹出框 ==================== */
.el-popover.bubble-popover {
  background: linear-gradient(135deg, rgba(26, 26, 46, 0.95), rgba(18, 18, 36, 0.98)) !important;
  border: 1px solid rgba(66, 165, 245, 0.35) !important;
  border-radius: 10px !important;
  box-shadow:
    0 4px 16px rgba(33, 150, 243, 0.2),
    0 2px 8px rgba(0, 0, 0, 0.4) !important;
  padding: 10px 14px !important;
  min-width: 0 !important;
  max-width: none !important;
}

/* ==================== REC-081: 气泡动画 ==================== */
@keyframes bubbleSlideIn {
  from {
    opacity: 0;
    transform: translateX(20px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
}

@keyframes bubbleFadeOut {
  from {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
  to {
    opacity: 0;
    transform: translateX(-10px) scale(0.95);
  }
}

.bubble-popover {
  animation: bubbleSlideIn 0.3s ease-out;
}

.markdown-bubble {
  animation: bubbleSlideIn 0.3s ease-out;
}

.avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 6px;
  object-fit: cover;
}

.avatar-emoji {
  font-size: 16px;
  line-height: 1;
}

.hist-token {
  font-variant-numeric: tabular-nums;
  color: #f59e0b;
  font-weight: 500;
}

.model-tag {
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
  padding: 1px 5px;
}
</style>

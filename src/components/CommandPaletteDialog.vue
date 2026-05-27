<template>
  <teleport to="body">
    <transition name="palette-fade">
      <div v-if="modelValue" class="palette-backdrop" @mousedown.self="close">
        <div class="palette-panel" @keydown="onKeydown">
          <!-- Search input -->
          <div class="palette-input-wrap">
            <el-icon class="palette-icon"><Search /></el-icon>
            <input
              ref="inputRef"
              v-model="query"
              class="palette-input"
              placeholder="搜索 agent、历史消息、功能..."
              @input="onInput"
            />
            <span v-if="loading" class="palette-spinner" />
            <kbd class="palette-esc" @click="close">esc</kbd>
          </div>

          <!-- Results -->
          <div class="palette-results" ref="resultsRef">
            <!-- Empty state -->
            <div v-if="!query && allItems.length === 0" class="palette-empty">
              <div class="palette-hint-grid">
                <div v-for="act in ACTIONS" :key="act.key" class="palette-hint-item" @click="selectAction(act)">
                  <span class="palette-hint-icon">{{ act.icon }}</span>
                  <span class="palette-hint-label">{{ act.label }}</span>
                </div>
              </div>
              <div class="palette-hint-tip">快捷键 ↑↓ 导航 · Enter 确认 · Esc 关闭</div>
            </div>

            <!-- Query results -->
            <template v-if="query">
              <!-- Actions section -->
              <div v-if="matchedActions.length" class="palette-section">
                <div class="palette-section-title">功能</div>
                <div
                  v-for="(act, i) in matchedActions"
                  :key="act.key"
                  class="palette-item"
                  :class="{ active: flatIndex(0, i) === activeIdx }"
                  @click="selectAction(act)"
                  @mouseenter="activeIdx = flatIndex(0, i)"
                >
                  <span class="palette-item-icon">{{ act.icon }}</span>
                  <div class="palette-item-text">
                    <span class="palette-item-label">{{ act.label }}</span>
                    <span class="palette-item-desc">{{ act.desc }}</span>
                  </div>
                  <el-icon class="palette-item-arrow"><ArrowRight /></el-icon>
                </div>
              </div>

              <!-- Agents section -->
              <div v-if="agentResults.length" class="palette-section">
                <div class="palette-section-title">Agent</div>
                <div
                  v-for="(ag, i) in agentResults"
                  :key="ag.id"
                  class="palette-item"
                  :class="{ active: flatIndex(matchedActions.length, i) === activeIdx }"
                  @click="selectAgent(ag)"
                  @mouseenter="activeIdx = flatIndex(matchedActions.length, i)"
                >
                  <span class="palette-item-icon">{{ ag.emoji || '🤖' }}</span>
                  <div class="palette-item-text">
                    <span class="palette-item-label">{{ ag.name }}</span>
                    <span class="palette-item-desc">{{ ag.model }}</span>
                  </div>
                  <el-icon class="palette-item-arrow"><ArrowRight /></el-icon>
                </div>
              </div>

              <!-- Messages section -->
              <div v-if="messageResults.length" class="palette-section">
                <div class="palette-section-title">历史消息</div>
                <div
                  v-for="(msg, i) in messageResults"
                  :key="`${msg.session_id}-${i}`"
                  class="palette-item palette-msg-item"
                  :class="{ active: flatIndex(matchedActions.length + agentResults.length, i) === activeIdx }"
                  @click="selectMessage(msg)"
                  @mouseenter="activeIdx = flatIndex(matchedActions.length + agentResults.length, i)"
                >
                  <span class="palette-item-icon">{{ agentEmoji(msg.agent_id) }}</span>
                  <div class="palette-item-text">
                    <span class="palette-item-label">{{ agentDisplayName(msg.agent_id) }}</span>
                    <span class="palette-item-snippet" v-html="msg.snippet" />
                  </div>
                  <span class="palette-item-ts">{{ formatTs(msg.timestamp) }}</span>
                </div>
              </div>

              <!-- No results -->
              <div v-if="!loading && query && allItems.length === 0" class="palette-no-result">
                <el-icon><Search /></el-icon>
                <span>没有找到 "{{ query }}"</span>
                <div class="palette-no-result-hint">建议先构建搜索索引 →
                  <span class="palette-link" @click="buildIndex">立即建索引</span>
                </div>
              </div>
            </template>
          </div>

          <!-- Footer -->
          <div class="palette-footer">
            <span v-if="indexStatus.totalMessages > 0">已索引 {{ indexStatus.totalMessages.toLocaleString() }} 条消息</span>
            <span v-else class="palette-footer-warn">
              ⚠ 索引为空
              <span class="palette-link" @click="buildIndex">{{ indexing ? '建索引中...' : '点击建索引' }}</span>
            </span>
            <span class="palette-footer-right">{{ indexStatus.lastIndexedAt ? '更新于 ' + formatTs(indexStatus.lastIndexedAt) : '' }}</span>
          </div>
        </div>
      </div>
    </transition>
  </teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { Search, ArrowRight } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [val: boolean]
  'open-action': [key: string]
  'navigate-agent': [agentId: string]
}>()

const ACTIONS = [
  { key: 'projects',    icon: '📋', label: '项目看板',    desc: '5列 Kanban 跟踪项目进度' },
  { key: 'cron',        icon: '⏰', label: '定时任务',    desc: 'Cron 任务中心' },
  { key: 'timeline',   icon: '📈', label: '活动时间线',  desc: '查看 Agent 活动 Gantt 图' },
  { key: 'fileManager',icon: '📁', label: '文件管理',    desc: '浏览和编辑工作区文件' },
  { key: 'billing',    icon: '💰', label: '计费配置',    desc: '设置模型计费率' },
  { key: 'skills',     icon: '🧰', label: '技能库',      desc: '查看所有 Agent 技能' },
  { key: 'gpu',        icon: '🎮', label: 'GPU 显存',    desc: '查看 GPU 显存占用' },
  { key: 'token',      icon: '📊', label: '费用概览',    desc: '查看 Token 消耗与费用' },
]

const query = ref('')
const activeIdx = ref(0)
const loading = ref(false)
const indexing = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)
const resultsRef = ref<HTMLElement | null>(null)

const agentResults = ref<any[]>([])
const messageResults = ref<any[]>([])

const indexStatus = ref({ totalMessages: 0, totalFiles: 0, lastIndexedAt: null as string | null })

const matchedActions = computed(() => {
  if (!query.value) return []
  const q = query.value.toLowerCase()
  return ACTIONS.filter(a => a.label.includes(q) || a.desc.includes(q) || a.key.includes(q))
})

const allItems = computed(() => [
  ...matchedActions.value,
  ...agentResults.value,
  ...messageResults.value,
])

function flatIndex(sectionOffset: number, i: number) {
  return sectionOffset + i
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null

function onInput() {
  activeIdx.value = 0
  agentResults.value = []
  messageResults.value = []
  if (debounceTimer) clearTimeout(debounceTimer)
  if (!query.value.trim()) return
  debounceTimer = setTimeout(doSearch, 300)
}

async function doSearch() {
  if (!query.value.trim()) return
  loading.value = true
  try {
    const resp = await fetch(`/api/search?q=${encodeURIComponent(query.value)}&limit=10`)
    if (resp.ok) {
      const data = await resp.json()
      agentResults.value = data.results?.agents || []
      messageResults.value = data.results?.messages || []
    }
  } catch { /* network error */ } finally {
    loading.value = false
  }
}

async function fetchIndexStatus() {
  try {
    const resp = await fetch('/api/search/status')
    if (resp.ok) indexStatus.value = await resp.json()
  } catch { /* ignore */ }
}

async function buildIndex() {
  if (indexing.value) return
  indexing.value = true
  try {
    const resp = await fetch('/api/search/index', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    if (resp.ok) {
      const data = await resp.json()
      ElMessage.success(`索引完成：${data.totalInDb?.toLocaleString()} 条消息`)
      await fetchIndexStatus()
      if (query.value) doSearch()
    }
  } catch { ElMessage.error('索引失败') } finally {
    indexing.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  const total = allItems.value.length
  if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx.value = (activeIdx.value + 1) % Math.max(total, 1); scrollActive() }
  else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx.value = (activeIdx.value - 1 + Math.max(total, 1)) % Math.max(total, 1); scrollActive() }
  else if (e.key === 'Enter') { e.preventDefault(); activateItem() }
  else if (e.key === 'Escape') { close() }
}

function scrollActive() {
  nextTick(() => {
    const el = resultsRef.value?.querySelector('.palette-item.active')
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function activateItem() {
  const ai = activeIdx.value
  const aLen = matchedActions.value.length
  const agLen = agentResults.value.length
  if (ai < aLen) selectAction(matchedActions.value[ai])
  else if (ai < aLen + agLen) selectAgent(agentResults.value[ai - aLen])
  else selectMessage(messageResults.value[ai - aLen - agLen])
}

function selectAction(act: typeof ACTIONS[0]) {
  close()
  emit('open-action', act.key)
}

function selectAgent(ag: any) {
  close()
  emit('navigate-agent', ag.id)
}

function selectMessage(msg: any) {
  close()
  emit('navigate-agent', msg.agent_id)
}

function close() {
  emit('update:modelValue', false)
}

// Agent name/emoji from config (cached after first load)
const agentMeta = ref<Record<string, { name: string; emoji: string }>>({})
async function loadAgentMeta() {
  try {
    const resp = await fetch('/api/agents-configured')
    if (resp.ok) {
      const data = await resp.json()
      for (const a of (data.agents || [])) {
        agentMeta.value[a.id] = { name: a.name || a.id, emoji: a.emoji || '🤖' }
      }
    }
  } catch { /* ignore */ }
}

function agentDisplayName(id: string) {
  return agentMeta.value[id]?.name || id
}
function agentEmoji(id: string) {
  return agentMeta.value[id]?.emoji || '🤖'
}

function formatTs(ts: string | null) {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
    return `${d.getMonth() + 1}/${d.getDate()}`
  } catch { return '' }
}

watch(() => props.modelValue, async (val) => {
  if (val) {
    query.value = ''
    agentResults.value = []
    messageResults.value = []
    activeIdx.value = 0
    await fetchIndexStatus()
    await loadAgentMeta()
    nextTick(() => inputRef.value?.focus())
  }
})

onMounted(loadAgentMeta)
</script>

<style scoped>
.palette-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
}

.palette-panel {
  width: 640px;
  max-width: 92vw;
  background: #1a1a2e;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  box-shadow: 0 32px 80px rgba(0, 0, 0, 0.7);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 70vh;
}

.palette-input-wrap {
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  gap: 10px;
  flex-shrink: 0;
}

.palette-icon {
  color: rgba(255, 255, 255, 0.35);
  font-size: 18px;
  flex-shrink: 0;
}

.palette-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: #fff;
  font-size: 16px;
  padding: 16px 0;
  font-family: inherit;
}

.palette-input::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.palette-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.palette-esc {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 11px;
  padding: 2px 6px;
  cursor: pointer;
  flex-shrink: 0;
}

.palette-results {
  overflow-y: auto;
  flex: 1;
}

.palette-section {
  padding: 8px 0 4px;
}

.palette-section-title {
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 4px 16px;
}

.palette-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  cursor: pointer;
  transition: background 0.1s;
  border-radius: 0;
}

.palette-item:hover,
.palette-item.active {
  background: rgba(99, 102, 241, 0.18);
}

.palette-item-icon {
  font-size: 18px;
  width: 28px;
  text-align: center;
  flex-shrink: 0;
}

.palette-item-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.palette-item-label {
  color: #fff;
  font-size: 14px;
  font-weight: 500;
}

.palette-item-desc {
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
}

.palette-item-snippet {
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.palette-item-snippet :deep(mark) {
  background: transparent;
  color: #f59e0b;
  font-weight: 600;
}

.palette-item-arrow {
  color: rgba(255, 255, 255, 0.2);
  font-size: 14px;
  flex-shrink: 0;
}

.palette-item-ts {
  color: rgba(255, 255, 255, 0.3);
  font-size: 11px;
  flex-shrink: 0;
}

.palette-msg-item .palette-item-icon {
  font-size: 15px;
}

.palette-empty {
  padding: 20px 16px 16px;
}

.palette-hint-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 16px;
}

.palette-hint-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
}

.palette-hint-item:hover {
  background: rgba(99, 102, 241, 0.15);
  border-color: rgba(99, 102, 241, 0.4);
}

.palette-hint-icon {
  font-size: 22px;
}

.palette-hint-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  text-align: center;
}

.palette-hint-tip {
  text-align: center;
  color: rgba(255, 255, 255, 0.2);
  font-size: 12px;
}

.palette-no-result {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 16px;
  color: rgba(255, 255, 255, 0.3);
  font-size: 14px;
}

.palette-no-result .el-icon {
  font-size: 32px;
  opacity: 0.3;
}

.palette-no-result-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.25);
}

.palette-link {
  color: #6366f1;
  cursor: pointer;
  text-decoration: underline;
}

.palette-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 11px;
  color: rgba(255, 255, 255, 0.25);
  flex-shrink: 0;
}

.palette-footer-warn {
  color: #f59e0b;
  opacity: 0.8;
}

.palette-footer-right {
  color: rgba(255, 255, 255, 0.2);
}

/* Transition */
.palette-fade-enter-active,
.palette-fade-leave-active {
  transition: opacity 0.15s ease;
}
.palette-fade-enter-active .palette-panel,
.palette-fade-leave-active .palette-panel {
  transition: transform 0.15s ease, opacity 0.15s ease;
}
.palette-fade-enter-from,
.palette-fade-leave-to {
  opacity: 0;
}
.palette-fade-enter-from .palette-panel,
.palette-fade-leave-to .palette-panel {
  transform: translateY(-12px);
  opacity: 0;
}
</style>

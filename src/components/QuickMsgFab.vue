<template>
  <!-- ⚡ FAB（Floating Action Button 浮动操作按钮）— 快捷发消息 -->
  <div class="qmf-wrap">
    <!-- 悬浮触发按钮 -->
    <button
      class="qmf-trigger"
      :class="{ open: panelVisible }"
      @click="togglePanel"
      title="快捷发消息（⌘⇧M）"
    >
      <span class="qmf-icon">⚡</span>
      <span class="qmf-label">快发</span>
    </button>

    <!-- 面板（Teleport 挂载到 body，避免 overflow hidden 截断）-->
    <Teleport to="body">
      <Transition name="qm-slide">
        <div v-if="panelVisible" class="qmf-panel-wrap" @keydown.esc="close">
          <!-- 遮罩层（点击关闭）-->
          <div class="qmf-backdrop" @click="close" />

          <!-- 主面板 -->
          <div class="qmf-panel" @click.stop>
            <!-- 标题栏 -->
            <div class="qmf-header">
              <span class="qmf-title">⚡ 快捷发消息</span>
              <button class="qmf-close" @click="close">✕</button>
            </div>

            <!-- Agent 选择区 -->
            <div class="qmf-section-label">发送给</div>
            <div class="qmf-agents">
              <button
                v-for="ag in agentList"
                :key="ag.id"
                class="qmf-agent-btn"
                :class="{ selected: selectedId === ag.id }"
                @click="selectAgent(ag.id)"
              >
                <span class="qmf-agent-emoji">{{ ag.emoji || '🤖' }}</span>
                <span class="qmf-agent-name">{{ ag.name }}</span>
              </button>
            </div>

            <!-- 快捷模板按钮区 -->
            <template v-if="templates.length">
              <div class="qmf-section-label">快捷模板（点击填入）</div>
              <div class="qmf-templates">
                <button
                  v-for="(tpl, i) in templates"
                  :key="i"
                  class="qmf-tpl-btn"
                  :class="{ active: message === tpl }"
                  @click="fillTemplate(tpl)"
                >
                  {{ tpl }}
                </button>
              </div>
            </template>

            <!-- 消息输入框 -->
            <div class="qmf-section-label">消息内容</div>
            <textarea
              ref="inputRef"
              v-model="message"
              class="qmf-textarea"
              placeholder="输入要发送的消息内容..."
              rows="3"
              @keydown.meta.enter.prevent="send"
              @keydown.ctrl.enter.prevent="send"
            />
            <div class="qmf-hint">⌘↵ 快速发送</div>

            <!-- 底部操作区 -->
            <div class="qmf-footer">
              <span class="qmf-target" v-if="selectedAgent">
                → {{ selectedAgent.emoji || '🤖' }} {{ selectedAgent.name }}
              </span>
              <span class="qmf-target empty" v-else>← 请先选择 Agent</span>
              <button
                class="qmf-send-btn"
                :class="{ loading: sending }"
                :disabled="!canSend"
                @click="send"
              >
                {{ sending ? '发送中…' : '发送 ⚡' }}
              </button>
            </div>

            <!-- 发送结果提示 -->
            <Transition name="qm-result">
              <div v-if="resultMsg" class="qmf-result" :class="resultType">
                {{ resultMsg }}
              </div>
            </Transition>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useAgentStore } from '../stores/agent'

// ─── 类型定义 ────────────────────────────────────────────────────────────────
interface AgentItem {
  id: string
  name: string
  emoji: string
}

// ─── Store ───────────────────────────────────────────────────────────────────
const store = useAgentStore()

// ─── 状态 ─────────────────────────────────────────────────────────────────────
const panelVisible = ref(false)
const selectedId = ref('pm')
const message = ref('')
const sending = ref(false)
const resultMsg = ref('')
const resultType = ref<'success' | 'error'>('success')
const inputRef = ref<HTMLTextAreaElement | null>(null)

// ─── Agent 列表（从 store 读取，含 emoji）────────────────────────────────────
// 固定排序：main 在最后（通常不需要直接发给 main）
const AGENT_ORDER = ['pm', 'developer', 'tester', 'inspector', 'archivist', 'main']

const agentList = computed<AgentItem[]>(() => {
  const fromStore = store.agents.map(a => {
    const parts = (a.key || '').split(':')
    return {
      id: parts[1] || a.key || '',
      name: a.name || a.displayName || a.key || '',
      emoji: a.emoji || '',
    }
  }).filter(a => a.id && AGENT_ORDER.includes(a.id))

  // 按固定顺序排列
  fromStore.sort((a, b) => {
    const ia = AGENT_ORDER.indexOf(a.id)
    const ib = AGENT_ORDER.indexOf(b.id)
    return ia - ib
  })

  // 若 store 尚未加载，使用内置默认列表
  if (fromStore.length === 0) {
    return [
      { id: 'pm',         name: '项目经理',   emoji: '👩‍💼' },
      { id: 'developer',  name: '开发工程师',  emoji: '👨‍💻' },
      { id: 'tester',     name: '测试工程师',  emoji: '🧪' },
      { id: 'inspector',  name: '巡检员',      emoji: '🔍' },
      { id: 'archivist',  name: '档案员',      emoji: '📚' },
      { id: 'main',       name: '主控',        emoji: '🤖' },
    ]
  }
  return fromStore
})

const selectedAgent = computed(() =>
  agentList.value.find(a => a.id === selectedId.value) ?? null
)

// ─── 快捷模板（按 Agent 区分）────────────────────────────────────────────────
const TEMPLATES: Record<string, string[]> = {
  pm:        ['请汇报当前项目状态', '请评估团队工作负载', '有新需求待分配，请准备'],
  developer: ['请汇报开发进度', '请检查代码并修复问题', '请实现刚分配的任务'],
  tester:    ['请汇报测试状态', '请对最新代码进行测试', '测试完成请提交报告'],
  inspector: ['巡检时间到', '请立即扫描项目异常状态', '有项目疑似卡住，请排查'],
  archivist: ['请检查待归档项目', '请执行每日归档任务', '请整理本周完成项目'],
  main:      ['请查看并处理待办', '请汇报整体状态', '需要你的协助，请回复'],
}

const templates = computed<string[]>(() =>
  TEMPLATES[selectedId.value] || []
)

const canSend = computed(() =>
  !!message.value.trim() && !!selectedId.value && !sending.value
)

// ─── 方法 ─────────────────────────────────────────────────────────────────────
function togglePanel(): void {
  panelVisible.value = !panelVisible.value
}

function close(): void {
  panelVisible.value = false
}

function selectAgent(id: string): void {
  selectedId.value = id
  // 切换 agent 时清空模板选中（不清空消息，方便编辑后换目标发）
  nextTick(() => inputRef.value?.focus())
}

function fillTemplate(tpl: string): void {
  message.value = tpl
  nextTick(() => inputRef.value?.focus())
}

async function send(): Promise<void> {
  if (!canSend.value) return
  sending.value = true
  resultMsg.value = ''
  try {
    const resp = await fetch('/api/agent-send-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: selectedId.value, message: message.value.trim() }),
    })
    const data = await resp.json()
    if (resp.ok && data.success) {
      resultType.value = 'success'
      resultMsg.value = `✓ 已发送给 ${selectedAgent.value?.name || selectedId.value}`
      message.value = ''
      // 2.5 秒后自动关闭面板
      setTimeout(close, 2500)
    } else {
      resultType.value = 'error'
      resultMsg.value = `✗ 发送失败：${data.error || '未知错误'}`
    }
  } catch (e: any) {
    resultType.value = 'error'
    resultMsg.value = `✗ 请求失败：${e.message}`
  } finally {
    sending.value = false
    // 3 秒后清除提示
    setTimeout(() => { resultMsg.value = '' }, 3000)
  }
}

// ─── 全局键盘快捷键 ⌘⇧M ────────────────────────────────────────────────────
function onKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
    e.preventDefault()
    panelVisible.value = !panelVisible.value
  }
}

onMounted(() => { document.addEventListener('keydown', onKeydown) })
onUnmounted(() => { document.removeEventListener('keydown', onKeydown) })

// 面板打开时聚焦输入框
watch(panelVisible, (v) => {
  if (v) nextTick(() => inputRef.value?.focus())
})
</script>

<style scoped>
/* ─── FAB 触发按钮 ──────────────────────────────────────────────────────────── */
.qmf-wrap {
  position: fixed;
  bottom: 28px;
  right: 28px;
  z-index: 1200;
}

.qmf-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 18px;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #fff;
  border: none;
  border-radius: 24px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  box-shadow: 0 4px 14px rgba(245, 158, 11, 0.45);
  transition: transform 0.15s, box-shadow 0.15s, background 0.15s;
  outline: none;
}

.qmf-trigger:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(245, 158, 11, 0.55);
}

.qmf-trigger.open {
  background: linear-gradient(135deg, #d97706, #b45309);
  transform: scale(0.96);
}

.qmf-icon {
  font-size: 16px;
  line-height: 1;
}

.qmf-label {
  letter-spacing: 0.5px;
}

/* ─── 遮罩 + 面板布局 ───────────────────────────────────────────────────────── */
.qmf-panel-wrap {
  position: fixed;
  inset: 0;
  z-index: 2000;
  pointer-events: none;
}

.qmf-backdrop {
  position: absolute;
  inset: 0;
  pointer-events: all;
}

.qmf-panel {
  position: absolute;
  bottom: 80px;
  right: 28px;
  width: 380px;
  background: #1a2035;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  pointer-events: all;
}

/* ─── 标题栏 ─────────────────────────────────────────────────────────────────── */
.qmf-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.qmf-title {
  font-size: 15px;
  font-weight: 700;
  color: #f1f5f9;
}

.qmf-close {
  background: none;
  border: none;
  color: #64748b;
  cursor: pointer;
  font-size: 16px;
  padding: 2px 6px;
  border-radius: 4px;
  line-height: 1;
  transition: color 0.15s;
}

.qmf-close:hover {
  color: #f1f5f9;
}

/* ─── 区块标题 ───────────────────────────────────────────────────────────────── */
.qmf-section-label {
  font-size: 11px;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  font-weight: 600;
}

/* ─── Agent 选择区 ───────────────────────────────────────────────────────────── */
.qmf-agents {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.qmf-agent-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 11px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  cursor: pointer;
  color: #94a3b8;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.15s;
  outline: none;
}

.qmf-agent-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #e2e8f0;
}

.qmf-agent-btn.selected {
  background: rgba(245, 158, 11, 0.15);
  border-color: rgba(245, 158, 11, 0.5);
  color: #f59e0b;
}

.qmf-agent-emoji {
  font-size: 14px;
}

/* ─── 快捷模板区 ─────────────────────────────────────────────────────────────── */
.qmf-templates {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.qmf-tpl-btn {
  text-align: left;
  padding: 6px 11px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 7px;
  cursor: pointer;
  color: #94a3b8;
  font-size: 12px;
  transition: all 0.15s;
  outline: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qmf-tpl-btn:hover {
  background: rgba(99, 102, 241, 0.12);
  border-color: rgba(99, 102, 241, 0.3);
  color: #c4b5fd;
}

.qmf-tpl-btn.active {
  background: rgba(99, 102, 241, 0.18);
  border-color: rgba(99, 102, 241, 0.4);
  color: #a5b4fc;
}

/* ─── 消息输入框 ─────────────────────────────────────────────────────────────── */
.qmf-textarea {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #e2e8f0;
  font-size: 13px;
  padding: 10px 12px;
  resize: vertical;
  outline: none;
  font-family: inherit;
  box-sizing: border-box;
  transition: border-color 0.15s;
  line-height: 1.6;
}

.qmf-textarea::placeholder {
  color: #475569;
}

.qmf-textarea:focus {
  border-color: rgba(245, 158, 11, 0.4);
  background: rgba(255, 255, 255, 0.07);
}

.qmf-hint {
  font-size: 10px;
  color: #475569;
  text-align: right;
  margin-top: -6px;
}

/* ─── 底部操作区 ─────────────────────────────────────────────────────────────── */
.qmf-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.qmf-target {
  font-size: 12px;
  color: #64748b;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qmf-target.empty {
  color: #475569;
}

.qmf-send-btn {
  padding: 8px 18px;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.15s;
  white-space: nowrap;
  outline: none;
}

.qmf-send-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
}

.qmf-send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  transform: none;
}

.qmf-send-btn.loading {
  background: #475569;
}

/* ─── 发送结果提示 ───────────────────────────────────────────────────────────── */
.qmf-result {
  padding: 8px 12px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 500;
  text-align: center;
}

.qmf-result.success {
  background: rgba(34, 197, 94, 0.12);
  color: #4ade80;
  border: 1px solid rgba(34, 197, 94, 0.2);
}

.qmf-result.error {
  background: rgba(239, 68, 68, 0.12);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

/* ─── 动画 ──────────────────────────────────────────────────────────────────── */
.qm-slide-enter-active,
.qm-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.qm-slide-enter-from,
.qm-slide-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.97);
}

.qm-result-enter-active,
.qm-result-leave-active {
  transition: opacity 0.3s ease;
}

.qm-result-enter-from,
.qm-result-leave-to {
  opacity: 0;
}
</style>

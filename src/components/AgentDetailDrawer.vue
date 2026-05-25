 <template>
  <el-drawer v-model="drawerVisible" :title="`Agent 详情：${displayAgentName}`" size="1040px" direction="rtl"
    :close-on-click-modal="true" :z-index="3000">
    <template #header>
      <div class="drawer-title">
        <el-icon :size="20" :class="statusColorClass">
          <component :is="drawerAvatarIcon" />
        </el-icon>
        <span class="title-text">{{ displayAgentName }}</span>
        <el-tag :type="statusTagType" :effect="agent?.status === 'running' ? 'dark' : 'light'" size="small"
          class="status-badge">
          <el-icon>
            <component :is="statusIcon" />
          </el-icon>
          {{ displayStatus }}
        </el-tag>
      </div>
    </template>

    <template v-if="agent">
      <div class="drawer-body">
        <!-- ========= 左侧：消息区域 ========= -->
        <div class="drawer-left">
          <div class="left-scroll-wrap">
            <el-card class="detail-section msg-section" shadow="never">
              <template #header>
                <div class="section-header">
                  <div class="section-header-left">
                    <el-icon><ChatDotRound /></el-icon>
                    消息<span v-if="filteredMessages.length > 0" class="msg-count-inline">（{{ filteredMessages.length }} 条）</span>
                  </div>
                  <div class="message-filters">
                    <el-checkbox v-model="showThinking" size="small">显示思考信息</el-checkbox>
                    <el-checkbox v-model="showTool" size="small">显示工具信息</el-checkbox>
                    <!-- 技能库快捷入口 -->
                    <button
                      v-if="drawerAgentSkillNames.length > 0"
                      :class="['skills-shortcut-btn', showSkillsPanel ? 'skills-shortcut-btn--active' : '']"
                      @click="showSkillsPanel = !showSkillsPanel"
                    >
                      <el-icon><Collection /></el-icon>
                      技能库
                      <span class="shortcut-count">{{ drawerAgentSkillNames.length }}</span>
                    </button>
                  </div>
                </div>
              </template>

              <!-- ▼ 可折叠技能面板（在消息区上方） -->
              <transition name="skills-panel">
                <div v-if="showSkillsPanel" class="skills-inline-panel">
                  <div v-if="drawerSkillsLoading" class="skills-panel-loading">
                    <el-icon class="is-loading"><Loading /></el-icon>
                    <span>加载中...</span>
                  </div>
                  <div v-else class="skills-panel-grid">
                    <div
                      v-for="skill in drawerSkillsEnriched"
                      :key="skill.name"
                      :class="['sp-item', skill.enabled ? 'sp-on' : skill.installed ? 'sp-inactive' : 'sp-off']"
                    >
                      <span
                        :class="['sp-dot', skill.enabled ? 'sp-dot--on' : skill.installed ? 'sp-dot--inactive' : 'sp-dot--off']"
                        :title="skill.enabled ? '已激活' : skill.installed ? '已安装，未激活' : '未安装'"
                      />
                      <span class="sp-name" :title="skill.name">{{ skill.displayName }}</span>
                      <el-button
                        v-if="skill.installed && skill.enabled"
                        size="small" type="danger" plain
                        :loading="drawerSkillsToggling.get(skill.name)"
                        :disabled="drawerSkillsToggling.get(skill.name)"
                        @click="handleDrawerSkillToggle(skill.name, false)"
                        class="sp-btn"
                      >禁用</el-button>
                      <el-button
                        v-else-if="skill.installed && !skill.enabled"
                        size="small" type="success" plain
                        :loading="drawerSkillsToggling.get(skill.name)"
                        :disabled="drawerSkillsToggling.get(skill.name)"
                        @click="handleDrawerSkillToggle(skill.name, true)"
                        class="sp-btn"
                      >启用</el-button>
                      <span v-else class="sp-uninstalled">未装</span>
                    </div>
                  </div>
                </div>
              </transition>

              <div ref="msgContainerRef" class="msg-scroll-wrap">
                <el-empty v-if="filteredMessages.length === 0" class="msg-card-inner empty-area" description="暂无消息" :image-size="60" />

                <div v-else class="msg-card-inner">
                  <div class="messages-list-outer" @click="handleMsgImageClick">
                    <div
                      v-for="(msg, idx) in filteredMessages"
                      :key="idx"
                      class="chat-row"
                      :class="msg.role === 'user' ? 'chat-row-user' : 'chat-row-assistant'"
                    >
                      <div
                        class="chat-bubble"
                        :class="bubbleClass(msg)"
                      >
                        <div class="bubble-label" v-if="msg.contentType === 'thinking'">💭 思考</div>
                        <div class="bubble-label" v-else-if="msg.contentType === 'toolUse'">🔧 工具调用</div>
                        <div class="bubble-label" v-else-if="msg.contentType === 'toolResult' && msg.isError">⚠️ 工具错误</div>
                        <div class="bubble-label" v-else-if="msg.contentType === 'toolResult'">🔧 工具结果</div>
                        <div class="markdown-body" v-html="renderMarkdown(msg.content)"></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </el-card>

            <!-- 发送区域 -->
            <div class="chat-send-area" @paste="handlePaste">
              <!-- 粘贴的图片预览 -->
              <div v-if="imageAttachments.length > 0" class="image-preview-strip">
                <div v-for="(img, idx) in imageAttachments" :key="idx" class="image-preview-item">
                  <img :src="img.url" class="image-preview-thumb" @click="previewImageUrl = img.url" />
                  <el-button class="image-remove-btn" size="small" circle
                    @click="imageAttachments.splice(idx, 1)">×</el-button>
                </div>
              </div>
              <div class="send-row">
                <el-input v-model="chatInput" type="textarea" :rows="2"
                  placeholder="输入消息... (Enter 发送，Ctrl+Enter 换行，支持粘贴图片)" :disabled="sending"
                  @keydown="handleInputKeydown" />
                <el-button type="primary" :icon="Promotion" :loading="sending" :disabled="sending" @click="sendMessage">
                  发送
                </el-button>
              </div>
            </div>
          </div>

          <!-- 手动加载历史时左侧消息区域的 loading 遮罩 -->
          <div v-if="loadingHistory" class="left-loading-overlay">
            <el-icon class="is-loading" :size="28">
              <Loading />
            </el-icon>
            <span>正在加载会话历史...</span>
          </div>
        </div>

        <!-- ========= 右侧：会话信息 + 上下文使用 + 操作 ========= -->
        <div class="drawer-right">
          <!-- Session Info -->
          <el-card class="detail-section" shadow="never">
            <template #header>
              <div class="section-header">
                <div class="section-header-left">
                  <el-icon>
                    <InfoFilled />
                  </el-icon>
                  会话信息
                </div>
                <el-tooltip content="在 WebUI 中打开此会话" placement="bottom">
                  <el-button
                    :icon="Link"
                    link
                    @click="openSessionInWebUI"
                  />
                </el-tooltip>
              </div>
            </template>

            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">当前会话</span>
                <span class="info-value monospace" :title="agent.label || agent.key">{{ agent.label || agent.key
                  }}</span>
              </div>
              <div class="info-item" v-if="agent.model">
                <span class="info-label">模型</span>
                <span class="info-value">{{ agent.model }}</span>
              </div>
              <div class="info-item" v-if="agent.createdAt">
                <span class="info-label">创建时间</span>
                <span class="info-value">{{ formatTime(agent.createdAt) }}</span>
              </div>
              <div class="info-item" v-if="agent.lastActivity">
                <span class="info-label">最后活跃</span>
                <span class="info-value">{{ formatTime(String(agent.lastActivity)) }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">运行时长</span>
                <span class="info-value">{{ formattedDuration }}</span>
              </div>
            </div>
          </el-card>

          <!-- Token / 上下文使用 -->
          <el-card class="detail-section" shadow="never" v-if="agent.tokenUsage">
            <template #header>
              <div class="section-header">
                <el-icon>
                  <Coin />
                </el-icon>
                上下文使用
              </div>
            </template>

            <div class="token-usage-panel">
              <div class="token-stat-row">
                <div class="token-stat">
                  <div class="stat-value">{{ agent.tokenUsage.current.toLocaleString() }}</div>
                  <div class="stat-label">Used Tokens</div>
                </div>
                <div class="token-stat">
                  <div class="stat-value">{{ agent.tokenUsage.max.toLocaleString() }}</div>
                  <div class="stat-label">上下文上限</div>
                </div>
                <div class="token-stat">
                  <div class="stat-value" :class="percentageClass">
                    {{ agent.tokenUsage.percentage }}%
                  </div>
                  <div class="stat-label">使用率</div>
                </div>
              </div>

              <el-progress :percentage="agent.tokenUsage.percentage" :status="tokenProgressStatus" :stroke-width="12"
                :show-text="false" class="token-progress" />
            </div>
          </el-card>

          <!-- 历史 Token & 模型消耗明细 -->
          <el-card class="detail-section" shadow="never" v-if="agentHistoricalTokens > 0 || agentModelBreakdown.length > 0">
            <template #header>
              <div class="section-header">
                <el-icon><Odometer /></el-icon>
                历史 Token 消耗
              </div>
            </template>
            <div class="hist-token-panel">
              <div class="hist-total-row">
                <span class="hist-label">累计消耗</span>
                <span class="hist-value">{{ formatTokens(agentHistoricalTokens) }}</span>
              </div>
              <div v-if="agentModelBreakdown.length > 0" class="model-breakdown">
                <div
                  v-for="row in agentModelBreakdown"
                  :key="row.model"
                  class="model-breakdown-row"
                >
                  <span class="model-dot" :style="{ background: row.color }"></span>
                  <span class="model-label">{{ row.displayName }}</span>
                  <span class="model-tokens">{{ formatTokens(row.tokens) }}</span>
                  <el-progress
                    :percentage="row.pct"
                    :stroke-width="5"
                    :show-text="false"
                    :color="row.color"
                    class="model-pct-bar"
                  />
                  <span class="model-pct-text">{{ row.pct }}%</span>
                </div>
              </div>
            </div>
          </el-card>

          <!-- Extra Details -->
          <el-card class="detail-section" shadow="never" v-if="agent.details">
            <template #header>
              <div class="section-header">
                <el-icon>
                  <Document />
                </el-icon>
                原始详情
              </div>
            </template>
            <pre class="raw-details">{{ JSON.stringify(agent.details, null, 2) }}</pre>
          </el-card>

          <!-- Action Buttons -->
          <div class="action-bar">
            <el-button type="danger" :icon="Refresh" @click="handleResetSession" :loading="resetting">
              重置会话
            </el-button>
            <el-button :icon="View" @click="loadHistory()" :loading="loadingHistory">
              加载历史
            </el-button>
          </div>
        </div>
      </div>
    </template>
    <!-- 图片放大预览 -->
    <el-image-viewer v-if="previewImageUrl" :url-list="[previewImageUrl]" :z-index="4000" hide-on-click-modal
      @close="previewImageUrl = ''" />
  </el-drawer>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js'
import 'highlight.js/styles/atom-one-dark.css'
import DOMPurify from 'dompurify'
import type { AgentInfo } from '../stores/agent'
import { useAgentStore } from '../stores/agent'
import { ToolRestrictedError } from '../api/gateway'
import { getAuthToken } from '../config/auth'
import { ElMessage, ElMessageBox, ElImageViewer } from 'element-plus'
import { getSkills, toggleSkill } from '../api/system'
import {
  UserFilled,
  InfoFilled,
  Coin,
  Odometer,
  Collection,
  ChatDotRound,
  Document,
  Refresh,
  View,
  Loading,
  CircleCheckFilled,
  Clock,
  WarningFilled,
  CircleCloseFilled,
  QuestionFilled,
  Avatar,
  Timer,
  Promotion,
  Link,
} from '@element-plus/icons-vue'

interface MessageItem {
  role: string
  contentType: string
  content: string
  isError?: boolean
}

const props = defineProps<{
  visible: boolean
  agentData: AgentInfo | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
}>()

const store = useAgentStore()

// Local state
const drawerVisible = computed({
  get: () => props.visible,
  set: (val: boolean) => emit('update:visible', val),
})

const agent = computed(() => {
  // Always try to get latest from store
  if (!props.agentData) return null
  const latest = store.getAgentByKey(props.agentData.key)
  return latest || props.agentData
})

const historyCount = ref(0)
const recentMessages = ref<MessageItem[]>([])
const loadingHistory = ref(false)
const resetting = ref(false)
const showSkillsPanel = ref(false)

// Chat send
const chatInput = ref('')
const sending = ref(false)
const msgContainerRef = ref<HTMLElement | null>(null)

// REC-036: 消息类型过滤
const showThinking = ref(true)
const showTool = ref(false)

const filteredMessages = computed(() => {
  return recentMessages.value.filter(msg => {
    if (msg.contentType === 'thinking') return showThinking.value
    if (msg.contentType === 'toolUse' || msg.contentType === 'toolResult') return showTool.value
    return true
  })
})

// REC-041: 在 WebUI 中打开当前会话（携带 token 实现免登录）
function openSessionInWebUI(): void {
  if (!agent.value?.key) return
  const token = getAuthToken()
  const sessionKey = agent.value.key || ''
  const httpBase = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:18789'
  const wsBase = httpBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
  if (token) {
    // 使用 hash fragment 携带 token + gatewayUrl，避免 token 出现在服务器日志
    // session 参数须放在 query string（UI 从 searchParams 读取）
    const hash = `token=${encodeURIComponent(token)}&gatewayUrl=${encodeURIComponent(wsBase)}`
    window.open(`${httpBase}/session/chat?session=${encodeURIComponent(sessionKey)}#${hash}`, '_blank')
  } else {
    window.open(`${httpBase}/session/chat?session=${encodeURIComponent(sessionKey)}`, '_blank')
  }
}

// 粘贴的图片附件
interface ImageAttachment {
  url: string        // data URL 用于预览
  mediaType: string  // e.g. "image/png"
  data: string       // base64 数据（不含 data:... 前缀）
}
const imageAttachments = ref<ImageAttachment[]>([])
const previewImageUrl = ref('') // 图片预览弹窗

// Computed
const displayStatus = computed(() => {
  if (!agent.value) return '未知'
  const map: Record<string, string> = {
    running: '运行中',
    idle: '空闲',
    error: '错误',
    aborted: '已终止',
    unknown: '未知',
  }
  return map[agent.value.status] ?? agent.value.status
})

const statusTagType = computed(() => {
  if (!agent.value) return 'info'
  switch (agent.value.status) {
    case 'running': return 'success'
    case 'idle': return 'warning'
    case 'error': return 'danger'
    case 'aborted': return 'info'
    default: return 'info'
  }
})

const statusColorClass = computed(() => {
  if (!agent.value) return 'status-unknown'
  switch (agent.value.status) {
    case 'running': return 'status-running'
    case 'idle': return 'status-idle'
    case 'error': return 'status-error'
    case 'aborted': return 'status-aborted'
    default: return 'status-unknown'
  }
})

const statusIcon = computed(() => {
  if (!agent.value) return QuestionFilled
  switch (agent.value.status) {
    case 'running': return CircleCheckFilled
    case 'idle': return Clock
    case 'error': return WarningFilled
    case 'aborted': return CircleCloseFilled
    default: return QuestionFilled
  }
})

const formattedDuration = computed(() => {
  return store.formatDuration(agent.value?.elapsedMs ?? 0)
})

// ── 历史 Token 消耗（按模型拆分）──
const MODEL_COLORS: Record<string, string> = {
  'deepseek-v4-pro': '#4f6ef7',
  'MiniMax-M2.7': '#10b981',
  'claude-sonnet-4-6': '#f59e0b',
  'claude-sonnet-4-5': '#f59e0b',
  'claude-opus-4': '#f97316',
  'gpt-4o': '#6366f1',
}
const MODEL_DISPLAY: Record<string, string> = {
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'deepseek-v3': 'DeepSeek V3',
  'MiniMax-M2.7': 'MiniMax M2.7',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-sonnet-4-5': 'Claude Sonnet 4.5',
  'claude-opus-4': 'Claude Opus 4',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
}
const FALLBACK_COLORS = ['#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']
let colorIdx = 0
const dynamicColors: Record<string, string> = {}
function modelColor(m: string): string {
  if (MODEL_COLORS[m]) return MODEL_COLORS[m]
  if (!dynamicColors[m]) { dynamicColors[m] = FALLBACK_COLORS[colorIdx++ % FALLBACK_COLORS.length] }
  return dynamicColors[m]
}

const drawerAgentId = computed(() => {
  const parts = (agent.value?.key || '').split(':')
  return (parts[0] === 'agent' && parts.length >= 2) ? parts[1] : parts[0]
})

const agentHistoricalTokens = computed(() => store.getAgentHistoricalTokens(drawerAgentId.value))

const agentModelBreakdown = computed(() => {
  const byModel = store.globalUsage.byAgentByModel?.[drawerAgentId.value]
  if (!byModel) return []
  const total = agentHistoricalTokens.value || 1
  return Object.entries(byModel)
    .map(([model, data]) => ({
      model,
      displayName: MODEL_DISPLAY[model] || model,
      tokens: data.tokens,
      pct: Math.round((data.tokens / total) * 100),
      color: modelColor(model),
    }))
    .sort((a, b) => b.tokens - a.tokens)
})

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K'
  return n.toString()
}

// ── 专属技能（读取 agents-configured + skills） ──────────────────────────────
const SKILL_DISPLAY_NAMES: Record<string, string> = {
  'lark-im': '飞书即时通讯', 'lark-task': '飞书任务', 'lark-calendar': '飞书日历',
  'lark-doc': '飞书文档', 'lark-wiki': '飞书知识库', 'lark-base': '飞书多维表格',
  'lark-sheets': '飞书电子表格', 'lark-drive': '飞书云盘', 'lark-contact': '飞书通讯录',
  'lark-mail': '飞书邮件', 'lark-approval': '飞书审批', 'lark-attendance': '飞书考勤',
  'lark-minutes': '飞书会议纪要', 'lark-okr': '飞书 OKR', 'lark-slides': '飞书幻灯片',
  'lark-vc': '飞书视频会议', 'lark-whiteboard': '飞书白板', 'lark-markdown': '飞书 Markdown',
  'lark-workflow-meeting-summary': '会议总结工作流', 'lark-workflow-standup-report': '站会报告工作流',
  'feishu-toolkit': '飞书工具包', 'feishu-doc': '飞书文档（增强）', 'feishu-wiki': '飞书知识库（增强）',
  'feishu-drive': '飞书云盘（增强）', 'feishu-perm': '飞书权限管理', 'jw-feishu-suite': '嘉维飞书套件',
  'diagram-maker': '流程图绘制', 'browser-automation': '浏览器自动化', 'python-debugpy': 'Python 调试',
  'node-inspect-debugger': 'Node.js 调试', 'spike': '技术调研工具', 'weather': '天气查询',
  'canvas': '画布工具', '1password': '密码管理器', 'apple-notes': 'Apple 备忘录',
}

interface DrawerSkill {
  name: string
  displayName: string
  installed: boolean
  enabled: boolean
}

const drawerAgentSkillNames = ref<string[]>([])
const drawerAllSkills = ref<Map<string, { installed: boolean; enabled: boolean }>>(new Map())
const drawerSkillsLoading = ref(false)
const drawerSkillsToggling = ref<Map<string, boolean>>(new Map())

const drawerSkillsEnriched = computed<DrawerSkill[]>(() => {
  return drawerAgentSkillNames.value.map(name => {
    const info = drawerAllSkills.value.get(name)
    return {
      name,
      displayName: SKILL_DISPLAY_NAMES[name] || name,
      installed: info?.installed ?? false,
      enabled: info?.enabled ?? false,
    }
  })
})

async function fetchDrawerSkills(): Promise<void> {
  const id = drawerAgentId.value
  if (!id) return
  drawerSkillsLoading.value = true
  try {
    const [configResp, skillsResp] = await Promise.all([
      fetch('/api/agents-configured').then(r => r.ok ? r.json() : { agents: [] }).catch(() => ({ agents: [] })),
      getSkills(),
    ])
    const agentCfg = (configResp.agents || []).find((a: { id: string }) => a.id === id)
    drawerAgentSkillNames.value = Array.isArray(agentCfg?.skills) ? agentCfg.skills : []

    const map = new Map<string, { installed: boolean; enabled: boolean }>()
    for (const s of (skillsResp?.skills || [])) {
      map.set(s.name, { installed: !!s.installed, enabled: !!s.enabled })
    }
    drawerAllSkills.value = map
  } catch (e) {
    console.error('[DrawerSkills] fetch error:', e)
  } finally {
    drawerSkillsLoading.value = false
  }
}

async function handleDrawerSkillToggle(skillName: string, enabled: boolean): Promise<void> {
  drawerSkillsToggling.value.set(skillName, true)
  try {
    const result = await toggleSkill(skillName, enabled)
    if (result?.success) {
      ElMessage.success(`"${SKILL_DISPLAY_NAMES[skillName] || skillName}" 已${enabled ? '启用' : '禁用'}`)
      // 本地更新，无需重新全量拉取
      const cur = drawerAllSkills.value.get(skillName)
      drawerAllSkills.value.set(skillName, { installed: cur?.installed ?? true, enabled })
      drawerAllSkills.value = new Map(drawerAllSkills.value) // trigger reactivity
    } else {
      ElMessage.error(result?.message ?? `切换 "${skillName}" 失败`)
    }
  } catch (e) {
    console.error('[DrawerSkills] toggle error:', e)
    ElMessage.error('切换技能状态失败')
  } finally {
    drawerSkillsToggling.value.delete(skillName)
    drawerSkillsToggling.value = new Map(drawerSkillsToggling.value)
  }
}

const isSpecialAgent = computed(() => {
  return agent.value?.name === '副总' || agent.value?.name === '执行秘书'
})

const isCronSession = computed(() => {
  return agent.value?.key?.includes(':cron:')
})

const drawerAvatarIcon = computed(() => {
  if (isCronSession.value) return Timer
  if (isSpecialAgent.value) return Avatar
  return UserFilled
})

const displayAgentName = computed(() => {
  if (isCronSession.value) return '巡检员'
  return agent.value?.name || ''
})

const percentageClass = computed(() => {
  const p = agent.value?.tokenUsage?.percentage ?? 0
  if (p >= 90) return 'text-danger'
  if (p >= 70) return 'text-warning'
  return 'text-success'
})

const tokenProgressStatus = computed(() => {
  const p = agent.value?.tokenUsage?.percentage ?? 0
  if (p >= 90) return 'exception'
  if (p >= 70) return 'warning'
  return 'success'
})

function bubbleClass(msg: MessageItem): string {
  if (msg.role === 'user') return 'bubble-user'
  if (msg.contentType === 'image' || msg.contentType === 'file') return 'bubble-media'
  if (msg.contentType === 'thinking') return 'bubble-thinking'
  if (msg.contentType === 'toolUse' || msg.contentType === 'toolResult') {
    if (msg.isError) return 'bubble-tool-error'
    return 'bubble-tool'
  }
  return 'bubble-assistant'
}

/** 点击消息区域内的图片时放大预览 */
function handleMsgImageClick(event: MouseEvent): void {
  const target = event.target as HTMLElement
  // 找到被点击的 <img>（可能在 markdown-body 内部）
  const img = target.closest('.markdown-body img') as HTMLImageElement | null
  if (img?.src) {
    event.stopPropagation()
    previewImageUrl.value = img.src
  }
}

// Helpers
function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return dateStr
  }
}

function cleanContent(raw: string): string {
  if (!raw) return ''
  let text = raw
  // 1. 移除 thinking 标签及内容（兼容属性、可选空白）
  text = text.replace(/<\s*thinking[^>]*>[\s\S]*?<\/\s*thinking\s*>/gi, '')
  // 2. 移除 antThinking 标签及内容（兼容属性、可选空白）
  text = text.replace(/<\s*antThinking[^>]*>[\s\S]*?<\/\s*antThinking\s*>/gi, '')
  // 3. 移除 toolCall 标签及内容（XML 风格，兼容属性）
  text = text.replace(/<\s*toolCall[^>]*>[\s\S]*?<\/\s*toolCall\s*>/gi, '')
  // 4. 移除 toolCall 自闭合处理指令 <?toolCall ... ?>
  text = text.replace(/<\?\s*toolCall[\s\S]*?\?>/gi, '')
  // 5. 合并过多空行（保留一个空行作为段落分隔），防止相邻行意外形成表格
  text = text.replace(/\n{3,}/g, '\n\n').trim()
  return text
}

// Configure marked with highlight.js for code syntax highlighting
marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext'
      return hljs.highlight(code, { language }).value
    },
  })
)

function renderMarkdown(content: string): string {
  if (!content) return ''
  try {
    const raw = marked.parse(content, { async: false, breaks: true }) as string
    return DOMPurify.sanitize(raw)
  } catch {
    // fallback: escape HTML 并作为纯文本显示
    return escapeHtml(content)
  }
}

/** 转义 HTML 特殊字符，防止 XSS */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }
  return text.replace(/[&<>"']/g, (ch) => map[ch])
}

/**
 * 将 content 字段按类型拆分为独立片段
 * 返回 [{ contentType, content }, ...]
 * 与 agent.ts 中 checkNewMessages()->extractContent() 逻辑保持一致
 */
function splitContentParts(content: unknown): { contentType: string; content: string; isError?: boolean }[] {
  // 1. 字符串：整体作为一个 text 片段
  if (typeof content === 'string') {
    return [{ contentType: 'text', content }]
  }

  // 2. 对象数组：每个 item 是一个独立片段
  if (Array.isArray(content)) {
    const parts = content.map((item: Record<string, unknown>) => {
      if (!item || typeof item !== 'object') return null
      const type = String(item.type ?? '')

      if (type === 'text') {
        const text = String(item.text ?? item.content ?? '')
        return text ? { contentType: 'text', content: text } : null
      }
      if (type === 'thinking') {
        const thinking = String(item.thinking ?? '')
        return thinking ? { contentType: 'thinking', content: thinking } : null
      }
      // 支持 toolUse 和 toolCall 两种命名（不同 API 可能使用不同字段名）
      if (type === 'toolUse' || type === 'toolCall') {
        const name = String(item.name ?? '')
        const input = item.input ?? item.arguments ?? item.parameters
        let displayContent = ''
        if (name) {
          displayContent = `**工具调用：${name}**`
        } else {
          displayContent = '**工具调用**'
        }
        // 显示参数
        if (typeof input === 'object' && input !== null) {
          displayContent += '\n\n```json\n' + JSON.stringify(input, null, 2) + '\n```'
        } else if (typeof input === 'string' && input) {
          // 尝试解析为 JSON，失败则直接显示
          try {
            const parsed = JSON.parse(input)
            displayContent += '\n\n```json\n' + JSON.stringify(parsed, null, 2) + '\n```'
          } catch {
            displayContent += `\n\n\`\`\`\n${input.slice(0, 500)}\n\`\`\``
          }
        }
        return displayContent ? { contentType: 'toolUse', content: displayContent } : null
      }
      if (type === 'toolResult') {
        const name = String(item.name ?? '')
        const isError = item.is_error === true
        // toolResult 的 content 可能是数组 [{type:'text', text:'...'}] 或纯字符串
        const resultContent = item.content
        let text = ''
        if (isError) {
          // 优先从 error 字段获取错误信息
          if (typeof item.error === 'string' && item.error) text = item.error
          else if (typeof resultContent === 'string' && resultContent) text = resultContent
          else if (Array.isArray(resultContent)) {
            const textParts = resultContent
              .filter((r: any) => r?.type === 'text' && typeof r.text === 'string')
              .map((r: any) => r.text)
            if (textParts.length > 0) text = textParts.join('\n')
          }
        }
        if (!text && Array.isArray(resultContent)) {
          const textParts = resultContent
            .filter((r: any) => r?.type === 'text' && typeof r.text === 'string')
            .map((r: any) => r.text)
          if (textParts.length > 0) text = textParts.join('\n').slice(0, 500)
        }
        if (!text && typeof item.text === 'string' && item.text) text = item.text
        if (!text && name) text = '[无返回内容]'
        if (!text) text = '[工具结果]'
        
        // 构建显示内容，包含工具名称
        let displayContent = ''
        if (name) displayContent += `**${name}**\n`
        displayContent += text
        return { contentType: 'toolResult', content: displayContent, isError }
      }
      // OpenAI 风格的图片：{ type: 'image_url', image_url: { url } }
      if (type === 'image_url') {
        const url = String((item.image_url as Record<string, unknown>)?.url ?? '')
        if (url) return { contentType: 'image', content: `![](${url})` }
        return null
      }
      // OpenResponses 风格的图片/文件（发送时使用，历史消息也可能以此格式返回）
      if (type === 'input_image') {
        const source = item.source as Record<string, unknown> | undefined
        const data = String(source?.data ?? '')
        const mediaType = String(source?.media_type ?? 'image/png')
        if (data) return { contentType: 'image', content: `![](data:${mediaType};base64,${data})` }
        // 也可能是 URL 来源
        const srcUrl = String(source?.url ?? '')
        if (srcUrl) return { contentType: 'image', content: `![](${srcUrl})` }
        return null
      }
      if (type === 'input_file') {
        const source = item.source as Record<string, unknown> | undefined
        const filename = String(source?.filename ?? '附件')
        const data = String(source?.data ?? '')
        if (data || source?.url) return { contentType: 'file', content: `📎 ${filename}` }
        return null
      }
      return null
    }).filter(s => s !== null)
    return parts as { contentType: string; content: string }[]
  }

  // 3. 单个对象：提取 text 或 content 字段
  if (content && typeof content === 'object') {
    const obj = content as Record<string, unknown>
    return [{ contentType: 'text', content: String(obj.text ?? obj.content ?? '') }]
  }

  // 4. 其他情况转为字符串
  return [{ contentType: 'text', content: String(content ?? '') }]
}

/** 判断滚动条是否在底部附近 */
function isScrolledToBottom(): boolean {
  const el = msgContainerRef.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 40
}

async function loadHistory(silent: boolean = false, scrollToEnd: boolean = true): Promise<void> {
  if (!agent.value?.key) return
  const startedAt = Date.now()
  const MIN_LOADING_MS = 500
  if (!silent) loadingHistory.value = true
  try {
    const history = await store.fetchSessionHistory(agent.value.key)
    historyCount.value = history.length

    const normalized = (history as Record<string, unknown>[]).flatMap((raw) => {

      const item = (raw && typeof raw === 'object' && raw.message && typeof raw.message === 'object'
        ? (raw.message as Record<string, unknown>)
        : raw) as Record<string, unknown>
      const role = String(item.role ?? '').toLowerCase()
      const parts = splitContentParts(item.content)

      return parts.map((part) => {

        let content = part.content
        if (role === 'assistant') {
          content = cleanContent(content)
        }
        
        if(role === 'toolresult'){
          part.contentType = 'toolResult'  
        }

        const bubbleRole = part.contentType === 'thinking' ? 'thinking'
          : (part.contentType === 'toolUse' || part.contentType === 'toolResult') ? 'tool'
            : (['user', 'assistant', 'system'].includes(role) ? role : 'assistant')


        return {
          role: bubbleRole,
          contentType: part.contentType,
          content,
        }
      })
    })

    const cleanMessages = normalized.filter((msg) => msg.content.length > 0)
    recentMessages.value = cleanMessages
  } finally {
    if (!silent) {
      const elapsed = Date.now() - startedAt
      const remaining = Math.max(0, MIN_LOADING_MS - elapsed)
      if (remaining > 0) {
        await new Promise((r) => setTimeout(r, remaining))
      }
      loadingHistory.value = false
    }
  }
  if (scrollToEnd) {
    await nextTick()
    scrollToBottom()
  }
}

/** 处理粘贴事件：捕获剪贴板中的图片 */
function handlePaste(event: ClipboardEvent): void {
  const items = event.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      event.preventDefault()
      const file = item.getAsFile()
      if (!file) continue
      const reader = new FileReader()
      reader.onload = (e) => {
        const result = e.target?.result as string
        // result 格式: "data:image/png;base64,xxxx"
        const parts = result.split(',')
        if (parts.length !== 2) return
        const mediaType = parts[0].replace('data:', '').replace(';base64', '')
        imageAttachments.value.push({
          url: result,
          mediaType,
          data: parts[1],
        })
      }
      reader.readAsDataURL(file)
      break // 只处理第一张图片
    }
  }
}

/** 输入框按键处理：Enter 发送，Ctrl+Enter 换行 */
function handleInputKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
  // Ctrl+Enter / Shift+Enter → 默认行为（插入换行）
}

/** 发送消息到当前会话 */
async function sendMessage(): Promise<void> {
  const text = chatInput.value.trim()
  if ((!text && imageAttachments.value.length === 0) || !agent.value?.key || sending.value) return

  sending.value = true
  try {
    // 方案B：有图片时先写入 Agent workspace，再发送文件路径
    if (imageAttachments.value.length > 0) {
      await store.sendAgentMessageWithImages(agent.value.key, text, imageAttachments.value)
    } else {
      await store.sendAgentMessage(agent.value.key, text)
    }

    chatInput.value = ''
    imageAttachments.value = []

    ElMessage.success('消息已发送')

    // 发送成功后静默刷新消息列表（不显示 loading 遮罩）
    await loadHistory(true)
  } catch (e: any) {
    console.error('[AgentDetailDrawer] sendMessage error:', e)
    const errorMsg = e?.message || String(e)

    if (errorMsg.includes('missing scope: operator.write')) {
      ElMessage.warning({
        message: '权限不足：需要 operator.write 权限。请在 Gateway 配置中设置 gateway.controlUi.dangerouslyDisableDeviceAuth: true 并重启 Gateway，或使用 openclaw devices approve --latest 批准设备。',
        duration: 6000,
      })
    } else if (errorMsg.includes('timeout')) {
      ElMessage.error('发送超时，请检查 Gateway 是否运行正常')
    } else {
      ElMessage.error(`发送失败: ${e.message}`)
    }
  } finally {
    sending.value = false
  }
}

async function refreshStatus(): Promise<void> {
  if (!agent.value?.key) return
  resetting.value = true
  try {
    await store.fetchAgentStatus(agent.value.key)
  } finally {
    setTimeout(() => { resetting.value = false }, 500)
  }
}

async function handleResetSession(): Promise<void> {
  if (!agent.value?.key) return

  const agentId = agent.value.key.split(':').length >= 2 ? agent.value.key.split(':')[1] : agent.value.key
  try {
    await ElMessageBox.confirm(
      `确定要重置 "${displayAgentName.value}" 的会话吗？这将执行命令：openclaw agent --agent ${agentId} --message "/reset"`,
      '重置会话',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )

    resetting.value = true
    await store.resetSession(agent.value.key)
    ElMessage.success('已执行重置命令')

    // 刷新状态
    await refreshStatus()
  } catch (e: any) {
    if (e !== 'cancel') {
      const errorMsg = e?.message || String(e)
      const errorCode = e?.code
      let userMessage = '重置会话失败'
      let configSteps: string[] = []

      // 1. 前置检测抛出的结构化错误
      if (e instanceof ToolRestrictedError || errorCode === 'TOOLS_RESTRICTED') {
        const toolName = e?.tool || 'sessions_send'
        userMessage = `⚠️ ${toolName} 工具不可用\n\nGateway 安全策略 (gateway.tools) 默认为 deny-allowlist 模式，\n未将 ${toolName} 加入允许列表。`
        configSteps = e?.steps || [
          '1. 编辑 Gateway 配置文件 (openclaw.yaml)',
          '2. 添加 gateway.tools.allow 配置',
          '3. 重启 Gateway',
        ]
      }
      // 2. 权限不足：operator.write scope
      else if (errorMsg.includes('missing scope: operator.write')) {
        userMessage = '权限不足：需要 operator.write 权限。请在 Gateway 配置中设置 gateway.controlUi.dangerouslyDisableDeviceAuth: true 并重启 Gateway，或者使用 openclaw devices approve --latest 批准设备配对请求。'
      }
      // 3. 工具被拒绝（广义关键词匹配）
      else if (/tool.*(not\s+)?available|sessions_send.*(denied|rejected|forbidden)|invoke.*(denied|rejected)|tools.*restrict|403|denied|forbidden/i.test(errorMsg)) {
        userMessage = `⚠️ sessions_send 工具不可用\n\nGateway 安全策略拒绝了该工具调用。`
        configSteps = [
          '1. 编辑 Gateway 配置文件 (openclaw.yaml / .openclaw.yaml)',
          '2. 添加以下配置：',
          '   gateway:',
          '     tools:',
          '       allow:',
          '         - sessions_send',
          '3. 重启 Gateway：openclaw gateway restart',
          '4. 配置文件路径：OpenClaw 安装目录下的 openclaw.yaml',
        ]
      }

      // 如果有配置步骤，用弹窗展示更详细的信息
      if (configSteps.length > 0) {
        await ElMessageBox.alert(
          `<div style="line-height:1.8;white-space:pre-wrap">${userMessage.replace(/\n/g, '<br/>')}</div>` +
          `<div style="margin-top:16px;padding-top:12px;border-top:1px solid #eee;">` +
          `<strong>解决方法：</strong></div>` +
          configSteps.map((s) => `<div style="margin-top:6px">${s.replace(/\n/g, '<br/>')}</div>`).join(''),
          '重置失败',
          {
            confirmButtonText: '我知道了',
            type: 'warning',
            dangerouslyUseHTMLString: true,
          }
        ).catch(() => { }) // 忽略关闭弹窗
      } else {
        ElMessage.error(userMessage.replace(/\n/g, ' '))
      }

      console.error('[AgentDetailDrawer] resetSession error:', e)
    }
  } finally {
    resetting.value = false
  }
}

let refreshTimer: ReturnType<typeof setInterval> | null = null

// Watch for drawer open
watch(drawerVisible, (val) => {
  if (val && agent.value) {
    // Load history on open - 首次打开强制滚动到底部
    loadHistory(false, true)
    // 加载技能数据
    fetchDrawerSkills()
    // 抽屉打开期间定时刷新消息
    refreshTimer = setInterval(() => {
      if (drawerVisible.value && agent.value) {
        const wasAtBottom = isScrolledToBottom()
        loadHistory(true, wasAtBottom) // 静默刷新，仅在用户已在底部时保持底部
      }
    }, 3000)
  } else if (!val) {
    // 关闭抽屉时停止刷新，收起技能面板
    if (refreshTimer !== null) {
      clearInterval(refreshTimer)
      refreshTimer = null
    }
    showSkillsPanel.value = false
  }
})

/** 滚动到最后一条消息 */
function scrollToBottom(): void {
  const container = msgContainerRef.value
  if (!container) return
  const lastRow = container.querySelector('.chat-row:last-child') as HTMLElement | null
  if (lastRow) {
    lastRow.scrollIntoView({ block: 'end', behavior: 'instant' })
  } else {
    container.scrollTop = container.scrollHeight
  }
}

// 新消息到达时仅在已处于底部的情况下自动滚动到底部
watch(recentMessages, () => {
  if (isScrolledToBottom()) {
    nextTick(() => scrollToBottom())
  }
}, { deep: false })
</script>

<style scoped>
.drawer-title {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-primary);
}

.title-text {
  font-weight: 600;
  font-size: 16px;
  flex: 1;
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

/* ==================== 左右布局 ==================== */
.drawer-body {
  display: flex;
  gap: 16px;
  height: 100%;
  overflow: hidden;
}

.drawer-left {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  /* 让加载遮罩可以 absolute 覆盖 */
}

/* ── 左面板滚动容器 (Card + 发送栏 整体布局) ── */
.left-scroll-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* ── el-card body 内的消息滚动容器 ── */
.msg-scroll-wrap {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  scroll-behavior: smooth;
}

/* ── 消息 Card：纯视觉容器，不管 overflow ── */
.drawer-left .msg-section {
  flex: 1;
}

.drawer-left .msg-section :deep(.el-card) {
  display: flex;
  flex-direction: column;
  overflow: visible;
}

.drawer-left .msg-section :deep(.el-card__body) {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 12px;
}

/* ── Card body 内： loading/empty/messages ── */
.msg-card-inner {
  min-height: 0;
}

.msg-card-inner.empty-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

/* ── 消息气泡列表容器 ── */
.messages-list-outer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.drawer-right {
  width: 340px;
  flex-shrink: 0;
  align-self: flex-start;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-section {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
}

.section-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.msg-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: normal;
}

.msg-count-inline {
  font-size: 12px;
  color: var(--text-secondary);
  margin-left: 4px;
  font-weight: 400;
}

.message-filters {
  display: flex;
  gap: 12px;
  margin-left: auto;
}

.info-grid {
  display: grid;
  gap: 10px;
}

.info-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-color);
}

.info-item:last-child {
  border-bottom: none;
}

.info-label {
  color: var(--text-secondary);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}

.info-value {
  color: var(--text-primary);
  font-size: 13px;
  text-align: right;
  max-width: 65%;
  word-break: break-all;
}

.monospace {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 12px;
}

/* Token usage panel */
.token-usage-panel {
  padding: 4px 0;
}

.token-stat-row {
  display: flex;
  justify-content: space-around;
  margin-bottom: 16px;
}

.token-stat {
  text-align: center;
}

.stat-value {
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.stat-label {
  font-size: 11px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 2px;
}

.token-progress {
  margin-top: 8px;
}

/* 聊天气泡样式（由 .messages-list-outer 承载） */

.chat-row {
  display: flex;
}

.chat-row-user {
  justify-content: flex-end;
}

.chat-row-assistant {
  justify-content: flex-start;
}

.chat-bubble {
  max-width: 85%;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
  position: relative;
}

/* 用户消息：蓝色气泡，右对齐 */
.bubble-user {
  background: #42a5f5;
  color: #fff;
  border-bottom-right-radius: 4px;
}

/* AI 回复：灰色气泡，左对齐 */
.bubble-assistant {
  background: #2d3748;
  color: #e2e8f0;
  border-bottom-left-radius: 4px;
}

/* 思考过程：黄色左边框，半透明背景 */
.bubble-thinking {
  background: rgba(255, 193, 7, 0.08);
  color: #e2e8f0;
  border-bottom-left-radius: 4px;
  border-left: 3px solid #ffc107;
  font-style: italic;
}

.bubble-thinking .markdown-body {
  opacity: 0.8;
}

/* 工具调用 / 工具结果：浅灰蓝色背景 + 左边框 */
.bubble-tool {
  background: rgba(66, 165, 245, 0.12);
  color: #e2e8f0;
  border-bottom-left-radius: 4px;
  border: 1px solid rgba(66, 165, 245, 0.25);
  border-left: 3px solid #42a5f5;
  font-size: 12.5px;
}

/* 工具错误：红色左边框，半透明背景 */
.bubble-tool-error {
  background: rgba(244, 67, 54, 0.08);
  color: #e2e8f0;
  border-bottom-left-radius: 4px;
  border-left: 3px solid #f44336;
  font-size: 12.5px;
}

/* 图片/文件：绿色左边框 */
.bubble-media {
  background: rgba(76, 175, 80, 0.08);
  color: #e2e8f0;
  border-bottom-left-radius: 4px;
  border-left: 3px solid #66bb6a;
}

/* 气泡内标签（思考/工具调用/工具结果） */
.bubble-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
  border-radius: 4px;
  opacity: 0.75;
  background: rgba(255, 255, 255, 0.06);
}

/* 工具调用/结果标签更明显的背景 */
.bubble-tool .bubble-label {
  background: rgba(66, 165, 245, 0.2);
  color: #90caf9;
  opacity: 0.9;
}

.bubble-tool-error .bubble-label {
  background: rgba(244, 67, 54, 0.2);
  color: #ef9a9a;
  opacity: 0.9;
}

.bubble-thinking .bubble-label {
  background: rgba(255, 193, 7, 0.15);
  color: #ffe082;
  opacity: 0.85;
}



/* Text colors */
.text-success {
  color: var(--el-color-success);
}

.text-warning {
  color: var(--el-color-warning);
}

.text-danger {
  color: var(--el-color-danger);
}

/* Status colors */
.status-running {
  color: var(--el-color-success);
}

.status-idle {
  color: var(--el-color-warning);
}

.status-error {
  color: var(--el-color-danger);
}

.status-aborted {
  color: var(--el-color-info);
}

.status-unknown {
  color: var(--el-text-color-secondary);
}

/* Action bar */
.action-bar {
  display: flex;
  gap: 10px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color-light);
}

.action-bar .el-button {
  flex: 1;
}

/* 手动加载历史时左侧消息区域的 loading 遮罩 */
.left-loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 14px;
  z-index: 10;
  border-radius: 8px;
}

.empty-state {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  padding: 16px;
  color: var(--text-secondary);
}

/* Raw details */
.raw-details {
  background: var(--bg-elevated);
  padding: 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  margin: 0;
  max-height: 200px;
  overflow-y: auto;
  color: var(--text-primary);
}

/* ── 历史 Token 明细 ── */
.hist-token-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hist-total-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
}

.hist-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.hist-value {
  font-size: 20px;
  font-weight: 700;
  color: #f59e0b;
  font-variant-numeric: tabular-nums;
}

.model-breakdown {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.model-breakdown-row {
  display: grid;
  grid-template-columns: 8px 1fr auto 80px 36px;
  align-items: center;
  gap: 8px;
}

.model-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.model-label {
  font-size: 12px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-tokens {
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  text-align: right;
}

.model-pct-bar {
  width: 80px;
}

.model-pct-text {
  font-size: 11px;
  color: var(--text-secondary);
  text-align: right;
}

/* ═══════════ 聊天发送区域 ═══════════ */
.chat-send-area {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-card);
}

/* 输入框 + 发送按钮水平排列 */
.chat-send-area .send-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.chat-send-area .send-row .el-button {
  flex-shrink: 0;
  height: fit-content;
}

/* ── 图片预览条 ── */
.image-preview-strip {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.image-preview-item {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--border-color);
}

.image-preview-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  cursor: pointer;
  transition: transform 0.15s, filter 0.15s;
}

.image-preview-thumb:hover {
  transform: scale(1.05);
  filter: brightness(1.1);
}

.image-preview-item .image-remove-btn {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 20px;
  height: 20px;
  min-width: 0;
  padding: 0;
  font-size: 14px;
  line-height: 20px;
  border-radius: 50%;
}
</style>

<!-- 非 scoped：v-html 渲染的 markdown 内容不受 scoped 限制 -->
<style>
/* ── Markdown 内容样式（适配深色主题 & 两种气泡底色） ── */
.markdown-body {
  line-height: 1.65;
  font-size: 13px;
}

/* ── 段落 ── */
.markdown-body p {
  margin: 0 0 8px;
}

.markdown-body p:last-child {
  margin-bottom: 0;
}

/* ── 标题 ── */
.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
  margin: 10px 0 6px;
  font-weight: 650;
  line-height: 1.35;
  letter-spacing: -0.01em;
}

.markdown-body h1 {
  font-size: 17px;
}

.markdown-body h2 {
  font-size: 15.5px;
}

.markdown-body h3 {
  font-size: 14.5px;
}

.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
  font-size: 13.5px;
}

/* ── 列表（标记在内部，缩进一致）── */
.markdown-body ul,
.markdown-body ol {
  margin: 6px 0;
  padding-left: 0;
  list-style-position: inside;
}

.markdown-body li {
  margin: 3px 0;
}

.markdown-body li>p {
  margin: 2px 0;
  display: inline;
}

/* 嵌套列表缩进 */
.markdown-body ul ul,
.markdown-body ul ol,
.markdown-body ol ul,
.markdown-body ol ol {
  padding-left: 20px;
}

/* ── 任务列表（[x] / [ ]）── */
.markdown-body ul.contains-task-list {
  padding-left: 6px;
  list-style: none;
}

.markdown-body .task-list-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.markdown-body .task-list-item input[type="checkbox"] {
  margin-top: 3px;
  accent-color: var(--accent, #38bdf8);
}

/* ── 代码块（pre） ── */
.markdown-body pre {
  margin: 8px 0;
  padding: 12px 14px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 12.5px;
  line-height: 1.55;
  background: #1a1d2e !important;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.bubble-user .markdown-body pre {
  background: rgba(0, 0, 0, 0.35) !important;
  border-color: rgba(255, 255, 255, 0.1);
}

/* ── inline code ── */
.markdown-body code {
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', 'JetBrains Mono', monospace;
  font-size: 12px;
  padding: 2px 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
}

.bubble-user .markdown-body code {
  background: rgba(0, 0, 0, 0.2);
}

/* ── pre 内的 code 恢复无样式 ── */
.markdown-body pre code {
  padding: 0;
  background: none !important;
  border-radius: 0;
  font-size: inherit;
  color: inherit;
}

/* ── highlight.js 在气泡内微调 ── */
.markdown-body .hljs {
  background: transparent !important;
  padding: 0;
}

/* ── 加粗 / 斜体 ── */
.markdown-body strong {
  font-weight: 700;
}

.markdown-body em {
  font-style: italic;
}

/* ── 链接 ── */
.markdown-body a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  opacity: 0.88;
  transition: opacity 0.15s;
}

.markdown-body a:hover {
  opacity: 1;
}

.bubble-user .markdown-body a {
  text-decoration-color: rgba(255, 255, 255, 0.5);
}

/* ── 引用 ── */
.markdown-body blockquote {
  margin: 8px 0;
  padding: 6px 12px;
  border-left: 3px solid var(--accent, #38bdf8);
  opacity: 0.88;
  border-radius: 0 4px 4px 0;
  background: rgba(255, 255, 255, 0.04);
}

.bubble-user .markdown-body blockquote {
  background: rgba(0, 0, 0, 0.1);
  border-left-color: rgba(255, 255, 255, 0.5);
}

.markdown-body blockquote p:last-child {
  margin-bottom: 0;
}

/* ── 水平线 ── */
.markdown-body hr {
  margin: 10px 0;
  border: none;
  height: 1px;
  background: rgba(255, 255, 255, 0.12);
}

/* ── 表格（清晰边框）── */
.markdown-body table {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 12.5px;
  width: 100%;
  display: block;
  overflow-x: auto;
}

.markdown-body th,
.markdown-body td {
  padding: 7px 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  text-align: left;
}

.bubble-assistant .markdown-body th,
.bubble-assistant .markdown-body td {
  border-color: rgba(255, 255, 255, 0.12);
}

.bubble-user .markdown-body th,
.bubble-user .markdown-body td {
  border-color: rgba(255, 255, 255, 0.18);
}

.markdown-body th {
  font-weight: 650;
  background: rgba(255, 255, 255, 0.07);
}

.bubble-user .markdown-body th {
  background: rgba(0, 0, 0, 0.15);
}

.markdown-body tr:nth-child(even) td {
  background: rgba(255, 255, 255, 0.03);
}

.bubble-user .markdown-body tr:nth-child(even) td {
  background: rgba(0, 0, 0, 0.08);
}

/* ── 图片 ── */
.markdown-body img {
  max-width: 100%;
  border-radius: 6px;
  margin: 8px 0;
}

/* ══ 技能库快捷按钮（消息区 header 右侧） ══ */
.skills-shortcut-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: rgba(255,255,255,0.04);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  line-height: 1;
  white-space: nowrap;
}
.skills-shortcut-btn:hover {
  border-color: var(--accent, #42a5f5);
  color: var(--accent, #42a5f5);
  background: rgba(66,165,245,0.08);
}
.skills-shortcut-btn--active {
  border-color: var(--accent, #42a5f5);
  color: var(--accent, #42a5f5);
  background: rgba(66,165,245,0.12);
}
.shortcut-count {
  font-size: 10px;
  background: rgba(255,255,255,0.1);
  border-radius: 8px;
  padding: 0 5px;
  height: 15px;
  line-height: 15px;
}

/* ══ 内联技能面板（消息列表上方） ══ */
.skills-inline-panel {
  border-bottom: 1px solid var(--border-color);
  padding: 10px 12px;
  background: rgba(0,0,0,0.12);
  overflow: hidden;
}

/* 过渡动画 */
.skills-panel-enter-active,
.skills-panel-leave-active {
  transition: max-height 0.25s ease, opacity 0.2s ease, padding 0.25s ease;
  max-height: 260px;
}
.skills-panel-enter-from,
.skills-panel-leave-to {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.skills-panel-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 12px;
  padding: 4px 0;
}

/* 技能条目网格：两列 */
.skills-panel-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px 8px;
  max-height: 220px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.sp-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 5px;
  transition: background 0.12s;
}
.sp-item:hover { background: rgba(255,255,255,0.05); }
.sp-off { opacity: 0.4; }
.sp-inactive { opacity: 0.7; }

/* 3 态状态点 */
.sp-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.sp-dot--on {
  background: #4caf50;
  box-shadow: 0 0 4px rgba(76,175,80,0.7);
}
.sp-dot--inactive {
  background: #f59e0b;
  box-shadow: 0 0 3px rgba(245,158,11,0.5);
}
.sp-dot--off {
  background: transparent;
  border: 1.5px dashed rgba(255,255,255,0.3);
}

.sp-name {
  flex: 1;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.sp-btn {
  flex-shrink: 0;
  font-size: 10px !important;
  padding: 1px 6px !important;
  height: auto !important;
  line-height: 1.4 !important;
}

.sp-uninstalled {
  font-size: 10px;
  color: rgba(255,255,255,0.2);
  flex-shrink: 0;
  white-space: nowrap;
}
</style>

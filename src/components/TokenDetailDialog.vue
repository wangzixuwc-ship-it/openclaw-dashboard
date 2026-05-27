<template>
  <el-dialog
    v-model="visible"
    title="Token 消耗详情"
    width="760px"
    :close-on-click-modal="true"
    class="token-detail-dialog"
  >
    <!-- 时段费用速览（Sprint 1）-->
    <div class="period-card" v-if="store.costSummary">
      <div class="period-item">
        <div class="period-label">今日</div>
        <div class="period-value">¥{{ store.costSummary.todayCNY.toFixed(2) }}</div>
      </div>
      <div class="period-item">
        <div class="period-label">本月已用</div>
        <div class="period-value">¥{{ store.costSummary.monthCNY.toFixed(2) }}</div>
      </div>
      <div class="period-item highlight">
        <div class="period-label">本月预估</div>
        <div class="period-value">¥{{ store.costSummary.monthForecastCNY.toFixed(0) }}</div>
        <div class="period-hint">按当前消耗速度推算</div>
      </div>
      <div class="period-item">
        <div class="period-label">
          历史至今
          <el-tooltip placement="top" :width="240" effect="dark">
            <template #content>
              <div style="line-height:1.6">
                全部历史 token × 当前计费配置实时计算<br>
                修改「计费配置」中的价格后，此数字会自动按新单价重新统计所有历史用量
              </div>
            </template>
            <el-icon style="margin-left:4px; cursor:help; opacity:0.6;"><InfoFilled /></el-icon>
          </el-tooltip>
        </div>
        <div class="period-value">{{ store.formatCost(store.totalCostCny) }}</div>
      </div>
    </div>

    <!-- 30天费用折线图（Sprint 6）-->
    <div class="section chart-section">
      <div class="section-title">
        <el-icon><TrendCharts /></el-icon>
        近 30 天费用趋势
        <span class="section-hint">按天聚合</span>
        <div class="chart-compare">
          <span class="compare-item" :class="weekOverWeek >= 0 ? 'up' : 'down'">
            周同比 {{ weekOverWeek >= 0 ? '▲' : '▼' }} {{ Math.abs(weekOverWeek) }}%
          </span>
          <span class="compare-item" :class="monthOverMonth >= 0 ? 'up' : 'down'">
            月同比 {{ monthOverMonth >= 0 ? '▲' : '▼' }} {{ Math.abs(monthOverMonth) }}%
          </span>
        </div>
      </div>
      <div class="cost-chart" v-loading="chartLoading">
        <svg v-if="chartPoints.length > 1" class="chart-svg" :viewBox="`0 0 ${SVG_W} ${SVG_H}`" preserveAspectRatio="none">
          <!-- 网格线 -->
          <line v-for="y in gridLines" :key="y" :x1="PAD_L" :y1="y" :x2="SVG_W - PAD_R" :y2="y"
            stroke="rgba(255,255,255,0.06)" stroke-width="1" />
          <!-- 填充区域 -->
          <path :d="areaPath" fill="url(#chartGradient)" opacity="0.4" />
          <!-- 折线 -->
          <path :d="linePath" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          <!-- 渐变定义 -->
          <defs>
            <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.4"/>
              <stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <!-- 数据点 -->
          <circle
            v-for="(pt, i) in chartPoints"
            :key="i"
            :cx="pt.x" :cy="pt.y" r="3"
            fill="#38bdf8"
            stroke="rgba(15,23,42,0.8)"
            stroke-width="1.5"
          >
            <title>{{ pt.date }}: ¥{{ pt.cost.toFixed(4) }}</title>
          </circle>
          <!-- X轴标签（每5天一个） -->
          <template v-for="(pt, i) in chartPoints" :key="`lbl-${i}`">
            <text
              v-if="i % 5 === 0 || i === chartPoints.length - 1"
              :x="pt.x" :y="SVG_H - 4"
              text-anchor="middle"
              font-size="9" fill="rgba(255,255,255,0.35)"
            >{{ pt.label }}</text>
          </template>
          <!-- Y轴标签 -->
          <text :x="PAD_L - 4" :y="PAD_T + 4" text-anchor="end" font-size="9" fill="rgba(255,255,255,0.4)">¥{{ chartMaxCost.toFixed(2) }}</text>
          <text :x="PAD_L - 4" :y="SVG_H - PAD_B" text-anchor="end" font-size="9" fill="rgba(255,255,255,0.4)">¥0</text>
        </svg>
        <div v-else-if="!chartLoading" class="chart-empty">暂无 30 天费用数据</div>
      </div>
      <!-- 峰值日 -->
      <div v-if="peakDay" class="chart-peak">
        📈 峰值：{{ peakDay.date }} — ¥{{ peakDay.cost.toFixed(4) }}
      </div>
    </div>

    <!-- 全局按模型汇总 -->
    <div class="section">
      <div class="section-title">
        <el-icon><Odometer /></el-icon>
        全局汇总（按模型）
        <span class="section-hint">本次 Gateway 启动以来累计</span>
      </div>
      <el-table :data="modelRows" stripe size="small" class="model-table">
        <el-table-column label="模型" min-width="160">
          <template #default="{ row }">
            <div class="model-cell">
              <span class="model-dot" :style="{ background: row.color }"></span>
              <span class="model-name">{{ row.displayName }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="Token 用量" align="right" min-width="120">
          <template #default="{ row }">
            <span class="token-num">{{ row.tokens.toLocaleString() }}</span>
          </template>
        </el-table-column>
        <el-table-column label="占比" align="right" width="100">
          <template #default="{ row }">
            <el-progress
              :percentage="row.pct"
              :stroke-width="6"
              :show-text="false"
              :color="row.color"
              style="width: 60px; display: inline-block; margin-right: 6px; vertical-align: middle;"
            />
            <span class="pct-num">{{ row.pct }}%</span>
          </template>
        </el-table-column>
        <el-table-column label="费用" align="right" width="100">
          <template #default="{ row }">
            <span :class="row.cost > 0 ? 'cost-num' : 'cost-zero'">
              {{ row.cost > 0 ? '¥' + row.cost.toFixed(4) : '-' }}
            </span>
          </template>
        </el-table-column>
      </el-table>

      <!-- 总计行 -->
      <div class="total-row">
        <span class="total-label">合计</span>
        <span class="total-tokens">{{ totalTokens.toLocaleString() }} tokens</span>
        <span class="total-cost">{{ totalCost > 0 ? '¥' + totalCost.toFixed(4) : '-' }}</span>
      </div>
    </div>

    <!-- 各 Agent 明细 -->
    <div class="section" style="margin-top: 20px;">
      <div class="section-title">
        <el-icon><UserFilled /></el-icon>
        各 Agent 明细
        <span class="section-hint">（可筛选 + 表头排序）</span>
      </div>

      <!-- 筛选条 -->
      <div class="filter-bar">
        <div class="filter-item">
          <span class="filter-label">Agent：</span>
          <el-select
            v-model="agentFilter"
            multiple
            collapse-tags
            collapse-tags-tooltip
            clearable
            placeholder="全部 Agent"
            size="small"
            class="filter-select"
            :teleported="false"
          >
            <el-option
              v-for="opt in agentFilterOptions"
              :key="opt.value"
              :label="opt.text"
              :value="opt.value"
            />
          </el-select>
        </div>
        <div class="filter-item">
          <span class="filter-label">模型：</span>
          <el-select
            v-model="modelFilter"
            multiple
            collapse-tags
            collapse-tags-tooltip
            clearable
            placeholder="全部模型"
            size="small"
            class="filter-select"
            :teleported="false"
          >
            <el-option
              v-for="opt in modelFilterOptions"
              :key="opt.value"
              :label="opt.text"
              :value="opt.value"
            />
          </el-select>
        </div>
        <span class="filter-count">{{ filteredAgentModelRows.length }} / {{ agentModelRows.length }} 条</span>
      </div>

      <el-table
        :data="filteredAgentModelRows"
        stripe
        size="small"
        class="agent-table"
        :default-sort="{ prop: 'tokens', order: 'descending' }"
      >
        <el-table-column
          label="Agent"
          prop="agentId"
          width="150"
        >
          <template #default="{ row }">
            <div class="agent-cell">
              <span class="agent-avatar-sm">
                <img
                  v-if="!avatarFailed[row.agentId]"
                  :src="getAgentAvatarSrc(row.agentId)"
                  :alt="row.agentName"
                  class="agent-avatar-img"
                  @error="avatarFailed[row.agentId] = true"
                />
                <span v-else-if="row.emoji" class="agent-avatar-emoji">{{ row.emoji }}</span>
                <span v-else class="agent-avatar-letter">{{ row.agentId[0].toUpperCase() }}</span>
              </span>
              <span class="agent-id-name">{{ row.agentName }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column
          label="模型"
          prop="model"
          min-width="140"
        >
          <template #default="{ row }">
            <div class="model-cell">
              <span class="model-dot" :style="{ background: getModelColor(row.model) }"></span>
              <span>{{ getModelDisplayName(row.model) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column
          label="Token 用量"
          prop="tokens"
          align="right"
          min-width="120"
          sortable
          :sort-method="(a: any, b: any) => a.tokens - b.tokens"
        >
          <template #default="{ row }">
            <span class="token-num">{{ row.tokens.toLocaleString() }}</span>
          </template>
        </el-table-column>
        <el-table-column
          label="费用"
          prop="cost"
          align="right"
          width="110"
          sortable
          :sort-method="(a: any, b: any) => a.cost - b.cost"
        >
          <template #default="{ row }">
            <span :class="row.cost > 0 ? 'cost-num' : 'cost-zero'">
              {{ row.cost > 0 ? '¥' + row.cost.toFixed(4) : '-' }}
            </span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <span class="updated-at">数据更新：{{ store.globalUsage.updatedAt ? new Date(store.globalUsage.updatedAt).toLocaleString('zh-CN') : '-' }}</span>
        <el-button @click="visible = false">关闭</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Odometer, UserFilled, InfoFilled, TrendCharts } from '@element-plus/icons-vue'
import { useAgentStore } from '../stores/agent'

const visible = defineModel<boolean>('visible', { default: false })

const store = useAgentStore()

// 打开 dialog 时拉一次最新费用速览 + 图表数据
watch(visible, (val) => {
  if (val) {
    store.fetchCostSummary()
    fetchTimeline()
  }
})

// ── Sprint 6: 30 天费用时间线图表 ──
interface TimelineDay { date: string; tokens: number; cost: number }
const chartLoading = ref(false)
const timeline = ref<TimelineDay[]>([])

// SVG 尺寸
const SVG_W = 700
const SVG_H = 120
const PAD_L = 36
const PAD_R = 12
const PAD_T = 12
const PAD_B = 20

async function fetchTimeline() {
  chartLoading.value = true
  try {
    const res = await fetch('/api/cost-timeline?days=30')
    if (res.ok) {
      const data = await res.json()
      timeline.value = data.timeline || []
    }
  } catch { /* ignore */ } finally {
    chartLoading.value = false
  }
}

const chartMaxCost = computed(() => Math.max(...timeline.value.map(d => d.cost), 0.0001))

interface ChartPoint { x: number; y: number; date: string; cost: number; label: string }
const chartPoints = computed<ChartPoint[]>(() => {
  if (timeline.value.length < 2) return []
  const maxC = chartMaxCost.value
  const n = timeline.value.length
  const plotW = SVG_W - PAD_L - PAD_R
  const plotH = SVG_H - PAD_T - PAD_B
  return timeline.value.map((d, i) => {
    const x = PAD_L + (i / (n - 1)) * plotW
    const y = PAD_T + plotH - (d.cost / maxC) * plotH
    const parts = d.date.split('-')
    return { x, y, date: d.date, cost: d.cost, label: `${parts[1]}/${parts[2]}` }
  })
})

const linePath = computed(() => {
  const pts = chartPoints.value
  if (!pts.length) return ''
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
})

const areaPath = computed(() => {
  const pts = chartPoints.value
  if (!pts.length) return ''
  const bottom = SVG_H - PAD_B
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  return `${line} L${pts[pts.length-1].x.toFixed(1)},${bottom} L${pts[0].x.toFixed(1)},${bottom} Z`
})

const gridLines = computed(() => {
  const plotH = SVG_H - PAD_T - PAD_B
  return [0.25, 0.5, 0.75, 1].map(r => PAD_T + plotH * (1 - r))
})

const peakDay = computed(() => {
  if (!timeline.value.length) return null
  return [...timeline.value].sort((a, b) => b.cost - a.cost)[0]
})

// 同比计算
function sumRange(start: number, end: number): number {
  return timeline.value.slice(start, end).reduce((s, d) => s + d.cost, 0)
}
const weekOverWeek = computed(() => {
  const n = timeline.value.length
  if (n < 14) return 0
  const thisWeek = sumRange(n - 7, n)
  const lastWeek = sumRange(n - 14, n - 7)
  if (lastWeek === 0) return 0
  return Math.round(((thisWeek - lastWeek) / lastWeek) * 100)
})
const monthOverMonth = computed(() => {
  const n = timeline.value.length
  if (n < 30) return 0
  const thisHalf = sumRange(n - 15, n)
  const lastHalf = sumRange(n - 30, n - 15)
  if (lastHalf === 0) return 0
  return Math.round(((thisHalf - lastHalf) / lastHalf) * 100)
})

// 模型颜色映射
const MODEL_COLORS: Record<string, string> = {
  'deepseek-v4-pro': '#4f6ef7',
  'MiniMax-M2.7': '#10b981',
  'claude-sonnet-4-6': '#f59e0b',
  'claude-sonnet-4-5': '#f59e0b',
  'gpt-4o': '#6366f1',
}
const FALLBACK_COLORS = ['#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316']
let colorIdx = 0
const dynamicColors: Record<string, string> = {}

function getModelColor(model: string): string {
  if (MODEL_COLORS[model]) return MODEL_COLORS[model]
  if (!dynamicColors[model]) {
    dynamicColors[model] = FALLBACK_COLORS[colorIdx % FALLBACK_COLORS.length]
    colorIdx++
  }
  return dynamicColors[model]
}

// 模型显示名映射
const MODEL_DISPLAY: Record<string, string> = {
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'deepseek-v3': 'DeepSeek V3',
  'MiniMax-M2.7': 'MiniMax M2.7',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-sonnet-4-5': 'Claude Sonnet 4.5',
  'claude-opus-4': 'Claude Opus 4',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'unknown': '未知模型',
}

function getModelDisplayName(model: string): string {
  return MODEL_DISPLAY[model] || model
}

// Agent 显示名（从 store）
function getAgentDisplayName(agentId: string): string {
  const agent = store.agents.find(a => {
    const id = (a.key || '').split(':')[1] || ''
    return id === agentId
  })
  return agent?.name || agentId
}

function getAgentEmoji(agentId: string): string {
  const agent = store.agents.find(a => {
    const id = (a.key || '').split(':')[1] || ''
    return id === agentId
  })
  return agent?.emoji || ''
}

// 头像图片路径：优先 .env 配置 → /avatars/{id}.jpg → 加载失败降级
const avatarFailed = ref<Record<string, boolean>>({})
function getAgentAvatarSrc(agentId: string): string {
  const idUpper = agentId.replace(/-/g, '_').toUpperCase()
  const envKey = `VITE_AGENT_${idUpper}_AVATAR`
  const envPath = (import.meta.env as Record<string, string>)[envKey]
  if (envPath) return envPath
  return `/avatars/${agentId}.jpg`
}

// 全局总计
const totalTokens = computed(() => store.globalUsage.totalTokens || 0)
const totalCost = computed(() => store.globalUsage.totalCost || 0)

// 按模型汇总行
const modelRows = computed(() => {
  const byModel = store.globalUsage.byModel || {}
  const total = totalTokens.value || 1
  return Object.entries(byModel)
    .map(([model, data]) => ({
      model,
      displayName: getModelDisplayName(model),
      tokens: data.tokens,
      cost: data.cost,
      pct: Math.round((data.tokens / total) * 100),
      color: getModelColor(model),
    }))
    .sort((a, b) => b.tokens - a.tokens)
})

// 各 Agent x 模型明细行（扁平化，每行独立——不再用 isFirst 分组以兼容筛排）
const agentModelRows = computed(() => {
  const byAgentByModel = store.globalUsage.byAgentByModel || {}
  const rows: Array<{
    agentId: string
    agentName: string
    emoji: string
    model: string
    tokens: number
    cost: number
  }> = []
  for (const [agentId, modelMap] of Object.entries(byAgentByModel)) {
    if (!modelMap) continue
    for (const [model, data] of Object.entries(modelMap)) {
      rows.push({
        agentId,
        agentName: getAgentDisplayName(agentId),
        emoji: getAgentEmoji(agentId),
        model,
        tokens: data.tokens,
        cost: data.cost,
      })
    }
  }
  return rows
})

// 表头 Agent 筛选下拉选项（去重，按名称排序）
const agentFilterOptions = computed(() => {
  const seen = new Map<string, string>()
  for (const row of agentModelRows.value) {
    if (!seen.has(row.agentId)) seen.set(row.agentId, row.agentName)
  }
  return [...seen.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'zh-CN'))
    .map(([id, name]) => ({ text: name, value: id }))
})

// 表头 模型 筛选下拉选项
const modelFilterOptions = computed(() => {
  const seen = new Set<string>()
  for (const row of agentModelRows.value) seen.add(row.model)
  return [...seen]
    .sort((a, b) => getModelDisplayName(a).localeCompare(getModelDisplayName(b)))
    .map(model => ({ text: getModelDisplayName(model), value: model }))
})

// 筛选条状态：空数组 = 不筛选（全部显示）
const agentFilter = ref<string[]>([])
const modelFilter = ref<string[]>([])

const filteredAgentModelRows = computed(() => {
  return agentModelRows.value.filter(row => {
    if (agentFilter.value.length > 0 && !agentFilter.value.includes(row.agentId)) return false
    if (modelFilter.value.length > 0 && !modelFilter.value.includes(row.model)) return false
    return true
  })
})
</script>

<style scoped>
.section {
  margin-bottom: 4px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #e2e8f0);
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-color, #2d3748);
}

.section-hint {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-secondary, #94a3b8);
  margin-left: 6px;
  opacity: 0.75;
}

/* 时段费用速览卡（Sprint 1） */
.period-card {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 16px;
  padding: 14px;
  background: linear-gradient(135deg, rgba(16,185,129,0.06), rgba(66,165,245,0.06));
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
}
.period-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 4px;
}
.period-item.highlight {
  background: rgba(245,158,11,0.06);
  border-radius: 6px;
  padding: 4px 8px;
}
.period-label {
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
  font-weight: 500;
}
.period-value {
  font-size: 18px;
  font-weight: 700;
  color: #10b981;
  font-variant-numeric: tabular-nums;
}
.period-item.highlight .period-value { color: #fbbf24; }
.period-hint {
  font-size: 10px;
  color: var(--text-secondary, #94a3b8);
  opacity: 0.7;
}

/* ── 筛选条 ── */
.filter-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 12px;
  margin-bottom: 10px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 8px;
  flex-wrap: wrap;
}
.filter-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.filter-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #94a3b8);
  white-space: nowrap;
}
.filter-select {
  width: 180px;
}
.filter-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
  font-variant-numeric: tabular-nums;
}

.model-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.model-name {
  font-size: 13px;
}

.token-num {
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  font-weight: 500;
}

.pct-num {
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
  vertical-align: middle;
}

.cost-num {
  color: #10b981;
  font-weight: 500;
}

.cost-zero {
  color: var(--text-secondary, #94a3b8);
}

.total-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 20px;
  padding: 8px 12px;
  background: var(--bg-elevated, rgba(255,255,255,0.04));
  border-radius: 6px;
  margin-top: 6px;
  font-size: 13px;
}

.total-label {
  color: var(--text-secondary, #94a3b8);
  margin-right: auto;
  font-weight: 600;
}

.total-tokens {
  font-weight: 600;
  color: var(--text-primary, #e2e8f0);
}

.total-cost {
  font-weight: 600;
  color: #10b981;
  min-width: 80px;
  text-align: right;
}

.agent-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.agent-cell-empty {
  height: 20px;
}

.agent-avatar-sm {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: var(--bg-elevated, rgba(255,255,255,0.08));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}
.agent-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 3px;
}
.agent-avatar-emoji {
  font-size: 13px;
  line-height: 1;
}
.agent-avatar-letter {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary, #94a3b8);
}

.agent-id-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary, #e2e8f0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.updated-at {
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
}

/* 覆盖 Element Plus 表格样式 */
:deep(.el-table) {
  background: transparent;
  font-size: 13px;
}

:deep(.el-table tr) {
  background: transparent;
}

:deep(.el-table--striped .el-table__body tr.el-table__row--striped td) {
  background: rgba(255,255,255,0.03);
}

:deep(.el-table th) {
  background: rgba(255,255,255,0.04);
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* ── Sprint 6: Chart ── */
.chart-section { margin-top: 0; }
.chart-compare {
  margin-left: auto;
  display: flex;
  gap: 12px;
  font-size: 11px;
  font-weight: 600;
}
.compare-item.up { color: #ef4444; }
.compare-item.down { color: #4caf50; }

.cost-chart {
  position: relative;
  height: 120px;
  background: rgba(0,0,0,0.2);
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.06);
}
.chart-svg {
  width: 100%;
  height: 100%;
  display: block;
}
.chart-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 12px;
  color: rgba(255,255,255,0.3);
}
.chart-peak {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 6px;
  padding: 0 4px;
}
</style>

<!-- 非 scoped：filter popper 通过 Teleport 渲染到 body 层，必须用全局选择器 -->
<style>
/* el-table filter 下拉菜单：z-index 必须高于 el-dialog（默认 2000），并适配深色主题 */
.el-table-filter.token-detail-filter-popper,
.el-table-filter {
  z-index: 4000 !important;
  background: #1e293b !important;
  border: 1px solid rgba(255,255,255,0.1) !important;
  box-shadow: 0 6px 24px rgba(0,0,0,0.5) !important;
}
.el-table-filter .el-table-filter__list {
  background: transparent !important;
}
.el-table-filter .el-table-filter__list-item {
  color: rgba(255,255,255,0.85) !important;
  font-size: 12px !important;
}
.el-table-filter .el-table-filter__list-item:hover {
  background: rgba(66,165,245,0.15) !important;
}
.el-table-filter .el-table-filter__list-item.is-active {
  background: rgba(66,165,245,0.25) !important;
  color: #90caf9 !important;
  font-weight: 600;
}
.el-table-filter .el-table-filter__bottom {
  border-top: 1px solid rgba(255,255,255,0.08) !important;
}
.el-table-filter .el-table-filter__bottom button {
  color: rgba(255,255,255,0.7) !important;
}
.el-table-filter .el-table-filter__bottom button.is-disabled {
  color: rgba(255,255,255,0.25) !important;
}
.el-table-filter .el-table-filter__checkbox-group label {
  color: rgba(255,255,255,0.85) !important;
}
</style>

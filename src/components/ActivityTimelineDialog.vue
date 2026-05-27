<template>
  <!-- ── 弹窗模式（Dialog Mode）── -->
  <el-dialog
    v-if="!inline"
    v-model="visible"
    title=""
    width="92vw"
    style="max-width: 1200px"
    :close-on-click-modal="true"
    destroy-on-close
    class="timeline-dialog"
  >
    <template #header>
      <div class="tl-header">
        <div class="tl-title-row">
          <span class="tl-title">📈 活动时间线</span>
          <div class="tl-range-btns">
            <button v-for="opt in RANGE_OPTIONS" :key="opt.hours"
              class="tl-range-btn" :class="{ active: selectedHours === opt.hours }"
              @click="setRange(opt.hours)">{{ opt.label }}</button>
          </div>
        </div>
        <div class="tl-summary" v-if="!loading && sessions.length">
          {{ sessions.length }} 条 session · {{ agentLanes.length }} 个 agent ·
          时间跨度 {{ formatDuration((timeEnd - timeStart) / 1000) }}
        </div>
      </div>
    </template>
    <div class="tl-body" v-loading="loading">
      <div v-if="!loading && sessions.length === 0" class="tl-empty">
        <div class="tl-empty-icon">📭</div>
        <div>过去 {{ selectedHours }} 小时内没有 agent 活动记录</div>
        <div class="tl-empty-sub">尝试扩大时间窗口</div>
      </div>
      <div v-else class="tl-chart-wrap">
        <div class="tl-lane-labels">
          <div class="tl-lane-label tl-time-label-spacer"></div>
          <div v-for="lane in agentLanes" :key="lane.agentId"
            class="tl-lane-label" :style="{ height: LANE_H + 'px' }">
            <span class="tl-lane-emoji">{{ lane.emoji }}</span>
            <span class="tl-lane-name">{{ lane.name }}</span>
          </div>
        </div>
        <div class="tl-svg-wrap" ref="svgWrap" @scroll="onScroll">
          <svg :width="svgWidth" :height="svgHeight" class="tl-svg">
            <rect width="100%" height="100%" fill="transparent" />
            <g class="tl-grid">
              <template v-for="tick in timeTicks" :key="tick.ts">
                <line :x1="tick.x" :y1="TIME_AXIS_H" :x2="tick.x" :y2="svgHeight"
                  stroke="rgba(255,255,255,0.05)" stroke-width="1" />
                <text :x="tick.x + 4" :y="TIME_AXIS_H - 6"
                  fill="rgba(255,255,255,0.3)" font-size="10">{{ tick.label }}</text>
              </template>
            </g>
            <g v-if="nowX > 0 && nowX < svgWidth">
              <line :x1="nowX" :y1="TIME_AXIS_H" :x2="nowX" :y2="svgHeight"
                stroke="#f59e0b" stroke-width="1" stroke-dasharray="4,3" />
              <text :x="nowX + 4" :y="TIME_AXIS_H - 6" fill="#f59e0b" font-size="10">NOW</text>
            </g>
            <g>
              <template v-for="(lane, li) in agentLanes" :key="lane.agentId + '-bg'">
                <rect x="0" :y="TIME_AXIS_H + li * LANE_H" :width="svgWidth" :height="LANE_H"
                  :fill="li % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent'" />
              </template>
            </g>
            <g>
              <template v-for="bar in sessionBars" :key="bar.sessionId">
                <rect :x="bar.x" :y="bar.y + 6" :width="Math.max(bar.w, 4)" :height="LANE_H - 12" :rx="4"
                  :fill="bar.color" :opacity="hoveredSession === bar.sessionId ? 1 : 0.75"
                  class="tl-bar"
                  @mouseenter="e => showTooltip(e, bar)" @mouseleave="hideTooltip" />
                <text v-if="bar.trigger === 'cron' && bar.w > 20"
                  :x="bar.x + 5" :y="bar.y + LANE_H - 18" font-size="9" fill="rgba(255,255,255,0.7)">⏰</text>
              </template>
            </g>
            <line x1="0" :y1="TIME_AXIS_H" :x2="svgWidth" :y2="TIME_AXIS_H"
              stroke="rgba(255,255,255,0.08)" stroke-width="1" />
          </svg>
          <div v-if="tooltip.visible" class="tl-tooltip"
            :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }">
            <div class="tl-tt-agent">{{ tooltip.agentEmoji }} {{ tooltip.agentName }}</div>
            <div class="tl-tt-time">{{ tooltip.startTime }} → {{ tooltip.endTime }}</div>
            <div class="tl-tt-dur">时长 {{ tooltip.duration }}</div>
            <div class="tl-tt-trigger">触发：{{ tooltip.trigger === 'cron' ? '⏰ 定时任务' : '👤 用户消息' }}</div>
          </div>
        </div>
      </div>
    </div>
  </el-dialog>

  <!-- ── 内联模式（Inline Mode）── -->
  <template v-else>
    <!-- 内联 header（范围选择 + 摘要 + 刷新）-->
    <div class="tl-inline-header">
      <div class="tl-inline-left">
        <span class="tl-inline-title">📈 活动时间线</span>
        <span class="tl-summary" v-if="!loading && sessions.length">
          {{ sessions.length }} 条 · {{ agentLanes.length }} 个 agent ·
          {{ formatDuration((timeEnd - timeStart) / 1000) }}
        </span>
        <span v-else-if="loading" class="tl-summary">加载中…</span>
        <span v-else class="tl-summary">暂无活动</span>
      </div>
      <div class="tl-inline-right">
        <div class="tl-range-btns">
          <button v-for="opt in RANGE_OPTIONS" :key="opt.hours"
            class="tl-range-btn" :class="{ active: selectedHours === opt.hours }"
            @click="setRange(opt.hours)">{{ opt.label }}</button>
        </div>
        <button class="tl-refresh-btn" @click="fetchTimeline" title="刷新数据">↺</button>
      </div>
    </div>

    <!-- 内联图表正文 -->
    <div class="tl-body tl-body-inline" v-loading="loading">
      <div v-if="!loading && sessions.length === 0" class="tl-empty">
        <div class="tl-empty-icon">📭</div>
        <div>过去 {{ selectedHours }} 小时内没有 Agent 活动</div>
        <div class="tl-empty-sub">尝试扩大时间范围</div>
      </div>
      <div v-else class="tl-chart-wrap">
        <div class="tl-lane-labels">
          <div class="tl-lane-label tl-time-label-spacer"></div>
          <div v-for="lane in agentLanes" :key="lane.agentId"
            class="tl-lane-label" :style="{ height: LANE_H + 'px' }">
            <span class="tl-lane-emoji">{{ lane.emoji }}</span>
            <span class="tl-lane-name">{{ lane.name }}</span>
          </div>
        </div>
        <div class="tl-svg-wrap" ref="svgWrap" @scroll="onScroll">
          <svg :width="svgWidth" :height="svgHeight" class="tl-svg">
            <rect width="100%" height="100%" fill="transparent" />
            <g class="tl-grid">
              <template v-for="tick in timeTicks" :key="tick.ts">
                <line :x1="tick.x" :y1="TIME_AXIS_H" :x2="tick.x" :y2="svgHeight"
                  stroke="rgba(255,255,255,0.05)" stroke-width="1" />
                <text :x="tick.x + 4" :y="TIME_AXIS_H - 6"
                  fill="rgba(255,255,255,0.3)" font-size="10">{{ tick.label }}</text>
              </template>
            </g>
            <g v-if="nowX > 0 && nowX < svgWidth">
              <line :x1="nowX" :y1="TIME_AXIS_H" :x2="nowX" :y2="svgHeight"
                stroke="#f59e0b" stroke-width="1" stroke-dasharray="4,3" />
              <text :x="nowX + 4" :y="TIME_AXIS_H - 6" fill="#f59e0b" font-size="10">NOW</text>
            </g>
            <g>
              <template v-for="(lane, li) in agentLanes" :key="lane.agentId + '-bg'">
                <rect x="0" :y="TIME_AXIS_H + li * LANE_H" :width="svgWidth" :height="LANE_H"
                  :fill="li % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent'" />
              </template>
            </g>
            <g>
              <template v-for="bar in sessionBars" :key="bar.sessionId">
                <rect :x="bar.x" :y="bar.y + 6" :width="Math.max(bar.w, 4)" :height="LANE_H - 12" :rx="4"
                  :fill="bar.color" :opacity="hoveredSession === bar.sessionId ? 1 : 0.75"
                  class="tl-bar"
                  @mouseenter="e => showTooltip(e, bar)" @mouseleave="hideTooltip" />
                <text v-if="bar.trigger === 'cron' && bar.w > 20"
                  :x="bar.x + 5" :y="bar.y + LANE_H - 18" font-size="9" fill="rgba(255,255,255,0.7)">⏰</text>
              </template>
            </g>
            <line x1="0" :y1="TIME_AXIS_H" :x2="svgWidth" :y2="TIME_AXIS_H"
              stroke="rgba(255,255,255,0.08)" stroke-width="1" />
          </svg>
          <div v-if="tooltip.visible" class="tl-tooltip"
            :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }">
            <div class="tl-tt-agent">{{ tooltip.agentEmoji }} {{ tooltip.agentName }}</div>
            <div class="tl-tt-time">{{ tooltip.startTime }} → {{ tooltip.endTime }}</div>
            <div class="tl-tt-dur">时长 {{ tooltip.duration }}</div>
            <div class="tl-tt-trigger">触发：{{ tooltip.trigger === 'cron' ? '⏰ 定时任务' : '👤 用户消息' }}</div>
          </div>
        </div>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'

const props = defineProps<{
  modelValue?: boolean
  /** 内联模式（Inline Mode）：不使用 el-dialog，直接嵌入页面 */
  inline?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [val: boolean] }>()

const visible = computed({
  get: () => props.modelValue ?? false,
  set: (v) => emit('update:modelValue', v),
})

// === Constants ===
const LANE_H = 48
const TIME_AXIS_H = 28
const PAD_R = 24
const MIN_BAR_W = 4
const MIN_SVG_W = 800

const RANGE_OPTIONS = [
  { label: '6h',  hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d',  hours: 168 },
  { label: '30d', hours: 720 },
]

const AGENT_COLORS: Record<string, string> = {
  main:      '#6366f1',
  pm:        '#f59e0b',
  developer: '#22c55e',
  tester:    '#3b82f6',
  inspector: '#8b5cf6',
  archivist: '#ec4899',
}

function agentColor(id: string) {
  return AGENT_COLORS[id] || '#64748b'
}

// === State ===
const selectedHours = ref(24)
const loading = ref(false)
const sessions = ref<any[]>([])
const svgWrap = ref<HTMLElement | null>(null)
const svgWrapWidth = ref(MIN_SVG_W)

const hoveredSession = ref<string | null>(null)
const tooltip = ref({
  visible: false, x: 0, y: 0,
  agentName: '', agentEmoji: '', startTime: '', endTime: '', duration: '', trigger: '',
})

// Agent meta from config
const agentMeta = ref<Record<string, { name: string; emoji: string }>>({})
async function loadAgentMeta() {
  try {
    const resp = await fetch('/api/agents-configured')
    if (resp.ok) {
      const data = await resp.json()
      for (const a of (data.agents || [])) agentMeta.value[a.id] = { name: a.name || a.id, emoji: a.emoji || '🤖' }
    }
  } catch { /* ignore */ }
}

// === Data ===
async function fetchTimeline() {
  loading.value = true
  try {
    const resp = await fetch(`/api/activity-timeline?hours=${selectedHours.value}`)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    sessions.value = data.sessions || []
  } catch (e: any) {
    ElMessage.error('加载时间线失败: ' + e.message)
    sessions.value = []
  } finally {
    loading.value = false
    nextTick(updateSvgWidth)
  }
}

function setRange(h: number) {
  selectedHours.value = h
  fetchTimeline()
}

function updateSvgWidth() {
  svgWrapWidth.value = svgWrap.value?.clientWidth || MIN_SVG_W
}

// === Derived geometry ===
const timeStart = computed(() => {
  if (!sessions.value.length) return Date.now() - selectedHours.value * 3600000
  return Math.min(...sessions.value.map(s => s.startMs))
})

const timeEnd = computed(() => {
  const now = Date.now()
  if (!sessions.value.length) return now
  return Math.max(now, ...sessions.value.map(s => s.endMs))
})

const timeSpan = computed(() => Math.max(timeEnd.value - timeStart.value, 1))

const agentLanes = computed(() => {
  const agentIds = [...new Set(sessions.value.map(s => s.agentId))]
  agentIds.sort((a, b) => {
    const aFirst = sessions.value.find(s => s.agentId === a)?.startMs || 0
    const bFirst = sessions.value.find(s => s.agentId === b)?.startMs || 0
    return aFirst - bFirst
  })
  return agentIds.map(id => ({
    agentId: id,
    name: agentMeta.value[id]?.name || id,
    emoji: agentMeta.value[id]?.emoji || '🤖',
    color: agentColor(id),
  }))
})

const svgWidth = computed(() => Math.max(svgWrapWidth.value - 2, MIN_SVG_W))
const svgHeight = computed(() => TIME_AXIS_H + agentLanes.value.length * LANE_H + 4)

function tsToX(ms: number): number {
  return ((ms - timeStart.value) / timeSpan.value) * (svgWidth.value - PAD_R)
}

const sessionBars = computed(() => {
  return sessions.value.map(s => {
    const laneIdx = agentLanes.value.findIndex(l => l.agentId === s.agentId)
    const x = tsToX(s.startMs)
    const x2 = tsToX(s.endMs)
    const w = Math.max(x2 - x, MIN_BAR_W)
    const y = TIME_AXIS_H + laneIdx * LANE_H
    return { ...s, x, y, w, color: agentColor(s.agentId) }
  })
})

const timeTicks = computed(() => {
  const ticks: { ts: number; x: number; label: string }[] = []
  const spanMs = timeSpan.value
  let intervalMs: number
  if (spanMs <= 3 * 3600000)        intervalMs = 15 * 60000
  else if (spanMs <= 12 * 3600000)  intervalMs = 60 * 60000
  else if (spanMs <= 4 * 86400000)  intervalMs = 6 * 3600000
  else if (spanMs <= 14 * 86400000) intervalMs = 24 * 3600000
  else                               intervalMs = 7 * 86400000

  const first = Math.ceil(timeStart.value / intervalMs) * intervalMs
  for (let ts = first; ts <= timeEnd.value; ts += intervalMs) {
    const x = tsToX(ts)
    if (x < 0 || x > svgWidth.value) continue
    const d = new Date(ts)
    let label: string
    if (intervalMs < 3600000) label = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
    else if (intervalMs < 86400000) label = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:00`
    else label = `${d.getMonth() + 1}/${d.getDate()}`
    ticks.push({ ts, x, label })
  }
  return ticks
})

const nowX = computed(() => tsToX(Date.now()))

// === Tooltip ===
function showTooltip(e: MouseEvent, bar: any) {
  hoveredSession.value = bar.sessionId
  const svgRect = (e.target as SVGElement).closest('svg')?.getBoundingClientRect()
  if (!svgRect) return
  const x = e.clientX - (svgRect.left + (svgWrap.value?.scrollLeft || 0)) + 12
  const y = e.clientY - svgRect.top - 60
  tooltip.value = {
    visible: true,
    x: Math.min(x, svgWidth.value - 200),
    y: Math.max(y, 0),
    agentName: agentMeta.value[bar.agentId]?.name || bar.agentId,
    agentEmoji: agentMeta.value[bar.agentId]?.emoji || '🤖',
    startTime: formatTime(bar.startMs),
    endTime: bar.endTs ? formatTime(bar.endMs) : '进行中',
    duration: formatDuration(bar.durationMs / 1000),
    trigger: bar.trigger || 'user',
  }
}

function hideTooltip() {
  hoveredSession.value = null
  tooltip.value.visible = false
}

function onScroll() {
  tooltip.value.visible = false
}

// === Formatters ===
function formatTime(ms: number) {
  const d = new Date(ms)
  if (selectedHours.value <= 24) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatDuration(secs: number) {
  if (secs < 60) return `${Math.round(secs)}s`
  if (secs < 3600) return `${Math.round(secs / 60)}m`
  return `${(secs / 3600).toFixed(1)}h`
}

// === Lifecycle ===
watch(() => props.modelValue, async (val) => {
  // 弹窗模式：打开时加载数据
  if (!props.inline && val) {
    await loadAgentMeta()
    await fetchTimeline()
  }
})

onMounted(async () => {
  window.addEventListener('resize', updateSvgWidth)
  // 内联模式（Inline Mode）：挂载时立即加载数据
  if (props.inline) {
    await loadAgentMeta()
    await fetchTimeline()
  }
})

// 暴露 fetchTimeline 供父组件展开时触发
defineExpose({ fetchTimeline })
</script>

<style scoped>
.timeline-dialog :deep(.el-dialog__header) { padding: 16px 20px 0; }
.timeline-dialog :deep(.el-dialog__body) { padding: 0; }

/* ─── 弹窗 header ───────────────────────────────────────────────────────────── */
.tl-header { display: flex; flex-direction: column; gap: 4px; }
.tl-title-row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.tl-title { font-size: 16px; font-weight: 600; color: var(--text-primary); }
.tl-summary { font-size: 12px; color: rgba(255, 255, 255, 0.35); }

.tl-range-btns { display: flex; gap: 4px; }
.tl-range-btn {
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px; color: rgba(255,255,255,0.5); font-size: 12px;
  padding: 3px 10px; cursor: pointer; transition: all 0.15s; font-family: inherit;
}
.tl-range-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
.tl-range-btn.active {
  background: rgba(99,102,241,0.25); border-color: rgba(99,102,241,0.5); color: #a5b4fc;
}

/* ─── 图表正文 ───────────────────────────────────────────────────────────────── */
.tl-body { padding: 16px; min-height: 100px; }
.tl-body-inline { padding: 0 16px 12px; }

.tl-empty {
  display: flex; flex-direction: column; align-items: center;
  gap: 8px; padding: 40px 0; color: rgba(255,255,255,0.3); font-size: 14px;
}
.tl-empty-icon { font-size: 36px; }
.tl-empty-sub { font-size: 12px; color: rgba(255,255,255,0.2); }

.tl-chart-wrap { display: flex; gap: 0; overflow: hidden; }
.tl-lane-labels { display: flex; flex-direction: column; flex-shrink: 0; width: 80px; }
.tl-time-label-spacer { height: v-bind('TIME_AXIS_H + "px"'); flex-shrink: 0; }
.tl-lane-label { display: flex; align-items: center; gap: 4px; padding-right: 8px; flex-shrink: 0; overflow: hidden; }
.tl-lane-emoji { font-size: 15px; flex-shrink: 0; }
.tl-lane-name { font-size: 11px; color: rgba(255,255,255,0.5); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.tl-svg-wrap {
  flex: 1; overflow-x: auto; overflow-y: hidden; position: relative;
  border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; background: rgba(0,0,0,0.15);
}
.tl-svg { display: block; }
.tl-bar { cursor: pointer; transition: opacity 0.1s; }

.tl-tooltip {
  position: absolute; background: #1e1e2e;
  border: 1px solid rgba(255,255,255,0.12); border-radius: 8px;
  padding: 10px 12px; min-width: 180px; pointer-events: none; z-index: 10;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
}
.tl-tt-agent { font-size: 13px; font-weight: 600; color: #f1f5f9; margin-bottom: 6px; }
.tl-tt-time  { font-size: 12px; color: #94a3b8; }
.tl-tt-dur   { font-size: 12px; color: #94a3b8; }
.tl-tt-trigger { font-size: 11px; color: #64748b; margin-top: 4px; }

/* ─── 内联模式（Inline Mode）header ────────────────────────────────────────── */
.tl-inline-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 20px 6px; gap: 12px;
}
.tl-inline-left { display: flex; align-items: center; gap: 12px; }
.tl-inline-title { font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; }
.tl-inline-right { display: flex; align-items: center; gap: 8px; }
.tl-refresh-btn {
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px; color: rgba(255,255,255,0.4); font-size: 14px;
  width: 28px; height: 28px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; transition: all 0.15s;
}
.tl-refresh-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
</style>

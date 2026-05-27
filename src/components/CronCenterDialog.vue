<template>
  <el-dialog
    v-model="visible"
    title="⏰ Cron 任务中心"
    width="860px"
    :close-on-click-modal="true"
    class="cron-center-dialog"
    destroy-on-close
  >
    <!-- 工具栏 -->
    <div class="cc-toolbar">
      <div class="cc-toolbar-left">
        <el-input
          v-model="searchText"
          placeholder="搜索任务名称 / Agent..."
          clearable
          size="small"
          style="width: 220px"
        />
        <el-tag v-if="failJobs > 0" type="danger" size="small" effect="dark">
          ⚠️ {{ failJobs }} 个任务失败 ≥3 次
        </el-tag>
      </div>
      <el-button size="small" :loading="loading" @click="loadJobs">
        <el-icon><Refresh /></el-icon> 刷新
      </el-button>
    </div>

    <!-- 任务列表 -->
    <div class="cc-list" v-loading="loading">
      <div v-if="filteredJobs.length === 0 && !loading" class="cc-empty">
        <el-icon :size="32"><Timer /></el-icon>
        <span>暂无 Cron 任务</span>
      </div>

      <div
        v-for="job in filteredJobs"
        :key="job.id || job.name"
        class="cc-job-row"
        :class="{ 'cc-job-fail': (job.failCount || 0) >= 3, 'cc-job-paused': !isEnabled(job) }"
      >
        <!-- 左：名称 + agent + cron -->
        <div class="cc-job-main">
          <div class="cc-job-name-row">
            <span class="cc-job-fail-dot" v-if="(job.failCount || 0) >= 3">🔴</span>
            <span class="cc-job-paused-dot" v-else-if="!isEnabled(job)">⏸️</span>
            <span class="cc-job-ok-dot" v-else>🟢</span>
            <span class="cc-job-name">{{ job.name || job.id }}</span>
          </div>
          <div class="cc-job-meta">
            <el-tag size="small" type="info" effect="plain" class="cc-agent-tag">
              {{ job.agentId || job.agent || '叶溪' }}
            </el-tag>
            <span class="cc-cron-expr" :title="getCronExpr(job)">
              {{ parseCron(getCronExpr(job)) }}
            </span>
            <span class="cc-cron-raw mono">{{ getCronExpr(job) }}</span>
          </div>
        </div>

        <!-- 中：下次执行 + 最近状态 -->
        <div class="cc-job-middle">
          <div class="cc-next-run" v-if="job.nextRun || job.next_run || (job as any).nextRunAtMs">
            <el-icon :size="11"><Clock /></el-icon>
            <span>{{ formatNextRunMs((job as any).nextRunAtMs) || formatNextRun(job.nextRun || job.next_run) }}</span>
          </div>
          <div class="cc-last-status" v-if="job.lastRun">
            <el-tag
              size="small"
              :type="runStatusType(job.lastRun.status)"
              effect="plain"
            >
              {{ runStatusLabel(job.lastRun.status) }}
            </el-tag>
            <span class="cc-last-time">{{ formatRelativeTime(job.lastRun.startedAt || job.lastRun.start_time || job.lastRun.ts) }}</span>
          </div>
          <div class="cc-fail-count" v-if="(job.failCount || 0) >= 3">
            <el-icon :size="11"><WarningFilled /></el-icon>
            失败 {{ job.failCount }} 次
          </div>
        </div>

        <!-- 右：操作 -->
        <div class="cc-job-actions">
          <el-tooltip content="立即触发" placement="top">
            <el-button
              size="small"
              type="primary"
              :icon="VideoPlay"
              circle
              plain
              @click="triggerJob(job)"
              :loading="triggering === (job.id || job.name)"
            />
          </el-tooltip>
          <el-tooltip :content="!isEnabled(job) ? '恢复' : '暂停'" placement="top">
            <el-button
              size="small"
              :type="!isEnabled(job) ? 'success' : 'warning'"
              :icon="!isEnabled(job) ? CaretRight : VideoPause"
              circle
              plain
              @click="togglePause(job)"
              :loading="toggling === (job.id || job.name)"
            />
          </el-tooltip>
          <el-tooltip content="查看执行记录" placement="top">
            <el-button
              size="small"
              type="info"
              :icon="Document"
              circle
              plain
              @click="openHistory(job)"
            />
          </el-tooltip>
        </div>
      </div>
    </div>

    <!-- 执行记录弹窗 -->
    <el-dialog
      v-model="historyVisible"
      :title="`执行记录 — ${historyJob?.name || historyJob?.id || ''}`"
      width="600px"
      append-to-body
    >
      <div class="cc-history">
        <div v-if="!historyJob?.runs?.length" class="cc-history-empty">暂无执行记录</div>
        <div
          v-for="(run, i) in historyJob?.runs || []"
          :key="i"
          class="cc-history-row"
          :class="{ 'run-fail': run.status === 'error' || run.status === 'failed' }"
        >
          <el-tag
            size="small"
            :type="runStatusType(run.status)"
            effect="dark"
            style="min-width: 52px; text-align: center;"
          >
            {{ runStatusLabel(run.status) }}
          </el-tag>
          <span class="cc-history-time">{{ formatFullTime(run.startedAt || run.start_time || run.ts) }}</span>
          <span class="cc-history-dur" v-if="run.durationMs || run.duration_ms">
            {{ Math.round(((run.durationMs ?? run.duration_ms) as number) / 1000) }}s
          </span>
          <span class="cc-history-msg" v-if="run.error || run.message">
            {{ run.error || run.message }}
          </span>
        </div>
      </div>
    </el-dialog>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  Refresh, Timer, Clock, WarningFilled, VideoPlay, VideoPause, CaretRight, Document
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

const visible = defineModel<boolean>('visible', { default: false })

interface CronRun {
  status: string
  startedAt?: string
  start_time?: string
  ts?: string
  durationMs?: number
  duration_ms?: number
  error?: string
  message?: string
}

interface CronSchedule {
  kind?: string
  expr?: string
  everyMs?: number
  tz?: string
}

interface CronJob {
  id?: string
  name?: string
  agent?: string
  agentId?: string
  cron?: string
  schedule?: CronSchedule | string
  enabled?: boolean
  paused?: boolean
  status?: string
  nextRun?: string
  next_run?: string
  lastRun?: CronRun
  runs?: CronRun[]
  failCount?: number
}

const loading = ref(false)
const jobs = ref<CronJob[]>([])
const searchText = ref('')
const triggering = ref<string | null>(null)
const toggling = ref<string | null>(null)
const historyVisible = ref(false)
const historyJob = ref<CronJob | null>(null)

const failJobs = computed(() => jobs.value.filter(j => (j.failCount || 0) >= 3).length)

const filteredJobs = computed(() => {
  const q = searchText.value.toLowerCase()
  return jobs.value.filter(j => {
    if (!q) return true
    return (j.name || '').toLowerCase().includes(q) ||
           (j.id || '').toLowerCase().includes(q) ||
           (j.agent || j.agentId || '').toLowerCase().includes(q)
  })
})

// 获取 cron 表达式字符串（兼容 schedule.expr 和直接字符串）
function getCronExpr(job: CronJob): string {
  if (typeof job.schedule === 'object' && job.schedule?.expr) return job.schedule.expr
  if (typeof job.schedule === 'string') return job.schedule
  if (job.cron) return job.cron
  if (typeof job.schedule === 'object' && job.schedule?.kind === 'every') {
    const ms = job.schedule.everyMs || 0
    if (ms < 60_000) return `每 ${ms / 1000}s`
    if (ms < 3600_000) return `每 ${ms / 60_000}min`
    return `每 ${ms / 3600_000}h`
  }
  return ''
}

// 判断任务是否启用（enabled 字段，默认 true）
function isEnabled(job: CronJob): boolean {
  if (typeof job.enabled === 'boolean') return job.enabled
  if (job.paused) return false
  if (job.status === 'paused') return false
  return true
}

// cron 表达式解析为人类可读
function parseCron(expr: string | undefined): string {
  if (!expr) return ''
  const parts = expr.trim().split(/\s+/)
  if (parts.length < 5) return expr
  const [min, hour, day, month, week] = parts
  if (min === '0' && hour === '*/2' && day === '*' && month === '*' && week === '*') return '每 2 小时'
  if (min === '0' && hour === '*' && day === '*' && month === '*' && week === '*') return '每小时整点'
  if (min === '0' && hour === '0' && day === '*' && month === '*' && week === '*') return '每天凌晨'
  if (min === '3' && hour === '3' && day === '*' && month === '*' && week === '*') return '每天 03:03'
  if (min.startsWith('*/') && hour === '*' && day === '*') return `每 ${min.slice(2)} 分钟`
  if (hour.startsWith('*/') && day === '*') return `每 ${hour.slice(2)} 小时`
  if (day === '*' && month === '*' && week !== '*') {
    const weekDays = ['日','一','二','三','四','五','六']
    const weekIdx = parseInt(week)
    return `每周${(!isNaN(weekIdx) && weekDays[weekIdx]) ? weekDays[weekIdx] : week}`
  }
  if (min !== '*' && hour !== '*' && day === '*') return `每天 ${hour.padStart(2,'0')}:${min.padStart(2,'0')}`
  return expr
}

function formatNextRun(t: string | undefined): string {
  if (!t) return ''
  const d = new Date(t)
  if (isNaN(d.getTime())) return t
  const diff = d.getTime() - Date.now()
  if (diff < 0) return '即将执行'
  if (diff < 60_000) return `${Math.round(diff / 1000)}s 后`
  if (diff < 3600_000) return `${Math.round(diff / 60_000)}m 后`
  if (diff < 86400_000) return `${Math.round(diff / 3600_000)}h 后`
  return `${Math.round(diff / 86400_000)}d 后`
}

function formatNextRunMs(ms: number | undefined | null): string {
  if (!ms) return ''
  const diff = ms - Date.now()
  if (diff < 0) return '即将执行'
  if (diff < 60_000) return `${Math.round(diff / 1000)}s 后`
  if (diff < 3600_000) return `${Math.round(diff / 60_000)}m 后`
  if (diff < 86400_000) {
    const h = Math.floor(diff / 3600_000)
    const m = Math.floor((diff % 3600_000) / 60_000)
    return m > 0 ? `${h}h ${m}m 后` : `${h}h 后`
  }
  return `${Math.round(diff / 86400_000)}d 后`
}

function formatRelativeTime(t: string | undefined): string {
  if (!t) return ''
  const d = new Date(t)
  if (isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.round(diff / 60_000)}m 前`
  if (diff < 86400_000) return `${Math.round(diff / 3600_000)}h 前`
  return `${Math.round(diff / 86400_000)}d 前`
}

function formatFullTime(t: string | undefined): string {
  if (!t) return '—'
  const d = new Date(t)
  if (isNaN(d.getTime())) return t
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function runStatusType(status: string | undefined): 'success' | 'danger' | 'warning' | 'info' {
  switch ((status || '').toLowerCase()) {
    case 'success': case 'ok': case 'done': return 'success'
    case 'error': case 'failed': case 'fail': return 'danger'
    case 'running': case 'in_progress': return 'warning'
    default: return 'info'
  }
}

function runStatusLabel(status: string | undefined): string {
  switch ((status || '').toLowerCase()) {
    case 'success': case 'ok': return '成功'
    case 'done': return '完成'
    case 'error': case 'failed': case 'fail': return '失败'
    case 'running': case 'in_progress': return '执行中'
    default: return status || '未知'
  }
}

async function loadJobs() {
  loading.value = true
  try {
    const res = await fetch('/api/cron/list')
    if (res.ok) {
      const data = await res.json()
      jobs.value = data.jobs || []
    } else {
      ElMessage.error('加载 Cron 任务失败')
    }
  } catch {
    ElMessage.error('网络错误，无法加载 Cron 任务')
  } finally {
    loading.value = false
  }
}

async function triggerJob(job: CronJob) {
  const id = job.id || job.name
  if (!id) return
  triggering.value = id
  try {
    const res = await fetch('/api/cron/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) {
      ElMessage.success(`已触发：${job.name || id}`)
      setTimeout(loadJobs, 1500)
    } else {
      const err = await res.json().catch(() => ({}))
      ElMessage.error(err.error || '触发失败')
    }
  } catch {
    ElMessage.error('网络错误')
  } finally {
    triggering.value = null
  }
}

async function togglePause(job: CronJob) {
  const id = job.id || job.name
  if (!id) return
  const isPaused = !isEnabled(job)
  toggling.value = id
  try {
    const endpoint = isPaused ? '/api/cron/resume' : '/api/cron/pause'
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) {
      ElMessage.success(isPaused ? '已恢复' : '已暂停')
      setTimeout(loadJobs, 1000)
    } else {
      ElMessage.error(isPaused ? '恢复失败' : '暂停失败')
    }
  } catch {
    ElMessage.error('网络错误')
  } finally {
    toggling.value = null
  }
}

function openHistory(job: CronJob) {
  historyJob.value = job
  historyVisible.value = true
}

watch(visible, (val) => {
  if (val) loadJobs()
})
</script>

<style scoped>
.cron-center-dialog :deep(.el-dialog__body) {
  padding: 12px 16px;
}

/* 工具栏 */
.cc-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  gap: 8px;
}
.cc-toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 任务列表 */
.cc-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 560px;
  overflow-y: auto;
  min-height: 120px;
}
.cc-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 0;
  color: rgba(255,255,255,0.3);
  font-size: 13px;
}

/* 任务行 */
.cc-job-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 8px;
  transition: all 0.2s;
}
.cc-job-row:hover {
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.12);
}
.cc-job-row.cc-job-fail {
  border-left: 3px solid #ef4444;
  background: rgba(239,68,68,0.05);
}
.cc-job-row.cc-job-paused {
  opacity: 0.6;
  border-style: dashed;
}

/* 左：名称 + agent + cron */
.cc-job-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cc-job-name-row {
  display: flex;
  align-items: center;
  gap: 5px;
}
.cc-job-fail-dot, .cc-job-paused-dot, .cc-job-ok-dot {
  font-size: 10px;
  flex-shrink: 0;
}
.cc-job-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #e2e8f0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cc-job-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.cc-agent-tag { flex-shrink: 0; }
.cc-cron-expr {
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
}
.cc-cron-raw {
  font-size: 10px;
  color: rgba(255,255,255,0.25);
  font-family: 'Cascadia Code', monospace;
}

/* 中：下次执行 + 最近状态 */
.cc-job-middle {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-end;
  min-width: 120px;
}
.cc-next-run {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
}
.cc-last-status {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cc-last-time {
  font-size: 10px;
  color: rgba(255,255,255,0.35);
}
.cc-fail-count {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: #ef4444;
  font-weight: 600;
}

/* 右：操作 */
.cc-job-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

/* 执行记录 */
.cc-history {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 400px;
  overflow-y: auto;
}
.cc-history-empty {
  text-align: center;
  padding: 24px;
  color: rgba(255,255,255,0.35);
  font-size: 13px;
}
.cc-history-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.04);
  border-radius: 6px;
}
.cc-history-row.run-fail {
  background: rgba(239,68,68,0.05);
  border-color: rgba(239,68,68,0.2);
}
.cc-history-time {
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.cc-history-dur {
  font-size: 11px;
  color: rgba(255,255,255,0.35);
  flex-shrink: 0;
}
.cc-history-msg {
  font-size: 11px;
  color: #f87171;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mono { font-family: 'Cascadia Code', 'Fira Code', monospace; }
</style>

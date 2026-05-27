<template>
  <el-dialog
    v-model="visible"
    title="📋 项目看板"
    width="92vw"
    top="4vh"
    :close-on-click-modal="true"
    class="project-board-dialog"
    destroy-on-close
  >
    <!-- 工具栏 -->
    <div class="pb-toolbar">
      <div class="pb-toolbar-left">
        <el-input
          v-model="searchText"
          placeholder="搜索项目名称..."
          prefix-icon="Search"
          clearable
          size="small"
          style="width: 200px"
        />
        <el-tag
          v-for="col in columns"
          :key="col.id"
          class="pb-col-filter"
          :class="{ active: activeFilter === col.id }"
          size="small"
          effect="plain"
          :style="{ borderColor: col.color, color: col.color, cursor: 'pointer' }"
          @click="toggleFilter(col.id)"
        >
          {{ col.label }} ({{ getProjects(col.id).length }})
        </el-tag>
      </div>
      <el-button size="small" :loading="loading" @click="loadProjects">
        <el-icon><Refresh /></el-icon> 刷新
      </el-button>
    </div>

    <!-- 看板列 -->
    <div class="pb-board" v-loading="loading">
      <div
        v-for="col in visibleColumns"
        :key="col.id"
        class="pb-column"
        :style="{ '--col-color': col.color }"
      >
        <div class="pb-col-header">
          <span class="pb-col-icon">{{ col.icon }}</span>
          <span class="pb-col-label">{{ col.label }}</span>
          <el-badge :value="getProjects(col.id).length" :type="col.badgeType" class="pb-col-badge" />
        </div>

        <div class="pb-col-body">
          <div v-if="getProjects(col.id).length === 0" class="pb-empty">
            <span>{{ col.emptyText }}</span>
          </div>

          <div
            v-for="proj in getProjects(col.id)"
            :key="proj.id"
            class="pb-card"
            :class="getCardClass(proj)"
            @click="openDetail(proj)"
          >
            <!-- 卡片头 -->
            <div class="pb-card-header">
              <span class="pb-card-name">{{ proj.name }}</span>
              <el-tag size="small" :style="phaseTagStyle(proj.phase)" effect="dark" round>
                {{ proj.phase }}
              </el-tag>
            </div>

            <!-- 负责 agent -->
            <div v-if="proj.responsible_agent" class="pb-card-agent">
              <el-icon :size="12"><User /></el-icon>
              <span>{{ proj.responsible_agent }}</span>
            </div>

            <!-- 卡住时长 -->
            <div v-if="getStuckDuration(proj)" class="pb-card-stuck" :class="getStuckClass(proj)">
              <el-icon :size="12"><Clock /></el-icon>
              <span>{{ getStuckDuration(proj) }}</span>
            </div>

            <!-- 阻塞原因 -->
            <div v-if="proj.blocked_reason" class="pb-card-blocked">
              <el-icon :size="12"><Warning /></el-icon>
              <span class="pb-blocked-text">{{ proj.blocked_reason }}</span>
            </div>

            <!-- 重试次数警告 -->
            <div v-if="proj.retry_count >= 3" class="pb-card-retry">
              <el-icon :size="12"><RefreshRight /></el-icon>
              <span>已重试 {{ proj.retry_count }} 次</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 详情弹窗 -->
    <el-drawer
      v-model="detailVisible"
      :title="selectedProject?.name || '项目详情'"
      direction="rtl"
      size="500px"
      :append-to-body="true"
    >
      <div v-if="selectedProject" class="pb-detail">
        <!-- 基本信息 -->
        <div class="pb-detail-section">
          <div class="pb-detail-title">基本信息</div>
          <div class="pb-detail-row">
            <span class="pb-detail-key">项目 ID</span>
            <span class="pb-detail-val mono">{{ selectedProject.id }}</span>
          </div>
          <div class="pb-detail-row">
            <span class="pb-detail-key">当前阶段</span>
            <el-tag size="small" :style="phaseTagStyle(selectedProject.phase)" effect="dark" round>
              {{ selectedProject.phase }}
            </el-tag>
          </div>
          <div class="pb-detail-row" v-if="selectedProject.responsible_agent">
            <span class="pb-detail-key">负责 Agent</span>
            <span class="pb-detail-val">{{ selectedProject.responsible_agent }}</span>
          </div>
          <div class="pb-detail-row" v-if="selectedProject.retry_count">
            <span class="pb-detail-key">重试次数</span>
            <span class="pb-detail-val" :style="{ color: selectedProject.retry_count >= 3 ? '#ef4444' : 'inherit' }">
              {{ selectedProject.retry_count }}
            </span>
          </div>
          <div class="pb-detail-row" v-if="selectedProject.updated_at">
            <span class="pb-detail-key">最后更新</span>
            <span class="pb-detail-val">{{ formatTime(selectedProject.updated_at) }}</span>
          </div>
          <div class="pb-detail-row" v-if="selectedProject.blocked_reason">
            <span class="pb-detail-key">阻塞原因</span>
            <span class="pb-detail-val" style="color: #f59e0b;">{{ selectedProject.blocked_reason }}</span>
          </div>
        </div>

        <!-- 操作 -->
        <div class="pb-detail-section">
          <div class="pb-detail-title">操作</div>
          <el-button
            v-if="selectedProject.responsible_agent"
            size="small"
            type="primary"
            plain
            @click="atAgent(selectedProject)"
          >
            <el-icon><ChatDotRound /></el-icon>
            @ 负责人 {{ selectedProject.responsible_agent }}
          </el-button>
        </div>

        <!-- state.json 原始内容 -->
        <div class="pb-detail-section">
          <div class="pb-detail-title">state.json 原始数据</div>
          <pre class="pb-json-view">{{ JSON.stringify(selectedProject.raw, null, 2) }}</pre>
        </div>
      </div>
    </el-drawer>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Refresh, User, Warning, RefreshRight, Clock, ChatDotRound } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

const visible = defineModel<boolean>('visible', { default: false })

interface Project {
  id: string
  name: string
  phase: string
  responsible_agent: string | null
  blocked_reason: string | null
  retry_count: number
  updated_at: string | null
  created_at: string | null
  file_mtime: number
  raw: Record<string, unknown>
}

const loading = ref(false)
const projects = ref<Project[]>([])
const searchText = ref('')
const activeFilter = ref<string | null>(null)
const detailVisible = ref(false)
const selectedProject = ref<Project | null>(null)

// 列定义
const columns = [
  { id: 'pending',    label: '待启动',  icon: '🟡', color: '#94a3b8', badgeType: 'info'    as const, emptyText: '暂无待启动项目', phases: ['pending', 'waiting', 'init', '待启动'] },
  { id: 'in_progress',label: '进行中',  icon: '🔵', color: '#3b82f6', badgeType: 'primary' as const, emptyText: '暂无进行中项目', phases: ['in_progress', 'running', 'active', 'planning', 'developing', 'testing', '进行中'] },
  { id: 'blocked',    label: '阻塞',    icon: '🟠', color: '#f59e0b', badgeType: 'warning' as const, emptyText: '暂无阻塞项目', phases: ['blocked', 'paused', '阻塞'] },
  { id: 'done',       label: '已完成',  icon: '🟢', color: '#4caf50', badgeType: 'success' as const, emptyText: '暂无已完成项目', phases: ['done', 'completed', 'finished', '已完成'] },
  { id: 'archived',   label: '已归档',  icon: '⬛', color: '#6b7280', badgeType: 'info'    as const, emptyText: '暂无已归档项目', phases: ['archived', '已归档'] },
]

const visibleColumns = computed(() => {
  if (!activeFilter.value) return columns
  return columns.filter(c => c.id === activeFilter.value)
})

function toggleFilter(id: string) {
  activeFilter.value = activeFilter.value === id ? null : id
}

function mapPhaseToColumn(phase: string): string {
  const p = (phase || '').toLowerCase()
  for (const col of columns) {
    if (col.phases.some(ph => p.includes(ph.toLowerCase()) || ph.toLowerCase().includes(p))) {
      return col.id
    }
  }
  return 'in_progress' // 默认归入进行中
}

function getProjects(colId: string): Project[] {
  return projects.value.filter(proj => {
    const matchSearch = !searchText.value || proj.name.toLowerCase().includes(searchText.value.toLowerCase())
    const matchCol = mapPhaseToColumn(proj.phase) === colId
    return matchSearch && matchCol
  })
}

function getCardClass(proj: Project) {
  const classes: string[] = []
  const stuckMs = getStuckMs(proj)
  if (stuckMs > 24 * 3600_000) classes.push('card-critical')
  else if (stuckMs > 2 * 3600_000) classes.push('card-warning')
  if (proj.blocked_reason) classes.push('card-blocked')
  if (proj.retry_count >= 3) classes.push('card-retry-warn')
  return classes.join(' ')
}

function getStuckMs(proj: Project): number {
  if (!proj.updated_at) return 0
  const phase = mapPhaseToColumn(proj.phase)
  if (phase === 'done' || phase === 'archived') return 0
  const updatedMs = new Date(proj.updated_at).getTime()
  if (isNaN(updatedMs)) return 0
  return Date.now() - updatedMs
}

function getStuckDuration(proj: Project): string {
  const ms = getStuckMs(proj)
  if (ms < 2 * 3600_000) return ''
  const h = Math.floor(ms / 3600_000)
  if (h < 24) return `卡住 ${h}h`
  return `卡住 ${Math.floor(h / 24)}天${h % 24}h`
}

function getStuckClass(proj: Project): string {
  const ms = getStuckMs(proj)
  if (ms > 24 * 3600_000) return 'stuck-critical'
  if (ms > 2 * 3600_000) return 'stuck-warning'
  return ''
}

const phaseColors: Record<string, string> = {
  done: '#4caf50', completed: '#4caf50', finished: '#4caf50', 已完成: '#4caf50',
  archived: '#6b7280', 已归档: '#6b7280',
  blocked: '#f59e0b', paused: '#f59e0b', 阻塞: '#f59e0b',
  in_progress: '#3b82f6', running: '#3b82f6', active: '#3b82f6', developing: '#3b82f6', testing: '#3b82f6',
}

function phaseTagStyle(phase: string) {
  const p = (phase || '').toLowerCase()
  const color = Object.entries(phaseColors).find(([k]) => p.includes(k.toLowerCase()))?.[1] || '#64748b'
  return { background: color, borderColor: color }
}

function formatTime(t: string): string {
  if (!t) return '-'
  const d = new Date(t)
  if (isNaN(d.getTime())) return t
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function openDetail(proj: Project) {
  selectedProject.value = proj
  detailVisible.value = true
}

function atAgent(proj: Project) {
  if (!proj.responsible_agent) return
  ElMessage.info(`可在飞书群 @ ${proj.responsible_agent} 了解项目 "${proj.name}" 的进度`)
}

async function loadProjects() {
  loading.value = true
  try {
    const res = await fetch('/api/projects/list')
    if (res.ok) {
      const data = await res.json()
      projects.value = data.projects || []
    } else {
      ElMessage.error('加载项目列表失败')
    }
  } catch (e) {
    ElMessage.error('网络错误，无法加载项目')
  } finally {
    loading.value = false
  }
}

watch(visible, (val) => {
  if (val) loadProjects()
})
</script>

<style scoped>
.project-board-dialog :deep(.el-dialog__body) {
  padding: 12px 16px;
  overflow: hidden;
}

/* 工具栏 */
.pb-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  gap: 8px;
  flex-wrap: wrap;
}
.pb-toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.pb-col-filter {
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}
.pb-col-filter.active {
  opacity: 1;
  font-weight: 700;
}
.pb-col-filter:not(.active) {
  opacity: 0.5;
}
.pb-col-filter:hover {
  opacity: 1;
}

/* 看板 */
.pb-board {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  height: calc(80vh - 120px);
  min-height: 400px;
  padding-bottom: 8px;
}

.pb-column {
  flex: 0 0 220px;
  min-width: 180px;
  max-width: 260px;
  display: flex;
  flex-direction: column;
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.06);
  border-top: 3px solid var(--col-color, #64748b);
  border-radius: 8px;
  overflow: hidden;
}

.pb-col-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  background: rgba(255,255,255,0.03);
  border-bottom: 1px solid rgba(255,255,255,0.05);
  font-size: 13px;
  font-weight: 700;
}
.pb-col-label { color: var(--col-color, #e2e8f0); flex: 1; }
.pb-col-badge { flex-shrink: 0; }
.pb-col-icon { font-size: 14px; }

.pb-col-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pb-empty {
  text-align: center;
  padding: 24px 8px;
  color: rgba(255,255,255,0.25);
  font-size: 12px;
}

/* 卡片 */
.pb-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  padding: 10px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.pb-card:hover {
  background: rgba(255,255,255,0.08);
  border-color: var(--col-color, #64748b);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
}
.pb-card.card-warning { border-left: 3px solid #f59e0b; }
.pb-card.card-critical { border-left: 3px solid #ef4444; }
.pb-card.card-blocked { border-left: 3px solid #f59e0b; }
.pb-card.card-retry-warn { border-left: 3px solid #ef4444; }

.pb-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
}
.pb-card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #e2e8f0);
  line-height: 1.3;
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.pb-card-agent,
.pb-card-stuck,
.pb-card-blocked,
.pb-card-retry {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
}
.stuck-warning { color: #f59e0b; }
.stuck-critical { color: #ef4444; }
.pb-card-blocked { color: #f59e0b; }
.pb-card-retry { color: #ef4444; }
.pb-blocked-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
}

/* 详情 drawer */
.pb-detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.pb-detail-section {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 8px;
  padding: 12px;
}
.pb-detail-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary, #94a3b8);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}
.pb-detail-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  gap: 12px;
}
.pb-detail-row:last-child { border-bottom: none; }
.pb-detail-key {
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
  flex-shrink: 0;
}
.pb-detail-val {
  font-size: 12px;
  color: var(--text-primary, #e2e8f0);
  text-align: right;
  word-break: break-all;
}
.pb-detail-val.mono {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 11px;
}

.pb-json-view {
  background: rgba(0,0,0,0.3);
  border-radius: 6px;
  padding: 12px;
  font-size: 11px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  color: #a8c7fa;
  overflow: auto;
  max-height: 400px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}
</style>

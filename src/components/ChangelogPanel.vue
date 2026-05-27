<template>
  <!-- 内嵌版本历史面板（Changelog Panel — 版本迭代说明） -->
  <div class="cl-panel">
    <!-- 顶部工具栏 -->
    <div class="cl-toolbar">
      <div class="cl-toolbar-left">
        <span class="cl-count">共 {{ versions.length }} 个版本</span>
        <span class="cl-range">安装日期：{{ earliestDate }} · 最新：{{ versions[0]?.date || '-' }}</span>
      </div>
      <div class="cl-toolbar-right">
        <button class="cl-btn cl-btn-ghost" @click="fetchBackups" :disabled="loadingBackups" title="刷新备份列表">
          <span v-if="loadingBackups" class="cl-spin">⟳</span>
          <span v-else>🗄️ 备份（{{ backups.length }}）</span>
        </button>
        <button class="cl-btn cl-btn-ghost" @click="load" title="刷新版本列表">⟳ 刷新</button>
      </div>
    </div>

    <!-- 主内容：左侧版本列表 + 右侧功能详情 -->
    <div class="cl-body">
      <!-- 左侧版本时间线 -->
      <div class="cl-sidebar">
        <div
          v-for="v in versions"
          :key="v.version"
          class="cl-version-item"
          :class="{ active: selected?.version === v.version, current: v.version === currentVersion }"
          @click="selected = v"
        >
          <div class="cl-ver-dot" :class="v.version === currentVersion ? 'dot-current' : 'dot-normal'"></div>
          <div class="cl-ver-meta">
            <span class="cl-ver-num">v{{ v.version }}</span>
            <span v-if="v.version === currentVersion" class="cl-ver-badge">当前</span>
            <span class="cl-ver-tag">{{ v.tag }}</span>
          </div>
          <div class="cl-ver-date">{{ v.date }}</div>
          <div class="cl-ver-emoji">{{ v.emoji }}</div>
        </div>
      </div>

      <!-- 右侧版本详情 -->
      <div class="cl-detail" v-if="selected">
        <div class="cl-detail-header">
          <span class="cl-detail-emoji">{{ selected.emoji }}</span>
          <div class="cl-detail-title-wrap">
            <h3 class="cl-detail-title">v{{ selected.version }} · {{ selected.summary }}</h3>
            <div class="cl-detail-meta">
              <el-tag size="small" type="info" effect="plain">{{ selected.tag }}</el-tag>
              <span class="cl-detail-date">{{ selected.date }}</span>
              <el-tag v-if="selected.version === currentVersion" size="small" type="success" effect="light">当前版本</el-tag>
            </div>
          </div>
        </div>

        <ul class="cl-feature-list">
          <li v-for="(f, i) in selected.features" :key="i" class="cl-feature-item">
            <span class="cl-feature-dot">✦</span>
            <span class="cl-feature-text">{{ f }}</span>
          </li>
        </ul>

        <!-- 版本回退（Rollback）区域 -->
        <div v-if="selected.version !== currentVersion" class="cl-rollback-section">
          <div class="cl-rollback-header">
            <span class="cl-rollback-icon">↩️</span>
            <span class="cl-rollback-title">版本回退（Rollback）</span>
            <span class="cl-rollback-hint">出现问题时可恢复到该版本的 dist 备份</span>
          </div>

          <!-- 加载备份中 -->
          <div v-if="loadingBackups" class="cl-rollback-loading">
            <span class="cl-spin">⟳</span> 正在检查备份...
          </div>

          <!-- 有可用备份 -->
          <div v-else-if="backupsForSelected.length > 0" class="cl-backup-list">
            <div
              v-for="bk in backupsForSelected"
              :key="bk.path"
              class="cl-backup-item"
            >
              <div class="cl-backup-info">
                <span class="cl-backup-time">{{ bk.date }}</span>
                <span class="cl-backup-size">{{ bk.sizeDisplay }}</span>
                <span class="cl-backup-path">{{ bk.path }}</span>
              </div>
              <button
                class="cl-btn cl-btn-rollback"
                :disabled="rollingBack === bk.path"
                @click="rollback(bk)"
              >
                {{ rollingBack === bk.path ? '恢复中...' : '恢复此备份' }}
              </button>
            </div>
          </div>

          <!-- 无备份 -->
          <div v-else class="cl-no-backup">
            <span>暂无该版本备份</span>
            <span class="cl-no-backup-hint">每次服务启动时自动备份当前 dist，重启一次后即可看到备份</span>
          </div>
        </div>

        <!-- 当前版本提示 -->
        <div v-else class="cl-current-hint">
          <span>✅ 这是当前运行版本，无需回退</span>
          <span class="cl-current-sub">如需回退请选择左侧历史版本</span>
        </div>
      </div>

      <!-- 右侧空状态 -->
      <div class="cl-detail cl-detail-empty" v-else>
        <span class="cl-empty-icon">📋</span>
        <span class="cl-empty-text">点击左侧版本查看详情</span>
      </div>
    </div>

    <!-- 底部备份管理（所有备份一览）-->
    <div v-if="showAllBackups && backups.length > 0" class="cl-all-backups">
      <div class="cl-all-backups-header">
        <span>🗄️ 所有可用备份（All Backups）</span>
        <button class="cl-btn cl-btn-ghost" @click="showAllBackups = false">收起</button>
      </div>
      <div class="cl-all-backups-list">
        <div v-for="bk in backups" :key="bk.path" class="cl-backup-item">
          <div class="cl-backup-info">
            <span class="cl-backup-ver">v{{ bk.version }}</span>
            <span class="cl-backup-time">{{ bk.date }}</span>
            <span class="cl-backup-size">{{ bk.sizeDisplay }}</span>
          </div>
          <button
            class="cl-btn cl-btn-rollback"
            :disabled="rollingBack === bk.path"
            @click="rollback(bk)"
          >
            {{ rollingBack === bk.path ? '恢复中...' : '恢复' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import CHANGELOG from '../../public/changelog.json'

// ── 版本数据（Changelog Data）──
interface VersionEntry {
  version: string
  date: string
  tag: string
  emoji: string
  summary: string
  features: string[]
}

// ── 备份条目（Backup Item）──
interface BackupItem {
  path: string
  version: string
  date: string
  ts: number
  sizeDisplay: string
}

const versions = ref<VersionEntry[]>(CHANGELOG.versions as VersionEntry[])
const selected = ref<VersionEntry | null>(versions.value[0] || null)
const currentVersion = ref<string>('')
const backups = ref<BackupItem[]>([])
const loadingBackups = ref(false)
const rollingBack = ref<string | null>(null)
const showAllBackups = ref(false)

const earliestDate = computed(() =>
  versions.value.length > 0 ? versions.value[versions.value.length - 1].date : '-'
)

// 过滤出与当前选中版本匹配的备份
const backupsForSelected = computed(() => {
  if (!selected.value) return []
  return backups.value.filter(b => b.version === selected.value!.version)
})

// 加载当前 package.json 版本号
async function load() {
  try {
    // 从 APP_VERSION 全局变量获取当前版本（vite define 注入）
    if (typeof __APP_VERSION__ !== 'undefined') {
      currentVersion.value = __APP_VERSION__
    }
  } catch {
    currentVersion.value = ''
  }
  await fetchBackups()
}

// 获取所有备份列表
async function fetchBackups() {
  loadingBackups.value = true
  try {
    const resp = await fetch('/api/system/dist-backups')
    if (resp.ok) {
      const data = await resp.json()
      backups.value = (data.backups || []) as BackupItem[]
    }
  } catch {
    // 静默失败，备份列表为空
  } finally {
    loadingBackups.value = false
  }
}

// 执行回退（Rollback）
async function rollback(bk: BackupItem) {
  try {
    await ElMessageBox.confirm(
      `确认恢复到备份 v${bk.version}（${bk.date}）？\n\n当前版本的 dist 会被自动备份后替换。操作完成后需刷新页面。`,
      '确认版本回退',
      {
        confirmButtonText: '确认回退',
        cancelButtonText: '取消',
        type: 'warning',
        dangerouslyUseHTMLString: false,
      }
    )
    rollingBack.value = bk.path
    const resp = await fetch('/api/system/dist-rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupPath: bk.path }),
    })
    const result = await resp.json()
    if (result.ok) {
      ElMessage.success(`已成功恢复到 v${bk.version} 备份，3 秒后自动刷新页面...`)
      setTimeout(() => window.location.reload(), 3000)
    } else {
      ElMessage.error(result.error || '回退失败，请检查后端日志')
    }
  } catch (e: unknown) {
    if (e !== 'cancel') {
      ElMessage.error('回退请求失败')
    }
  } finally {
    rollingBack.value = null
  }
}

onMounted(load)

// 声明 vite 注入的全局变量（TypeScript 类型）
declare const __APP_VERSION__: string
</script>

<style scoped>
.cl-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
  background: transparent;
}

/* ── 工具栏 ── */
.cl-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px 8px;
  border-bottom: 1px solid var(--border-color);
}
.cl-toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}
.cl-count { font-weight: 600; color: var(--text-primary); }
.cl-range { opacity: 0.75; }
.cl-toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ── 按钮 ── */
.cl-btn {
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  padding: 4px 10px;
  transition: all 0.15s;
  background: rgba(255,255,255,0.06);
  color: var(--text-secondary);
}
.cl-btn:hover { background: rgba(255,255,255,0.12); color: var(--text-primary); }
.cl-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.cl-btn-ghost { background: transparent; border: 1px solid var(--border-color); }
.cl-btn-rollback {
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  color: #f59e0b;
  font-size: 11px;
  padding: 3px 10px;
  white-space: nowrap;
}
.cl-btn-rollback:hover {
  background: rgba(245, 158, 11, 0.2);
  border-color: #f59e0b;
}

/* ── 主体 ── */
.cl-body {
  display: flex;
  gap: 0;
  min-height: 280px;
  max-height: 380px;
}

/* ── 左侧版本列表 ── */
.cl-sidebar {
  width: 200px;
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid var(--border-color);
  padding: 8px 0;
}
.cl-sidebar::-webkit-scrollbar { width: 4px; }
.cl-sidebar::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 2px; }
.cl-sidebar::-webkit-scrollbar-track { background: transparent; }

.cl-version-item {
  display: grid;
  grid-template-columns: 14px 1fr auto auto;
  grid-template-rows: auto auto;
  align-items: center;
  gap: 4px 6px;
  padding: 7px 10px;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: all 0.15s;
  position: relative;
}
.cl-version-item:hover { background: rgba(255,255,255,0.04); }
.cl-version-item.active {
  background: rgba(139, 92, 246, 0.08);
  border-left-color: #8b5cf6;
}
.cl-version-item.current .cl-ver-num { color: #22c55e; }

.cl-ver-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  grid-row: 1;
  flex-shrink: 0;
}
.dot-current { background: #22c55e; box-shadow: 0 0 5px rgba(34,197,94,0.5); }
.dot-normal { background: rgba(255,255,255,0.2); }

.cl-ver-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  grid-row: 1;
}
.cl-ver-num { font-size: 13px; font-weight: 700; color: var(--text-primary); }
.cl-ver-badge {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(34,197,94,0.15);
  color: #22c55e;
  border: 1px solid rgba(34,197,94,0.3);
}
.cl-ver-date {
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.7;
  grid-column: 2;
  grid-row: 2;
}
.cl-ver-tag {
  font-size: 10px;
  color: var(--text-secondary);
  opacity: 0.6;
  grid-column: 3;
  grid-row: 1;
}
.cl-ver-emoji {
  font-size: 14px;
  grid-column: 4;
  grid-row: 1;
}

/* ── 右侧详情 ── */
.cl-detail {
  flex: 1;
  overflow-y: auto;
  padding: 14px 18px;
  min-width: 0;
}
.cl-detail::-webkit-scrollbar { width: 4px; }
.cl-detail::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 2px; }
.cl-detail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-secondary);
  opacity: 0.5;
}
.cl-empty-icon { font-size: 28px; }
.cl-empty-text { font-size: 13px; }

.cl-detail-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}
.cl-detail-emoji { font-size: 28px; flex-shrink: 0; }
.cl-detail-title-wrap { flex: 1; min-width: 0; }
.cl-detail-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 6px;
  line-height: 1.4;
}
.cl-detail-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cl-detail-date { font-size: 12px; color: var(--text-secondary); }

/* ── 功能列表 ── */
.cl-feature-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}
.cl-feature-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.5;
}
.cl-feature-dot { color: #8b5cf6; flex-shrink: 0; margin-top: 1px; font-size: 10px; }
.cl-feature-text { flex: 1; }

/* ── 回退区域 ── */
.cl-rollback-section {
  background: rgba(245, 158, 11, 0.05);
  border: 1px solid rgba(245, 158, 11, 0.15);
  border-radius: 8px;
  padding: 12px;
  margin-top: 4px;
}
.cl-rollback-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.cl-rollback-icon { font-size: 16px; }
.cl-rollback-title { font-size: 13px; font-weight: 600; color: #f59e0b; }
.cl-rollback-hint { font-size: 11px; color: var(--text-secondary); flex: 1; }

.cl-rollback-loading {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  padding: 6px 0;
}
.cl-no-backup {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  padding: 4px 0;
}
.cl-no-backup-hint { font-size: 11px; opacity: 0.7; }

.cl-backup-list { display: flex; flex-direction: column; gap: 6px; }
.cl-backup-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 6px;
}
.cl-backup-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  font-size: 12px;
}
.cl-backup-ver { font-weight: 600; color: var(--text-primary); }
.cl-backup-time { color: var(--text-secondary); }
.cl-backup-size { color: var(--text-secondary); opacity: 0.7; font-size: 11px; }
.cl-backup-path {
  color: var(--text-secondary);
  opacity: 0.5;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}

/* 当前版本提示 */
.cl-current-hint {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  background: rgba(34,197,94,0.06);
  border: 1px solid rgba(34,197,94,0.15);
  border-radius: 8px;
  font-size: 13px;
  color: #22c55e;
}
.cl-current-sub { font-size: 11px; color: var(--text-secondary); }

/* ── 全部备份面板 ── */
.cl-all-backups {
  border-top: 1px solid var(--border-color);
  padding: 10px 16px;
}
.cl-all-backups-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}
.cl-all-backups-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 160px;
  overflow-y: auto;
}

/* ── 旋转动画 ── */
.cl-spin {
  display: inline-block;
  animation: cl-rotate 1s linear infinite;
}
@keyframes cl-rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>

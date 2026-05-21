<template>
  <el-dialog
    v-model="dialogVisible"
    title="OpenClaw 版本管理"
    width="700px"
    :close-on-click-modal="false"
    destroy-on-close
    class="version-dialog"
    :modal-class="'version-dialog-modal'"
  >
    <div class="dialog-header">
      <el-button type="primary" :icon="Refresh" :loading="syncing" @click="handleSync">
        同步版本
      </el-button>
      <span v-if="lastSync" class="last-sync">上次同步：{{ formatLocalTime(lastSync) }}</span>
      <span v-else class="last-sync">尚未同步</span>
    </div>

    <!-- 版本切换进度提示 -->
    <div v-if="switching" class="switch-progress-bar">
      <el-icon class="is-loading" :size="16"><Loading /></el-icon>
      <span class="switch-progress-text">{{ switchProgress || '正在切换版本...' }}</span>
    </div>

    <el-table
      ref="tableRef"
      :data="versions"
      v-loading="loading"
      :height="tableMaxHeight"
      empty-text="暂无版本数据"
      :header-cell-style="{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }"
    >
      <el-table-column prop="version" label="版本号" min-width="180">
        <template #default="{ row }">
          <span class="version-cell version-click" :title="row.version" @click="handleVersionClick(row)">{{ row.version }}
          </span>
        </template>
      </el-table-column>

      <el-table-column prop="publishedAt" label="发布时间" width="170">
        <template #default="{ row }">
          {{ formatDate(row.publishedAt) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100" align="center" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="row.version === props.currentVersion"
            size="small"
            disabled
            type="primary"
          >
            当前版本
          </el-button>
          <el-button
            v-else
            size="small"
            type="primary"
            :loading="switching === row.version"
            :disabled="switching !== null"
            @click="handleSwitch(row.version)"
          >
            {{ switching === row.version ? '切换中...' : '切换' }}
          </el-button>
        </template>
      </el-table-column>

      <!-- 加载更多指示器（放在表格内部 append 插槽） -->
      <template #append>
        <div v-if="!loading && versions.length > 0" class="load-more-footer">
          <span v-if="moreLoading" class="loading-more">
            <el-icon class="is-loading" :size="14"><Loading /></el-icon>
            加载中...
          </span>
          <span v-else-if="!hasMore" class="no-more">没有更多数据了</span>
        </div>
      </template>
    </el-table>

    <!-- 版本详情弹框 -->
    <el-dialog
      v-model="detailVisible"
      :title="selectedVersion?.version ?? ''"
      width="600px"
      :close-on-click-modal="false"
      destroy-on-close
      class="version-detail-dialog"
      :modal-class="'version-dialog-modal'"
    >
      <div v-if="selectedVersion" class="detail-content-wrapper">
        <div class="detail-content">
          <div class="detail-meta">
            <span class="detail-meta-item">发布时间：{{ formatDate(selectedVersion.publishedAt) }}</span>
          </div>
          <div class="detail-description" v-html="renderedDescription"></div>
        </div>
      </div>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="detailVisible = false">关闭</el-button>
        </div>
      </template>
    </el-dialog>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { Refresh, Loading } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getVersions, syncVersions, switchVersion, type VersionInfo } from '../api/version-manager'
import { marked } from 'marked'

marked.setOptions({ breaks: true })

const props = withDefaults(defineProps<{
  visible: boolean
  currentVersion?: string
}>(), {
  currentVersion: ''
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const dialogVisible = computed({
  get: () => props.visible,
  set: (val: boolean) => emit('update:visible', val),
})

const versions = ref<VersionInfo[]>([])
const loading = ref(false)
const moreLoading = ref(false)
const syncing = ref(false)
const switching = ref<string | null>(null)
const switchProgress = ref('')
const lastSync = ref<string | null>(null)
const currentPage = ref(1)
const pageSize = 10
const hasMore = ref(true)
const tableRef = ref()
const tableMaxHeight = ref(500)
let scrollTimer: ReturnType<typeof setTimeout> | null = null
let tableBodyWrapper: HTMLElement | null = null

// 版本详情弹框状态
const detailVisible = ref(false)
const selectedVersion = ref<VersionInfo | null>(null)
const renderedDescription = computed(() => {
  if (!selectedVersion.value?.description) return '<p class="no-description">暂无版本说明</p>'
  return marked.parse(selectedVersion.value.description as string)
})

// 计算表格高度
function calculateTableHeight(): void {
  const dialog = document.querySelector('.version-dialog .el-dialog__body')
  if (!dialog) {
    tableMaxHeight.value = 500
    return
  }
  const bodyHeight = (dialog as HTMLElement).clientHeight
  // 减去 dialog-header(约 40px)、padding(上下 40px)、底部加载更多(40px)
  tableMaxHeight.value = Math.max(250, bodyHeight - 40 - 40 - 40)
}

// 表格滚动事件：触底加载下一页
function handleTableScroll(e: Event): void {
  if (scrollTimer !== null) clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => {
    const target = e.target as HTMLElement
    if (!target) return
    const scrollTop = target.scrollTop
    const scrollHeight = target.scrollHeight
    const clientHeight = target.clientHeight
    // 距底部 80px 时触发加载
    if (scrollTop + clientHeight >= scrollHeight - 80) {
      loadMoreVersions()
    }
    scrollTimer = null
  }, 150)
}

// 加载第一页
async function loadVersions(): Promise<void> {
  loading.value = true
  versions.value = []
  currentPage.value = 1
  hasMore.value = true
  try {
    const data = await getVersions(1, pageSize)
    versions.value = data.versions || []
    lastSync.value = data.lastSync
    hasMore.value = (data.total || 0) > pageSize
  } catch {
    ElMessage.error('获取版本列表失败')
  } finally {
    loading.value = false
  }
}

// 加载更多（追加）
async function loadMoreVersions(): Promise<void> {
  if (moreLoading.value || !hasMore.value || loading.value) return
  moreLoading.value = true
  currentPage.value += 1
  try {
    const data = await getVersions(currentPage.value, pageSize)
    if (data.versions && data.versions.length > 0) {
      versions.value = [...versions.value, ...data.versions]
      hasMore.value = (data.total || 0) > versions.value.length
    } else {
      hasMore.value = false
      currentPage.value -= 1
    }
  } catch {
    ElMessage.error('加载更多版本失败')
    currentPage.value -= 1
  } finally {
    moreLoading.value = false
  }
}

async function handleSync(): Promise<void> {
  syncing.value = true
  try {
    const result = await syncVersions()
    if (result.success) {
      ElMessage.success(`同步成功，共 ${result.count} 个版本（来源：${result.source}）`)
      await loadVersions()
    } else {
      ElMessage.error('同步失败')
    }
  } catch {
    ElMessage.error('同步请求失败')
  } finally {
    syncing.value = false
  }
}

async function handleSwitch(version: string): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认切换到版本 ${version}？切换后网关将自动重启，Dashboard 会短暂断开。`,
      '确认切换版本',
      { confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning' }
    )

    switching.value = version
    switchProgress.value = '正在安装 openclaw@' + version + '...'

    const result = await switchVersion(version)
    if (result.success) {
      if (result.restarted) {
        // 网关已重启，前端显示重连提示
        ElMessage.success(result.message || '版本切换成功，网关已重启')
        // 等待连接恢复后刷新列表
        setTimeout(async () => {
          try {
            await loadVersions()
          } catch {
            ElMessage.info('Dashboard 正在重连，请稍后刷新')
          }
        }, 3000)
      } else {
        ElMessage.success(result.message || '切换成功')
        await loadVersions()
      }
    } else {
      ElMessage.error(result.error || result.message || '切换失败')
    }
  } catch (err: unknown) {
    if (err !== 'cancel') {
      ElMessage.error('切换请求失败')
    }
  } finally {
    switching.value = null
    switchProgress.value = ''
  }
}

// 点击版本号 → 弹详情框
function handleVersionClick(row: VersionInfo): void {
  selectedVersion.value = row
  detailVisible.value = true
}

function formatLocalTime(timeStr: string): string {
  if (!timeStr) return '-'
  try {
    const d = new Date(timeStr)
    const Y = d.getFullYear()
    const M = String(d.getMonth() + 1).padStart(2, '0')
    const D = String(d.getDate()).padStart(2, '0')
    const h = String(d.getHours()).padStart(2, '0')
    const m = String(d.getMinutes()).padStart(2, '0')
    const s = String(d.getSeconds()).padStart(2, '0')
    return `${Y}-${M}-${D} ${h}:${m}:${s}`
  } catch {
    return timeStr
  }
}

function formatDescription(desc: string | undefined | null): string {
  if (!desc || typeof desc !== 'string' || desc.trim() === '') return '-'
  return desc.replace(/\n+/g, ' ').trim().substring(0, 80)
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '-'
  try {
    const d = new Date(dateStr)
    const Y = d.getFullYear()
    const M = String(d.getMonth() + 1).padStart(2, '0')
    const D = String(d.getDate()).padStart(2, '0')
    const h = String(d.getHours()).padStart(2, '0')
    const m = String(d.getMinutes()).padStart(2, '0')
    return `${Y}-${M}-${D} ${h}:${m}`
  } catch {
    return dateStr
  }
}

// 窗口大小变化时重新计算高度
function handleResize(): void {
  calculateTableHeight()
}

watch(() => props.visible, async (val) => {
  if (val) {
    await nextTick()
    await nextTick()
    calculateTableHeight()
    loadVersions()
    window.addEventListener('resize', handleResize)
    // 绑定表格内部滚动事件
    tableBodyWrapper = tableRef.value?.$el?.querySelector('.el-table__body-wrapper') as HTMLElement | null
    tableBodyWrapper?.addEventListener('scroll', handleTableScroll)
  } else {
    window.removeEventListener('resize', handleResize)
    tableBodyWrapper?.removeEventListener('scroll', handleTableScroll)
    tableBodyWrapper = null
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  tableBodyWrapper?.removeEventListener('scroll', handleTableScroll)
  tableBodyWrapper = null
  if (scrollTimer !== null) {
    clearTimeout(scrollTimer)
    scrollTimer = null
  }
})
</script>

<style scoped>
.dialog-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.last-sync {
  font-size: 13px;
  color: var(--text-secondary, #9ca3af);
}

/* 版本切换进度条 */
.switch-progress-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  margin-bottom: 16px;
  background: var(--bg-elevated);
  border-radius: 8px;
  border: 1px solid var(--border-color);
}

.switch-progress-text {
  font-size: 13px;
  color: var(--text-primary);
}

.desc-cell {
  display: inline-block;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
}

/* 版本号单元格：单行完整显示，不截断 */
.version-cell {
  display: inline-block;
  white-space: nowrap;
  vertical-align: middle;
}

/* 版本号点击样式 */
.version-click {
  cursor: pointer;
  color: var(--accent, #38bdf8);
  transition: opacity 0.2s;
}

.version-click:hover {
  opacity: 0.8;
  text-decoration: underline;
}

/* 加载更多底部提示 */
.load-more-footer {
  text-align: center;
  padding: 12px 0 4px;
  font-size: 13px;
  color: var(--text-secondary, #9ca3af);
}

.loading-more {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.no-more {
  opacity: 0.7;
}

/* ── 版本详情弹框样式 ── */
.detail-content-wrapper {
  display: flex;
  flex-direction: column;
  min-height: 0; /* 允许 flex 子元素缩小 */
}

.detail-content {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
  min-height: 0; /* 允许 flex 子元素缩小 */
}

.detail-meta {
  margin-bottom: 16px;
  font-size: 13px;
  color: var(--text-secondary, #9ca3af);
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}

.detail-meta-item {
  display: inline-block;
}

.detail-description {
  line-height: 1.8;
  font-size: 14px;
  color: var(--text-primary);
  word-break: break-word;
  height: 50vh;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}

.detail-description :deep(h1),
.detail-description :deep(h2),
.detail-description :deep(h3) {
  margin-top: 16px;
  margin-bottom: 8px;
  color: var(--text-primary);
}

.detail-description :deep(h1):first-child,
.detail-description :deep(h2):first-child,
.detail-description :deep(h3):first-child {
  margin-top: 0;
}

.detail-description :deep(p) {
  margin-bottom: 12px;
}

.detail-description :deep(ul),
.detail-description :deep(ol) {
  padding-left: 24px;
  margin-bottom: 12px;
}

.detail-description :deep(li) {
  margin-bottom: 4px;
}

.detail-description :deep(code) {
  background: var(--bg-elevated);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
}

.detail-description :deep(pre) {
  background: var(--bg-elevated);
  padding: 12px 16px;
  border-radius: 8px;
  overflow-x: auto;
  margin-bottom: 12px;
}

.detail-description :deep(pre code) {
  background: none;
  padding: 0;
}

.detail-description :deep(blockquote) {
  border-left: 3px solid var(--accent, #38bdf8);
  padding-left: 12px;
  color: var(--text-secondary, #9ca3af);
  margin-bottom: 12px;
}

.detail-description :deep(a) {
  color: var(--accent, #38bdf8);
  text-decoration: none;
}

.detail-description :deep(a):hover {
  text-decoration: underline;
}

.detail-description :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin-bottom: 12px;
}

.detail-description :deep(th),
.detail-description :deep(td) {
  border: 1px solid var(--border-color);
  padding: 8px 12px;
  text-align: left;
}

.detail-description :deep(th) {
  background: var(--bg-elevated);
}

.no-description {
  color: var(--text-secondary, #9ca3af);
  font-style: italic;
}

/* ── 弹框样式：与抽屉一致的深色背景 (--bg-card) ── */
:deep(.version-dialog.el-dialog),
:deep(.version-detail-dialog.el-dialog) {
  background-color: var(--bg-card) !important;
  border: 1px solid var(--border-color) !important;
  border-radius: 12px !important;
}

:deep(.version-dialog .el-dialog__header),
:deep(.version-detail-dialog .el-dialog__header) {
  background-color: var(--bg-card) !important;
  border-bottom: 1px solid var(--border-color) !important;
  padding: 16px 20px !important;
  margin-right: 0 !important;
}

:deep(.version-dialog .el-dialog__title),
:deep(.version-detail-dialog .el-dialog__title) {
  color: var(--text-primary) !important;
}

:deep(.version-dialog .el-dialog__body) {
  background-color: var(--bg-card) !important;
  padding: 20px !important;
  color: var(--text-primary) !important;
  min-height: 90vh !important;
  max-height: 95vh !important;
  overflow: hidden !important;
}

:v-deep(.version-detail-dialog .el-dialog__body) {
  background-color: var(--bg-card) !important;
  padding: 20px !important;
  color: var(--text-primary) !important;
  max-height: 80vh !important;
  overflow: hidden !important;
}

:deep(.version-dialog .el-dialog__close),
:deep(.version-detail-dialog .el-dialog__close) {
  color: var(--text-primary) !important;
}

:deep(.version-dialog .el-dialog__close):hover,
:deep(.version-detail-dialog .el-dialog__close):hover {
  color: var(--accent, #38bdf8) !important;
}

/* 弹框遮罩层 */
.version-dialog-modal {
  background-color: rgba(0, 0, 0, 0.5);
}

/* 表格样式：无斑马纹，数据行无背景色 */
:deep(.version-dialog .el-table),
:deep(.version-detail-dialog .el-table) {
  --el-table-border-color: var(--border-color) !important;
  --el-table-bg-color: transparent !important;
  --el-table-tr-bg-color: transparent !important;
  --el-table-header-bg-color: var(--bg-elevated) !important;
  --el-table-text-color: var(--text-primary) !important;
  --el-table-header-text-color: var(--text-secondary) !important;
  --el-table-row-hover-bg-color: var(--bg-elevated) !important;
}

:deep(.version-dialog .el-table::before),
:deep(.version-dialog .el-table::after),
:deep(.version-detail-dialog .el-table::before),
:deep(.version-detail-dialog .el-table::after) {
  background-color: var(--border-color);
}

/* 固定表头：表格滚动条隐藏 */
:deep(.el-table__body-wrapper) {
  overflow-y: auto !important;
}

:deep(.el-table__body-wrapper::-webkit-scrollbar) {
  width: 6px;
}

:deep(.el-table__body-wrapper::-webkit-scrollbar-thumb) {
  background: var(--border-color);
  border-radius: 3px;
}

:deep(.el-table__body-wrapper::-webkit-scrollbar-track) {
  background: transparent;
}
</style>

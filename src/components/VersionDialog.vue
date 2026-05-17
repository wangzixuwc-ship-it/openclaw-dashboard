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
      <span v-if="lastSync" class="last-sync">上次同步：{{ lastSync }}</span>
      <span v-else class="last-sync">尚未同步</span>
    </div>

    <div ref="scrollContainerRef" class="table-scroll-container" @scroll="handleScroll">
      <el-table
        :data="versions"
        v-loading="loading"
        style="width: 100%"
        empty-text="暂无版本数据"
        :header-cell-style="{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }"
      >
        <el-table-column prop="version" label="版本号" width="140" />
        <el-table-column prop="description" label="版本说明" show-overflow-tooltip min-width="200">
          <template #default="{ row }">
            <span class="desc-cell">{{ formatDescription(row.description) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="publishedAt" label="发布时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.publishedAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" align="center">
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
              @click="handleSwitch(row.version)"
            >
              切换
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 加载更多指示器 -->
      <div v-if="!loading && versions.length > 0" class="load-more-footer">
        <span v-if="moreLoading" class="loading-more">
          <el-icon class="is-loading" :size="14"><Loading /></el-icon>
          加载中...
        </span>
        <span v-else-if="!hasMore" class="no-more">没有更多数据了</span>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { Refresh, Loading } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getVersions, syncVersions, switchVersion, type VersionInfo } from '../api/version-manager'

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
const lastSync = ref<string | null>(null)
const currentPage = ref(1)
const pageSize = 10
const hasMore = ref(true)
const scrollContainerRef = ref<HTMLElement | null>(null)
const containerHeight = ref(0)
let scrollTimer: ReturnType<typeof setTimeout> | null = null

// 计算滚动容器高度（弹框可用高度 - 顶部操作栏 - padding）
function calculateContainerHeight(): void {
  const el = scrollContainerRef.value?.parentElement
  if (!el) return
  const parentHeight = el.clientHeight
  // 减去 dialog-header(约 40px)、padding(上下各 20px)、底部预留(20px)
  containerHeight.value = Math.max(200, parentHeight - 40 - 40 - 20)
}

// 滚动事件处理：150ms 防抖后触底加载下一页
function handleScroll(e: Event): void {
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
      currentPage.value -= 1 // 回退页码
    }
  } catch {
    ElMessage.error('加载更多版本失败')
    currentPage.value -= 1 // 回退页码
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
      `确认切换到版本 ${version}？切换后请重启网关生效。`,
      '确认切换版本',
      { confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning' }
    )

    const result = await switchVersion(version)
    if (result.success) {
      ElMessage.success(`切换成功，请重启网关生效`)
      await loadVersions()
    } else {
      ElMessage.error(result.error || result.message || '切换失败')
    }
  } catch (err: unknown) {
    if (err !== 'cancel') {
      ElMessage.error('切换请求失败')
    }
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
  calculateContainerHeight()
}

watch(() => props.visible, async (val) => {
  if (val) {
    await nextTick()
    await nextTick() // 等 dialog 动画/布局完成
    calculateContainerHeight()
    loadVersions()
    window.addEventListener('resize', handleResize)
  } else {
    window.removeEventListener('resize', handleResize)
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
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

.desc-cell {
  display: inline-block;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
}

/* 滚动容器：固定高度，overflow-y auto */
.table-scroll-container {
  height: v-bind(containerHeight + 'px');
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 500px;
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

/* ── 弹框样式：与抽屉一致的深色背景 (--bg-card) ── */
:deep(.version-dialog.el-dialog) {
  background-color: var(--bg-card) !important;
  border: 1px solid var(--border-color) !important;
  border-radius: 12px !important;
}

:deep(.version-dialog .el-dialog__header) {
  background-color: var(--bg-card) !important;
  border-bottom: 1px solid var(--border-color) !important;
  padding: 16px 20px !important;
  margin-right: 0 !important;
}

:deep(.version-dialog .el-dialog__title) {
  color: var(--text-primary) !important;
}

:deep(.version-dialog .el-dialog__body) {
  background-color: var(--bg-card) !important;
  padding: 20px !important;
  color: var(--text-primary) !important;
  max-height: 80vh !important;
  overflow: hidden !important;
}

:deep(.version-dialog .el-dialog__close) {
  color: var(--text-primary) !important;
}

:deep(.version-dialog .el-dialog__close):hover {
  color: var(--accent, #38bdf8) !important;
}

/* 弹框遮罩层 */
.version-dialog-modal {
  background-color: rgba(0, 0, 0, 0.5);
}

/* 表格样式：无斑马纹，数据行无背景色 */
:deep(.version-dialog .el-table) {
  --el-table-border-color: var(--border-color) !important;
  --el-table-bg-color: transparent !important;
  --el-table-tr-bg-color: transparent !important;
  --el-table-header-bg-color: var(--bg-elevated) !important;
  --el-table-text-color: var(--text-primary) !important;
  --el-table-header-text-color: var(--text-secondary) !important;
  --el-table-row-hover-bg-color: var(--bg-elevated) !important;
}

:deep(.version-dialog .el-table::before),
:deep(.version-dialog .el-table::after) {
  background-color: var(--border-color);
}
</style>

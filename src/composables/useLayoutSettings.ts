import { ref, watch } from 'vue'

// ── 默认顺序（version/gateway/notif 固定在顶栏，不参与功能区排列）──
const DEFAULT_STATUS_BAR: string[] = [
  'gpu',         // GPU 显存（条件显示）
  'fileManager', // 文件管理
  'billing',     // 计费配置
  'skills',      // 技能库
  'webui',       // WebUI
  'projects',    // 项目看板
  'cron',        // Cron 任务中心
]

const DEFAULT_STATS_CARDS: string[] = [
  'total',    // 总计
  'running',  // 运行中
  'idle',     // 空闲
  'aborted',  // 已终止
  'error',    // 错误
  'uptime',   // 本次运行时间
  'tokens',   // 历史消耗 Token
  'cost',     // 本次运行费用
]

const STORAGE_KEY = 'openclaw_dashboard_layout_v1'

interface LayoutConfig {
  statusBar: string[]
  statsCards: string[]
}

function loadFromStorage(): LayoutConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { statusBar: [...DEFAULT_STATUS_BAR], statsCards: [...DEFAULT_STATS_CARDS] }
    const parsed = JSON.parse(raw)
    // 校验：清洗未知 ID + 补齐缺失 ID（防止新增功能时找不到）
    const sb = mergeWithDefault(parsed.statusBar, DEFAULT_STATUS_BAR)
    const sc = mergeWithDefault(parsed.statsCards, DEFAULT_STATS_CARDS)
    return { statusBar: sb, statsCards: sc }
  } catch {
    return { statusBar: [...DEFAULT_STATUS_BAR], statsCards: [...DEFAULT_STATS_CARDS] }
  }
}

function mergeWithDefault(saved: string[] | undefined, defaults: string[]): string[] {
  if (!Array.isArray(saved)) return [...defaults]
  const validSet = new Set(defaults)
  const result = saved.filter(id => validSet.has(id))
  // 补齐 defaults 中有但 saved 没有的
  for (const id of defaults) {
    if (!result.includes(id)) result.push(id)
  }
  return result
}

const config = ref<LayoutConfig>(loadFromStorage())
const editMode = ref(false)

// 持久化
watch(config, (val) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(val))
  } catch (e) {
    console.warn('[layout] save failed:', e)
  }
}, { deep: true })

function setStatusBarOrder(order: string[]) {
  config.value.statusBar = mergeWithDefault(order, DEFAULT_STATUS_BAR)
}

function setStatsCardsOrder(order: string[]) {
  config.value.statsCards = mergeWithDefault(order, DEFAULT_STATS_CARDS)
}

function resetToDefault() {
  config.value = { statusBar: [...DEFAULT_STATUS_BAR], statsCards: [...DEFAULT_STATS_CARDS] }
}

function toggleEditMode() {
  editMode.value = !editMode.value
}

export function useLayoutSettings() {
  return {
    config,
    editMode,
    setStatusBarOrder,
    setStatsCardsOrder,
    resetToDefault,
    toggleEditMode,
    DEFAULT_STATUS_BAR,
    DEFAULT_STATS_CARDS,
  }
}

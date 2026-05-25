<template>
  <el-dialog
    v-model="dialogVisible"
    title="OpenClaw 技能列表"
    width="80vh"
    :close-on-click-modal="false"
    destroy-on-close
    class="skills-dialog"
    :modal-class="'skills-dialog-modal'"
    top="5vh"
  >
    <!-- 顶部统计栏 -->
    <div v-if="skillsData" class="skills-stats-bar">
      <div class="stats-item">
        <span class="stats-label">全部技能</span>
        <span class="stats-value">{{ skillsData.total }}</span>
      </div>
      <div class="stats-divider" />
      <div class="stats-item">
        <span class="stats-label">已就绪</span>
        <span class="stats-value stats-ready">{{ skillsData.ready }}</span>
      </div>
      <el-button
        v-if="skillsData.skills.length > 0"
        class="refresh-skills-btn"
        :icon="Refresh"
        circle
        size="small"
        @click="fetchSkills"
        :loading="loading"
      />
    </div>

    <!-- 加载状态 -->
    <div v-if="loading && !skillsData" class="skills-loading">
      <el-icon :size="24" class="is-loading"><Loading /></el-icon>
      <span>加载技能列表...</span>
    </div>

    <!-- Tab 标签页 (REC-006) -->
    <el-tabs v-else-if="skillsData?.skills.length" v-model="activeTab" class="skills-tabs">
      <el-tab-pane name="activated">
        <template #label>
          <span>已激活</span>
          <el-tag size="small" type="success" class="tab-count">{{ activatedSkills.length }}</el-tag>
        </template>
      </el-tab-pane>
      <el-tab-pane name="deactivated">
        <template #label>
          <span>未激活</span>
          <el-tag size="small" type="info" class="tab-count">{{ deactivatedSkills.length }}</el-tag>
        </template>
      </el-tab-pane>
      <el-tab-pane name="notInstalled">
        <template #label>
          <span>未安装</span>
          <el-tag size="small" type="info" class="tab-count">{{ notInstalledSkills.length }}</el-tag>
        </template>
      </el-tab-pane>
      <el-tab-pane name="clawhub">
        <template #label>
          <span>ClawHub</span>
        </template>
      </el-tab-pane>
    </el-tabs>

    <!-- ClawHub 搜索模式 (REC-008) -->
    <div v-if="activeTab === 'clawhub'" class="clawhub-search-section">
      <el-input
        v-model="searchQuery"
        placeholder="搜索技能..."
        @keyup.enter="handleSearch"
        prefix-icon="Search"
        class="clawhub-search-input"
      >
        <template #append>
          <el-button @click="handleSearch">搜索</el-button>
        </template>
      </el-input>

      <!-- 搜索结果 -->
      <el-scrollbar v-if="hasSearched" class="clawhub-scrollbar" view-class="clawhub-results-scroll">
        <div class="clawhub-results">
          <div v-if="searching" class="clawhub-loading">
            <el-icon :size="20" class="is-loading"><Loading /></el-icon>
            <span>搜索中...</span>
          </div>
          <div v-else-if="searchResults.length === 0" class="clawhub-empty">
            <el-empty description="未找到相关技能" :image-size="60" />
          </div>
          <div v-else class="skills-grid">
          <el-card
            v-for="skill in searchResults"
            :key="'search-' + skill.name"
            class="skill-card"
            shadow="hover"
          >
            <div class="skill-status-badges">
              <el-button
                v-if="!skill.installed"
                size="small"
                type="primary"
                plain
                @click="handleInstall(skill.name)"
                :loading="installingSkills.get(skill.name)"
                :disabled="installingSkills.get(skill.name)"
                class="install-skill-btn"
              >
                <template #icon>
                  <el-icon><Download /></el-icon>
                </template>
                安装
              </el-button>
              <span v-else class="status-badge badge-enabled">
                🟢 已安装
              </span>
            </div>

            <div class="skill-card-inner">
              <div class="skill-icon-wrap">
                <el-icon :size="28" class="skill-icon skill-icon-default">
                  <Collection />
                </el-icon>
              </div>

              <div class="skill-info">
                <div class="skill-name-row">
                  <span class="skill-name">{{ skill.name }}</span>
                </div>
                <div class="skill-description" v-if="skill.description">
                  {{ skill.description }}
                </div>
                <!-- REC-011: 统计信息 -->
                <div class="skill-stats" v-if="skill.updatedAt || skill.stars !== undefined || skill.downloads !== undefined">
                  <span v-if="skill.updatedAt" class="stat-item">
                    📅 {{ formatDate(skill.updatedAt) }}
                  </span>
                  <span v-if="skill.stars !== undefined" class="stat-item">
                    ⭐ {{ skill.stars }}
                  </span>
                  <span v-if="skill.downloads !== undefined" class="stat-item">
                    📦 {{ skill.downloads }}
                  </span>
                </div>
              </div>
            </div>
          </el-card>
        </div>
          </div>
        </el-scrollbar>

      <!-- 默认提示 -->
      <div v-else class="clawhub-hint">
        <el-icon :size="40" class="clawhub-hint-icon"><Search /></el-icon>
        <p class="clawhub-hint-text">在上方输入关键词搜索 ClawHub 技能</p>
      </div>
    </div>

    <!-- 技能卡片列表 (已安装/未安装 tab) -->
    <el-scrollbar v-if="skillsData?.skills.length && activeTab !== 'clawhub'" class="skills-scrollbar">
      <div class="skills-grid">
        <el-card
          v-for="skill in filteredSkills"
          :key="skill.name"
          class="skill-card"
          shadow="hover"
        >
          <!-- 右上角状态标识 (REC-006/REC-012/REC-022) -->
          <div class="skill-status-badges">
            <!-- REC-012: 已安装显示启用状态，未安装显示安装按钮 -->
            <div class="install-btn-group">
              <el-button
                v-if="!skill.installed"
                size="small"
                type="primary"
                plain
                @click="handleInstall(skill)"
                :loading="installingSkills.get(skill.name)"
                :disabled="installingSkills.get(skill.name)"
                class="install-skill-btn"
              >
                <template #icon>
                  <el-icon><Download /></el-icon>
                </template>
                安装
              </el-button>
            </div>
            <!-- REC-022: 已安装技能显示启用/禁用按钮 -->
            <template v-if="skill.installed">
              <el-button
                v-if="skill.enabled"
                size="small"
                type="danger"
                @click="handleToggle(skill.name, false)"
                :loading="togglingSkills.get(skill.name)"
                :disabled="togglingSkills.get(skill.name)"
                class="toggle-skill-btn"
              >
                禁用
              </el-button>
              <el-button
                v-else
                size="small"
                type="success"
                @click="handleToggle(skill.name, true)"
                :loading="togglingSkills.get(skill.name)"
                :disabled="togglingSkills.get(skill.name)"
                class="toggle-skill-btn"
              >
                启用
              </el-button>
            </template>
          </div>

          <div class="skill-card-inner">
            <!-- 图标区 -->
            <div class="skill-icon-wrap">
              <el-icon v-if="skill.icon" :size="28" class="skill-icon">
                <component :is="getIconComponent(skill.icon)" />
              </el-icon>
              <el-icon v-else :size="28" class="skill-icon skill-icon-default">
                <Collection />
              </el-icon>
            </div>

            <!-- 信息区 -->
            <div class="skill-info">
              <div class="skill-name-row">
                <span class="skill-name">{{ skill.name }}</span>
                <el-tag
                  v-if="skill.status"
                  :type="getStatusType(skill.status)"
                  size="small"
                  class="skill-status-tag"
                >
                  {{ skill.status }}
                </el-tag>
              </div>
              <div class="skill-description" v-if="skill.description">
                {{ skill.description }}
              </div>
            </div>
          </div>
        </el-card>
      </div>
    </el-scrollbar>

    <!-- 空状态 -->
    <el-empty v-else-if="!loading && skillsData?.skills.length === 0" description="暂无技能" :image-size="80" />
    <el-empty v-else-if="!loading && !skillsData" description="加载失败，请重试" :image-size="80">
      <el-button type="primary" @click="fetchSkills">重新加载</el-button>
    </el-empty>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { getSkills, installSkill, searchClawHubSkills, toggleSkill, type SkillsResponse, type SkillInfo } from '../api/system'
import { ElMessage } from 'element-plus'
import {
  Loading,
  Collection,
  Download,
  Refresh,
  Search,
} from '@element-plus/icons-vue'

const props = withDefaults(defineProps<{
  visible: boolean
}>(), {
  visible: false
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const dialogVisible = computed({
  get: () => props.visible,
  set: (val: boolean) => emit('update:visible', val),
})

const loading = ref(false)
const skillsData = ref<SkillsResponse | null>(null)
// REC-012: 安装中状态跟踪（按 skill name 区分）
const installingSkills = ref<Map<string, boolean>>(new Map())
// REC-022: 切换中状态跟踪
const togglingSkills = ref<Map<string, boolean>>(new Map())

// REC-006: Tab 标签页状态
const activeTab = ref('activated')

// REC-008: ClawHub 搜索状态
const searchQuery = ref('')
const searchResults = ref<SkillInfo[]>([])
const searching = ref(false)
const hasSearched = ref(false)

/** 已安装技能 (installed === true) */
const installedSkills = computed(() => {
  return skillsData.value?.skills.filter(s => s.installed) ?? []
})

/** 已激活技能 (installed === true && enabled === true) */
const activatedSkills = computed(() => {
  return installedSkills.value.filter(s => s.enabled) ?? []
})

/** 未激活技能 (installed === true && enabled === false) */
const deactivatedSkills = computed(() => {
  return installedSkills.value.filter(s => !s.enabled) ?? []
})

/** 未安装技能 (installed === false) */
const notInstalledSkills = computed(() => {
  return skillsData.value?.skills.filter(s => !s.installed) ?? []
})

/** REC-008: 已安装技能名集合（用于快速判断） */
const installedNames = computed(() => {
  const set = new Set<string>()
  for (const s of installedSkills.value) set.add(s.name)
  return set
})

/** 根据当前 tab 返回筛选后的技能列表 */
const filteredSkills = computed(() => {
  switch (activeTab.value) {
    case 'activated':
      return activatedSkills.value
    case 'deactivated':
      return deactivatedSkills.value
    case 'notInstalled':
      return notInstalledSkills.value
    case 'clawhub':
      return searchResults.value.map(s => ({
        ...s,
        installed: installedNames.value.has(s.name),
      }))
    default:
      return skillsData.value?.skills ?? []
  }
})

watch(() => props.visible, async (val) => {
  if (val) {
    await nextTick()
    fetchSkills()
  }
})

async function fetchSkills(): Promise<void> {
  loading.value = true
  try {
    const data = await getSkills()
    if (data) {
      skillsData.value = data
    } else {
      ElMessage.error('获取技能列表失败')
    }
  } catch (e: unknown) {
    console.error('[SkillsDialog] fetchSkills error:', e)
    ElMessage.error('获取技能列表异常')
  } finally {
    loading.value = false
  }
}

/**
 * 搜索按钮/回车触发的入口
 */
function handleSearch(): void {
  searchSkills(searchQuery.value)
}

/**
 * REC-008: 搜索 ClawHub 技能
 */
async function searchSkills(query: string): Promise<void> {
  if (!query.trim()) return
  searching.value = true
  hasSearched.value = true
  try {
    const result = await searchClawHubSkills(query.trim())
    if (result?.success) {
      searchResults.value = result.skills ?? []
    } else {
      searchResults.value = []
      ElMessage.warning('未找到相关技能')
    }
  } catch (e: unknown) {
    console.error('[SkillsDialog] searchSkills error:', e)
    searchResults.value = []
    ElMessage.error('搜索失败')
  } finally {
    searching.value = false
  }
}

/**
 * REC-012/REC-018/REC-024: 安装技能
 * - 内置技能 (source === 'builtin') → 调用后端 /api/system/skills/install (openclaw skills install)
 * - ClawHub 技能 (source === 'clawhub') → 调用后端 /api/system/skills/install (npx clawhub install)
 * - 兼容旧调用: handleInstall('skillName') 或 handleInstall(skillObject)
 * - REC-024: 安装成功后刷新技能列表 + ClawHub 搜索结果
 */
async function handleInstall(skill: SkillInfo | string): Promise<void> {
  const skillName = typeof skill === 'string' ? skill : skill.name
  const source = typeof skill === 'string' ? undefined : skill.source
  const wasClawHubTab = activeTab.value === 'clawhub'
  installingSkills.value.set(skillName, true)
  try {
    const result = await installSkill(skillName, source)
    if (result?.success) {
      ElMessage.success(`"${skillName}" 安装成功`)
      installingSkills.value.delete(skillName)
      await fetchSkills()
      // REC-024: 刷新 ClawHub 搜索结果，让刚安装的技能显示为"已安装"
      if (wasClawHubTab && hasSearched.value && searchQuery.value.trim()) {
        await searchSkills(searchQuery.value.trim())
      }
    } else {
      ElMessage.error(result?.message ?? `安装 "${skillName}" 失败`)
    }
  } catch (e: unknown) {
    console.error('[SkillsDialog] install error:', e)
    ElMessage.error(`安装 "${skillName}" 异常`)
  } finally {
    installingSkills.value.delete(skillName)
  }
}

/**
 * REC-022: 切换技能启用/禁用状态
 */
async function handleToggle(skillName: string, enabled: boolean): Promise<void> {
  togglingSkills.value.set(skillName, true)
  try {
    const result = await toggleSkill(skillName, enabled)
    if (result?.success) {
      ElMessage.success(`"${skillName}" 已${enabled ? '启用' : '禁用'}`)
      togglingSkills.value.delete(skillName)
      await fetchSkills()
    } else {
      ElMessage.error(result?.message ?? `切换 "${skillName}" 状态失败`)
    }
  } catch (e: unknown) {
    console.error('[SkillsDialog] toggle error:', e)
    ElMessage.error(`切换 "${skillName}" 状态异常`)
  } finally {
    togglingSkills.value.delete(skillName)
  }
}

/** 根据状态字符串返回 tag 类型 */
function getStatusType(status: string): '' | 'success' | 'warning' | 'danger' | 'info' {
  const s = status.toLowerCase()
  if (s.includes('ready') || s.includes('active') || s.includes('enabled')) return 'success'
  if (s.includes('disabled') || s.includes('inactive')) return 'info'
  if (s.includes('error') || s.includes('fail')) return 'danger'
  return 'warning'
}

/** REC-011: 格式化日期 */
function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    if (diffDays === 0) return '今天'
    if (diffDays === 1) return '昨天'
    if (diffDays < 30) return `${diffDays}天前`
    return date.toLocaleDateString('zh-CN')
  } catch {
    return dateStr
  }
}

/** 根据 icon 名称返回对应的图标组件 */
function getIconComponent(iconName: string): unknown {
  // 当前默认使用 Collection，后续可根据后端返回的 icon 名扩展映射
  const iconMap: Record<string, unknown> = {
    Collection,
    collection: Collection,
    default: Collection,
  }
  return iconMap[iconName] ?? Collection
}
</script>

<style scoped>
/* ── 统计栏 ── */
.skills-stats-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  margin-bottom: 16px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-elevated);
  font-size: 14px;
}

/* ── Tab 标签页 (REC-006) ── */
.skills-tabs {
  margin-bottom: 16px;
}

.skills-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
}

.skills-tabs :deep(.el-tabs__nav-wrap)::after {
  background-color: var(--border-color);
}

.skills-tabs :deep(.el-tabs__item) {
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
}

.skills-tabs :deep(.el-tabs__item.is-active) {
  color: var(--accent, #42a5f5);
}

.skills-tabs :deep(.el-tabs__active-bar) {
  background-color: var(--accent, #42a5f5);
}

.tab-count {
  margin-left: 4px;
  font-size: 11px;
  padding: 0 6px;
  height: 18px;
  line-height: 18px;
}

.stats-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.stats-label {
  color: var(--text-secondary);
  font-size: 13px;
}

.stats-value {
  color: var(--text-primary);
  font-weight: 700;
  font-size: 18px;
  font-variant-numeric: tabular-nums;
}

.stats-ready {
  color: #4caf50;
}

.stats-divider {
  width: 1px;
  height: 24px;
  background: var(--border-color);
}

.refresh-skills-btn {
  margin-left: auto;
  flex-shrink: 0;
}

/* ── 加载状态 ── */
.skills-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 0;
  color: var(--text-secondary);
  font-size: 14px;
}

/* ── 滚动区域 ── */
.skills-scrollbar {
  height: 70vh;
}

/* ── 卡片网格 ── */
.skills-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  padding: 4px;
}

/* ── 技能卡片 ── */
.skill-card {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  transition: all 0.3s;
}

.skill-card:hover {
  border-color: var(--accent);
  box-shadow: 0 4px 16px var(--accent-glow);
  transform: translateY(-2px);
}

.skill-card :deep(.el-card__body) {
  padding: 14px 16px;
  position: relative;
}

/* ── 右上角状态标识 (REC-006) ── */
.skill-status-badges {
  position: absolute;
  top: 8px;
  right: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 1;
}

.status-badge {
  font-size: 11px;
  line-height: 1;
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;
  letter-spacing: 0.02em;
}

.badge-installed,
.badge-enabled {
  color: #4caf50;
  background: rgba(76, 175, 80, 0.1);
}

.badge-not-installed,
.badge-not-enabled {
  color: #9e9e9e;
  background: rgba(158, 158, 158, 0.1);
}

/* REC-012: 安装按钮样式 */
.install-skill-btn {
  font-size: 11px;
  padding: 4px 10px;
  height: auto;
  line-height: 1;
}

.install-skill-btn :deep(.el-icon) {
  font-size: 11px;
}

/* REC-022: 启用/禁用按钮样式 */
.toggle-skill-btn {
  font-size: 11px;
  padding: 4px 10px;
  height: auto;
  line-height: 1;
}

/* REC-018: 安装按钮组 + 来源标签 */
.install-btn-group {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.source-tag {
  font-size: 10px;
  padding: 0 4px;
  height: 16px;
  line-height: 16px;
  opacity: 0.8;
}

.skill-card-inner {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}

.skill-icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: rgba(66, 165, 245, 0.15);
  color: #42a5f5;
}

.skill-icon-default {
  background: rgba(159, 122, 234, 0.15);
  color: #9f7aea;
}

.skill-info {
  flex: 1;
  min-width: 0;
}

.skill-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.skill-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.skill-status-tag {
  flex-shrink: 0;
}

.skill-description {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ── REC-011: 统计信息 ── */
.skill-stats {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-color);
}

.stat-item {
  font-size: 11px;
  color: var(--text-secondary, #999);
  white-space: nowrap;
  letter-spacing: 0.02em;
}

/* ── 弹框样式 ── */
:deep(.skills-dialog.el-dialog) {
  background-color: var(--bg-card) !important;
  border: 1px solid var(--border-color) !important;
  border-radius: 12px !important;
}

:deep(.skills-dialog .el-dialog__header) {
  background-color: var(--bg-card) !important;
  border-bottom: 1px solid var(--border-color) !important;
  padding: 16px 20px !important;
  margin-right: 0 !important;
}

:deep(.skills-dialog .el-dialog__title) {
  color: var(--text-primary) !important;
}

:deep(.skills-dialog .el-dialog__body) {
  background-color: var(--bg-card) !important;
  padding: 20px !important;
  color: var(--text-primary) !important;
  max-height: 90vh !important;
  overflow-y: auto !important;
}

:deep(.skills-dialog .el-dialog__close) {
  color: var(--text-primary) !important;
}

:deep(.skills-dialog .el-dialog__close):hover {
  color: var(--accent, #38bdf8) !important;
}

.skills-dialog-modal {
  background-color: rgba(0, 0, 0, 0.5);
}

/* ── REC-008: ClawHub 搜索模式 ── */
.clawhub-search-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.clawhub-search-input {
  width: 100%;
}

.clawhub-search-input :deep(.el-input__wrapper) {
  border-radius: 8px;
}

.clawhub-results {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.clawhub-scrollbar {
  height: 60vh;
}

.clawhub-results-scroll {
  padding: 4px;
}

.clawhub-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 32px 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.clawhub-empty {
  padding: 16px 0;
}

/* ClawHub 提示 */
.clawhub-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: var(--text-secondary);
}

.clawhub-hint-icon {
  color: var(--border-color);
  margin-bottom: 12px;
}

.clawhub-hint-text {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0;
}
</style>

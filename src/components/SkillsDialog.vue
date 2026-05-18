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

    <!-- 技能卡片列表 -->
    <el-scrollbar v-else-if="skillsData?.skills.length" class="skills-scrollbar">
      <div class="skills-grid">
        <el-card
          v-for="skill in skillsData.skills"
          :key="skill.name"
          class="skill-card"
          shadow="hover"
        >
          <!-- 右上角状态标识 (REC-006/REC-012) -->
          <div class="skill-status-badges">
            <!-- REC-012: 已安装显示标签，未安装显示安装按钮 -->
            <span v-if="skill.installed" class="status-badge badge-installed">
              ✅ 已安装
            </span>
            <el-button
              v-else
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
            <span class="status-badge" :class="skill.enabled ? 'badge-enabled' : 'badge-not-enabled'">
              {{ skill.enabled ? '🟢 已启用' : '⚪ 未启用' }}
            </span>
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
import { getSkills, installSkill, type SkillsResponse } from '../api/system'
import { ElMessage } from 'element-plus'
import {
  Loading,
  Collection,
  Download,
  Refresh,
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
 * REC-012: 安装技能
 */
async function handleInstall(skillName: string): Promise<void> {
  installingSkills.value.set(skillName, true)
  try {
    const result = await installSkill(skillName)
    if (result?.success) {
      ElMessage.success(`"${skillName}" 安装成功`)
      // 先移除安装中标记，再刷新列表，减少 UI 闪烁
      installingSkills.value.delete(skillName)
      await fetchSkills()
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

/** 根据状态字符串返回 tag 类型 */
function getStatusType(status: string): '' | 'success' | 'warning' | 'danger' | 'info' {
  const s = status.toLowerCase()
  if (s.includes('ready') || s.includes('active') || s.includes('enabled')) return 'success'
  if (s.includes('disabled') || s.includes('inactive')) return 'info'
  if (s.includes('error') || s.includes('fail')) return 'danger'
  return 'warning'
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
</style>

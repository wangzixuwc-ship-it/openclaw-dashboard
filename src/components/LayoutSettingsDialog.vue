<template>
  <el-dialog
    v-model="visible"
    title="🎛️ 自定义布局"
    width="640px"
    :close-on-click-modal="true"
    class="layout-settings-dialog"
  >
    <div class="layout-intro">
      <el-icon><InfoFilled /></el-icon>
      <span>调整功能按钮和统计卡片的显示顺序。版本、网关、通知固定在顶栏，不参与排列。点击 ↑ ↓ 重排，或拖拽（按住条目）。配置自动保存到浏览器本地。</span>
    </div>

    <!-- 功能区按钮 -->
    <div class="ls-section">
      <div class="ls-section-title">
        <span>功能区按钮顺序</span>
        <el-button link size="small" @click="resetStatusBar">恢复默认</el-button>
      </div>
      <div class="ls-list">
        <div
          v-for="(id, i) in localStatusBar"
          :key="id"
          class="ls-item"
          draggable="true"
          @dragstart="onDragStart('statusBar', i)"
          @dragover.prevent
          @drop="onDrop('statusBar', i)"
          @dragend="onDragEnd"
        >
          <span class="ls-handle">⋮⋮</span>
          <span class="ls-item-icon">{{ statusBarMeta[id]?.icon || '◌' }}</span>
          <span class="ls-item-label">{{ statusBarMeta[id]?.label || id }}</span>
          <span class="ls-item-desc">{{ statusBarMeta[id]?.desc || '' }}</span>
          <div class="ls-item-actions">
            <el-button
              link size="small" :icon="Top"
              :disabled="i === 0"
              @click="moveItem('statusBar', i, -1)"
            />
            <el-button
              link size="small" :icon="Bottom"
              :disabled="i === localStatusBar.length - 1"
              @click="moveItem('statusBar', i, 1)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="ls-section">
      <div class="ls-section-title">
        <span>统计卡片顺序</span>
        <el-button link size="small" @click="resetStatsCards">恢复默认</el-button>
      </div>
      <div class="ls-list">
        <div
          v-for="(id, i) in localStatsCards"
          :key="id"
          class="ls-item"
          draggable="true"
          @dragstart="onDragStart('statsCards', i)"
          @dragover.prevent
          @drop="onDrop('statsCards', i)"
          @dragend="onDragEnd"
        >
          <span class="ls-handle">⋮⋮</span>
          <span class="ls-item-icon">{{ statsCardsMeta[id]?.icon || '◌' }}</span>
          <span class="ls-item-label">{{ statsCardsMeta[id]?.label || id }}</span>
          <span class="ls-item-desc">{{ statsCardsMeta[id]?.desc || '' }}</span>
          <div class="ls-item-actions">
            <el-button
              link size="small" :icon="Top"
              :disabled="i === 0"
              @click="moveItem('statsCards', i, -1)"
            />
            <el-button
              link size="small" :icon="Bottom"
              :disabled="i === localStatsCards.length - 1"
              @click="moveItem('statsCards', i, 1)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 第三模块：内嵌视图可见性（Inline Section Visibility）-->
    <div class="ls-section">
      <div class="ls-section-title">
        <span>内嵌视图显示</span>
        <el-button link size="small" @click="resetSections">恢复默认</el-button>
      </div>
      <div class="ls-list">
        <div v-for="item in sectionsMeta" :key="item.id" class="ls-item ls-item-toggle">
          <span class="ls-item-icon">{{ item.icon }}</span>
          <span class="ls-item-label">{{ item.label }}</span>
          <span class="ls-item-desc">{{ item.desc }}</span>
          <el-switch
            v-model="localSections[item.id]"
            size="small"
            style="margin-left: auto"
          />
        </div>
      </div>
    </div>

    <template #footer>
      <div class="ls-footer">
        <el-button @click="resetAll" type="danger" plain>全部恢复默认</el-button>
        <div>
          <el-button @click="visible = false">取消</el-button>
          <el-button type="primary" @click="saveAndClose">保存</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { InfoFilled, Top, Bottom } from '@element-plus/icons-vue'
import { useLayoutSettings } from '../composables/useLayoutSettings'

const visible = defineModel<boolean>('visible', { default: false })
const { config, setStatusBarOrder, setStatsCardsOrder, setSectionVisible, DEFAULT_STATUS_BAR, DEFAULT_STATS_CARDS, DEFAULT_SECTIONS } = useLayoutSettings()

const localStatusBar = ref<string[]>([])
const localStatsCards = ref<string[]>([])
const localSections = ref<Record<string, boolean>>({})

// 打开时同步当前配置
watch(visible, (val) => {
  if (val) {
    localStatusBar.value = [...config.value.statusBar]
    localStatsCards.value = [...config.value.statsCards]
    localSections.value = { ...config.value.sections }
  }
})

// ── 元数据：每个 id 对应的 icon + label + desc（功能区可排序项，已移除 GPU）──
const statusBarMeta: Record<string, { icon: string; label: string; desc: string }> = {
  fileManager: { icon: '📁', label: '文件管理', desc: '查看系统所有文件' },
  billing:     { icon: '💰', label: '计费配置', desc: '按模型自定义计费' },
  skills:      { icon: '🧰', label: '技能库', desc: '管理 agent 技能' },
  webui:       { icon: '🌐', label: 'WebUI', desc: '跳转 OpenClaw 原生界面' },
  projects:    { icon: '📋', label: '项目看板', desc: '5 列看板跟踪项目进度' },
  cron:        { icon: '⏰', label: '定时任务', desc: 'Cron 任务中心' },
}

const statsCardsMeta: Record<string, { icon: string; label: string; desc: string }> = {
  total:   { icon: '📊', label: '总计', desc: 'Agent 总数' },
  running: { icon: '▶️', label: '运行中', desc: '运行中的 agent 数' },
  idle:    { icon: '⏸️', label: '空闲', desc: '空闲的 agent 数' },
  aborted: { icon: '⏹️', label: '已终止', desc: '终止的 agent 数' },
  error:   { icon: '❌', label: '错误', desc: '出错的 agent 数' },
  uptime:  { icon: '⏰', label: '本次运行时间', desc: 'Gateway 运行时长' },
  tokens:  { icon: '🔢', label: '历史消耗 Token', desc: '累计 token 用量' },
  cost:    { icon: '💸', label: '本次运行费用', desc: '本次累计费用 + 今日/月度预估' },
}

// ── 第三模块元数据 ──
const sectionsMeta = [
  { id: 'timeline',  icon: '📈', label: '活动时间线',   desc: 'Gantt 图内嵌展示（可折叠）' },
  { id: 'changelog', icon: '📋', label: '版本迭代说明', desc: 'Changelog 版本历史 + 回退（可折叠）' },
]

// ── 排序 ──
function moveItem(group: 'statusBar' | 'statsCards', index: number, delta: number) {
  const list = group === 'statusBar' ? localStatusBar.value : localStatsCards.value
  const newIndex = index + delta
  if (newIndex < 0 || newIndex >= list.length) return
  const [item] = list.splice(index, 1)
  list.splice(newIndex, 0, item)
}

// ── 拖拽 ──
let dragSource: { group: string; index: number } | null = null
function onDragStart(group: string, index: number) {
  dragSource = { group, index }
}
function onDrop(group: string, targetIndex: number) {
  if (!dragSource || dragSource.group !== group) return
  const list = group === 'statusBar' ? localStatusBar.value : localStatsCards.value
  const sourceIndex = dragSource.index
  if (sourceIndex === targetIndex) return
  const [item] = list.splice(sourceIndex, 1)
  list.splice(targetIndex, 0, item)
  dragSource = null
}
function onDragEnd() {
  dragSource = null
}

// ── 重置 ──
function resetStatusBar() {
  localStatusBar.value = [...DEFAULT_STATUS_BAR]
}
function resetStatsCards() {
  localStatsCards.value = [...DEFAULT_STATS_CARDS]
}
function resetSections() {
  localSections.value = { ...DEFAULT_SECTIONS }
}
function resetAll() {
  resetStatusBar()
  resetStatsCards()
  resetSections()
}

function saveAndClose() {
  setStatusBarOrder(localStatusBar.value)
  setStatsCardsOrder(localStatsCards.value)
  // 保存内嵌视图可见性
  for (const [id, vis] of Object.entries(localSections.value)) {
    setSectionVisible(id, vis)
  }
  visible.value = false
}
</script>

<style scoped>
.layout-intro {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(139, 92, 246, 0.08);
  border: 1px solid rgba(139, 92, 246, 0.2);
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
  margin-bottom: 16px;
  line-height: 1.6;
}
.layout-intro .el-icon { color: #8b5cf6; flex-shrink: 0; margin-top: 2px; }

.ls-section {
  margin-bottom: 16px;
}
.ls-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 8px;
  padding: 4px 0 6px;
  border-bottom: 1px solid var(--border-color);
}

.ls-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ls-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 6px;
  cursor: grab;
  user-select: none;
  transition: all 0.15s;
}
.ls-item:hover {
  background: rgba(139, 92, 246, 0.05);
  border-color: rgba(139, 92, 246, 0.2);
}
.ls-item:active { cursor: grabbing; }

.ls-handle {
  color: rgba(255,255,255,0.25);
  font-size: 14px;
  letter-spacing: -2px;
  font-weight: bold;
}
.ls-item-icon { font-size: 16px; flex-shrink: 0; }
.ls-item-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  min-width: 110px;
}
.ls-item-desc {
  flex: 1;
  font-size: 11px;
  color: var(--text-secondary);
}
.ls-item-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.ls-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
/* 切换型条目（内嵌视图模块）不需要拖拽手柄 */
.ls-item-toggle {
  cursor: default;
}
.ls-item-toggle:hover {
  background: rgba(255,255,255,0.04);
}
</style>

<template>
  <div class="project-monitor">
    <!-- 工具栏 -->
    <div class="project-monitor__toolbar">
      <h2 class="project-monitor__title">
        <el-icon :size="20" style="color: #42a5f5;"><Monitor /></el-icon>
        项目监控
      </h2>
      <div class="project-monitor__toolbar-right">
        <el-button :icon="Refresh" circle size="small" @click="handleScanAll" :loading="scanLoading" title="扫描所有项目" />
      </div>
    </div>

    <!-- 项目统计卡片（对齐 Agent 看板 stats-section） -->
    <section class="stats-section">
      <div class="stats-inner">
        <el-card
          v-for="stat in projectStats"
          :key="stat.label"
          class="stat-card"
          :class="stat.cardClass"
          shadow="hover"
        >
          <div class="stat-card-inner">
            <div class="stat-icon-wrap" :class="stat.iconClass">
              <el-icon :size="26"><component :is="stat.icon" /></el-icon>
            </div>
            <div class="stat-text">
              <div class="stat-number">{{ stat.value }}</div>
              <div class="stat-label">{{ stat.label }}</div>
            </div>
          </div>
        </el-card>
      </div>
    </section>

    <!-- 看板主体（按状态分列，完全复刻 Agent 看板布局） -->
    <main class="board-container" v-loading="store.loading && store.projects.length === 0">
      <!-- 待启动列 -->
      <div class="board-column board-column-pending">
        <div class="board-column-header" style="border-bottom-color: #ffc107;">
          <span style="color: #ffc107; font-weight: 700; font-size: 13px;">
            <el-icon><Clock /></el-icon>
            待启动
          </span>
          <el-tag size="small" style="background: rgba(255,193,7,0.15); color: #ffc107; border-color: #ffc107;">
            {{ pendingCount }} 个
          </el-tag>
        </div>
        <div class="board-column-tasks">
          <ProjectCard
            v-for="project in pendingProjects"
            :key="project.id"
            :project="project"
            @click="openDetail(project)"
            @command="(cmd: string) => handleCommand(cmd, project)"
          />
          <el-empty v-if="pendingCount === 0" description="暂无待启动的项目" :image-size="50" />
        </div>
      </div>

      <!-- 运行中列 -->
      <div class="board-column board-column-running">
        <div class="board-column-header" style="border-bottom-color: #4caf50;">
          <span style="color: #4caf50; font-weight: 700; font-size: 13px;">
            <el-icon><VideoPlay /></el-icon>
            运行中
          </span>
          <el-tag size="small" style="background: rgba(76,175,80,0.15); color: #4caf50; border-color: #4caf50;">
            {{ runningCount }} 个
          </el-tag>
        </div>
        <div class="board-column-tasks">
          <ProjectCard
            v-for="project in runningProjects"
            :key="project.id"
            :project="project"
            @click="openDetail(project)"
            @command="(cmd: string) => handleCommand(cmd, project)"
          />
          <el-empty v-if="runningCount === 0" description="暂无运行中的项目" :image-size="50" />
        </div>
      </div>

      <!-- 已暂停列 -->
      <div class="board-column board-column-paused">
        <div class="board-column-header" style="border-bottom-color: #f97316;">
          <span style="color: #f97316; font-weight: 700; font-size: 13px;">
            <el-icon><VideoPause /></el-icon>
            已暂停
          </span>
          <el-tag size="small" style="background: rgba(249,115,22,0.15); color: #f97316; border-color: #f97316;">
            {{ pausedCount }} 个
          </el-tag>
        </div>
        <div class="board-column-tasks">
          <ProjectCard
            v-for="project in pausedProjects"
            :key="project.id"
            :project="project"
            @click="openDetail(project)"
            @command="(cmd: string) => handleCommand(cmd, project)"
          />
          <el-empty v-if="pausedCount === 0" description="暂无已暂停的项目" :image-size="50" />
        </div>
      </div>

      <!-- 已完成列 -->
      <div class="board-column board-column-completed">
        <div class="board-column-header" style="border-bottom-color: #8b5cf6;">
          <span style="color: #8b5cf6; font-weight: 700; font-size: 13px;">
            <el-icon><CircleCheck /></el-icon>
            已完成
          </span>
          <el-tag size="small" style="background: rgba(139,92,246,0.15); color: #8b5cf6; border-color: #8b5cf6;">
            {{ completedCount }} 个
          </el-tag>
        </div>
        <div class="board-column-tasks">
          <ProjectCard
            v-for="project in completedProjects"
            :key="project.id"
            :project="project"
            @click="openDetail(project)"
            @command="(cmd: string) => handleCommand(cmd, project)"
          />
          <el-empty v-if="completedCount === 0" description="暂无已完成的项目" :image-size="50" />
        </div>
      </div>

      <!-- 异常列 -->
      <div class="board-column board-column-error">
        <div class="board-column-header" style="border-bottom-color: #f44336;">
          <span style="color: #f44336; font-weight: 700; font-size: 13px;">
            <el-icon><CircleCloseFilled /></el-icon>
            异常
          </span>
          <el-tag size="small" style="background: rgba(244,67,54,0.15); color: #f44336; border-color: #f44336;">
            {{ errorCount }} 个
          </el-tag>
        </div>
        <div class="board-column-tasks">
          <ProjectCard
            v-for="project in errorProjects"
            :key="project.id"
            :project="project"
            @click="openDetail(project)"
            @command="(cmd: string) => handleCommand(cmd, project)"
          />
          <el-empty v-if="errorCount === 0" description="暂无异常的项目" :image-size="50" />
        </div>
      </div>
    </main>

    <!-- 详情抽屉 -->
    <ProjectDetailDrawer
      v-if="selectedProject"
      v-model:visible="detailVisible"
      :project="selectedProject"
      @edit="openEdit(selectedProject.id)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useProjectStore } from '../stores/project'
import type { Project } from '../types'
import ProjectCard from '../components/ProjectCard.vue'
import ProjectDetailDrawer from '../components/ProjectDetailDrawer.vue'
import { Monitor, Refresh, FolderOpened, Clock, VideoPlay, VideoPause, CircleCheck, CircleCloseFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const store = useProjectStore()

// ─── 项目状态统计卡片（对齐 Agent 看板 statsCards） ───
const projectStats = computed(() => [
  {
    label: '项目总数',
    value: store.projectCount,
    icon: FolderOpened,
    iconClass: 'icon-blue',
    cardClass: 'stat-total',
  },
  {
    label: '运行中',
    value: runningCount.value,
    icon: VideoPlay,
    iconClass: 'icon-green',
    cardClass: 'stat-running',
  },
  {
    label: '已完成',
    value: completedCount.value,
    icon: CircleCheck,
    iconClass: 'icon-purple',
    cardClass: 'stat-completed',
  },
  {
    label: '已暂停',
    value: pausedCount.value,
    icon: VideoPause,
    iconClass: 'icon-orange',
    cardClass: 'stat-paused',
  },
  {
    label: '待启动',
    value: pendingCount.value,
    icon: Clock,
    iconClass: 'icon-yellow',
    cardClass: 'stat-idle',
  },
  {
    label: '异常',
    value: errorCount.value,
    icon: CircleCloseFilled,
    iconClass: 'icon-red',
    cardClass: 'stat-error',
  },
])

// ─── 按状态分类的项目列表（running/active 视为同义） ───
const pendingProjects = computed(() => store.projects.filter(p => p.status === 'pending'))
const runningProjects = computed(() => store.projects.filter(p => p.status === 'running' || p.status === 'active'))
const pausedProjects = computed(() => store.projects.filter(p => p.status === 'paused'))
const completedProjects = computed(() => store.projects.filter(p => p.status === 'completed'))
const errorProjects = computed(() => store.projects.filter(p => p.status === 'error'))

// ─── 各列数量 ───
const pendingCount = computed(() => pendingProjects.value.length)
const runningCount = computed(() => runningProjects.value.length)
const pausedCount = computed(() => pausedProjects.value.length)
const completedCount = computed(() => completedProjects.value.length)
const errorCount = computed(() => errorProjects.value.length)

// 详情抽屉
const detailVisible = ref(false)
const selectedProject = ref<Project | null>(null)

function openDetail(project: Project) {
  selectedProject.value = project
  detailVisible.value = true
}

const scanLoading = ref(false)

async function handleCommand(cmd: string, project: Project) {
  switch (cmd) {
    case 'scan':
      scanLoading.value = true
      try { await store.scan(project.id); ElMessage.success(`已扫描 ${project.name}`) }
      finally { scanLoading.value = false }
      break

    case 'setActive':
      await store.setActive(project.id)
      ElMessage.success(`${project.name} 已设为活跃项目`)
      break

    case 'detail':
      openDetail(project)
      break

    case 'delete':
      try {
        await ElMessageBox.confirm(`确定删除「${project.name}」？`, '确认', { type: 'warning' })
        const ok = await store.removeProject(project.id)
        if (ok) {
          ElMessage.success('已删除')
          if (selectedProject.value?.id === project.id) {
            detailVisible.value = false
            selectedProject.value = null
          }
        }
      } catch { /* cancel */ }
      break
  }
}

async function handleScanAll() {
  scanLoading.value = true
  try { await store.scanAll(); ElMessage.success('已扫描所有项目') }
  finally { scanLoading.value = false }
}

onMounted(() => { store.loadProjects() })
</script>

<style scoped>
.project-monitor {
  padding: 20px 24px;
  max-width: 1440px;
  margin: 0 auto;
}

.project-monitor__toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 12px;
}

.project-monitor__title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary, #e2e8f0);
  display: flex;
  align-items: center;
  gap: 8px;
}

.project-monitor__toolbar-right {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* ==================== 统计卡片区域（对齐 Agent 看板 stats-section） ==================== */
.stats-section {
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-color);
  margin: -20px -24px 20px;
  padding: 0 24px;
}

.stats-inner {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 14px;
  padding: 16px 0;
}

.stat-card {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  transition: all 0.3s;
}

.stat-card:hover {
  border-color: var(--accent);
  box-shadow: 0 4px 16px var(--accent-glow);
  transform: translateY(-2px);
}

.stat-card :deep(.el-card__body) {
  padding: 12px 16px;
}

.stat-card-inner {
  display: flex;
  align-items: center;
  gap: 14px;
}

.stat-icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stat-text {
  display: flex;
  flex-direction: column;
}

.stat-number {
  font-size: 26px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  color: var(--text-primary);
}

.stat-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stat-total { border-left: 3px solid #409eff; }
.stat-running { border-left: 3px solid #67c23a; }
.stat-completed { border-left: 3px solid #8b5cf6; }
.stat-paused { border-left: 3px solid #f97316; }
.stat-idle { border-left: 3px solid #ffc107; }
.stat-error { border-left: 3px solid #f44336; }

.icon-blue { background: rgba(64, 158, 255, 0.15); color: #409eff; }
.icon-green { background: rgba(103, 194, 58, 0.15); color: #67c23a; }
.icon-yellow { background: rgba(255, 193, 7, 0.15); color: #ffc107; }
.icon-red { background: rgba(244, 67, 54, 0.15); color: #f44336; }
.icon-purple { background: rgba(139, 92, 246, 0.15); color: #8b5cf6; }
.icon-orange { background: rgba(249, 115, 22, 0.15); color: #f97316; }

/* ==================== 看板布局（完全复刻 Agent 看板） ==================== */
.board-container {
  max-width: 1440px;
  margin: 0 auto;
  padding: 20px 24px;
  display: flex;
  gap: 14px;
  align-items: flex-start;
  overflow-x: auto;
  padding-bottom: 16px;
}

.board-column {
  flex: 1;
  min-width: 240px;
  max-width: 400px;
  background: #0f172a;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  overflow: visible;
  transition: border-color 0.2s;
}

.board-column:hover {
  border-color: #334155;
}

.board-column-header {
  padding: 14px 16px;
  border-bottom: 2px solid transparent;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 700;
  font-size: 13px;
}

.board-column-tasks {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ==================== 响应式 ==================== */
@media (max-width: 1200px) {
  .stats-inner {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 768px) {
  .stats-inner {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* ==================== 弹窗磨砂玻璃背景 ==================== */
:deep(.project-dialog .el-dialog__wrapper) {
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

:deep(.project-dialog .el-dialog) {
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.98), rgba(15, 23, 42, 0.98)) !important;
  border: 1px solid rgba(66, 165, 245, 0.2);
  border-radius: 12px !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

:deep(.project-dialog .el-dialog__header) {
  border-bottom: 1px solid rgba(66, 165, 245, 0.15) !important;
  padding: 16px 20px !important;
}

:deep(.project-dialog .el-dialog__title) {
  color: #90caf9 !important;
}

:deep(.project-dialog .el-dialog__body) {
  padding: 20px !important;
}
</style>

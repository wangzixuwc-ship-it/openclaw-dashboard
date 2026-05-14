<template>
  <el-drawer
    v-model="visible"
    :title="`项目详情 — ${project.name}`"
    size="600px"
    direction="rtl"
    :close-on-click-modal="false"
    destroy-on-close
    class="project-detail-drawer"
  >
    <!-- 基本信息 -->
    <div class="drawer-section">
      <h3 class="drawer-section__title">基本信息</h3>
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="项目名称">{{ project.name }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="statusTagType" size="small">{{ statusLabel }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="进度">
          <el-progress :percentage="project.progress" :status="project.progress === 100 ? 'success' : undefined" :stroke-width="10" />
        </el-descriptions-item>
        <el-descriptions-item label="手动覆盖" v-if="project.manualOverride">
          <el-tag type="warning" size="small">手动设置</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="项目路径" :span="2">{{ project.subPath || '-' }}</el-descriptions-item>
        <el-descriptions-item label="创建时间" :span="2">{{ formatDateTime(project.createdAt) }}</el-descriptions-item>
        <el-descriptions-item label="更新时间" :span="2">{{ formatDateTime(project.updatedAt) }}</el-descriptions-item>
        <el-descriptions-item label="描述" :span="2">
          {{ project.description || '-' }}
        </el-descriptions-item>
      </el-descriptions>
    </div>

    <!-- Tags -->
    <div class="drawer-section" v-if="project.tags?.length">
      <h3 class="drawer-section__title">标签</h3>
      <div class="tags-wrap">
        <el-tag v-for="tag in project.tags" :key="tag" size="small" effect="plain">{{ tag }}</el-tag>
      </div>
    </div>

    <!-- 关联 Agent -->
    <div class="drawer-section" v-if="project.linkedAgents?.length">
      <h3 class="drawer-section__title">关联 Agent</h3>
      <div class="tags-wrap">
        <el-tag v-for="agent in project.linkedAgents" :key="agent" size="small" type="success" effect="plain">
          {{ agent }}
        </el-tag>
      </div>
    </div>

    <!-- 任务队列 -->
    <div class="drawer-section">
      <div class="drawer-section__header">
        <h3 class="drawer-section__title">任务队列</h3>
        <span class="drawer-section__count">{{ doneCount }}/{{ project.taskQueue?.length || 0 }} 已完成</span>
      </div>

      <div v-if="project.taskQueue?.length">
        <div
          v-for="task in project.taskQueue"
          :key="task.id"
          class="task-item"
          :class="`task-item--${task.status}`"
        >
          <div class="task-item__left">
            <el-icon :size="16" :style="{ color: taskIconColor(task.status) }">
              <component :is="taskIcon(task.status)" />
            </el-icon>
            <span class="task-item__title">{{ task.title }}</span>
          </div>
          <div class="task-item__right">
            <el-tag :type="taskStatusType(task.status)" size="small">{{ taskStatusLabel(task.status) }}</el-tag>
            <span v-if="task.assignedAgent" class="task-item__agent">{{ task.assignedAgent }}</span>
          </div>
        </div>
      </div>
      <el-empty v-else description="暂无任务" :image-size="40" />
    </div>

    <!-- 底部操作 -->
    <template #footer>
      <div class="drawer-footer">
        <el-button type="primary" @click="$emit('edit')">编辑项目</el-button>
        <el-button @click="visible = false">关闭</el-button>
      </div>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Project } from '../types'
import {
  CircleCheck,
  Clock,
  VideoPlay,
  CircleClose,
} from '@element-plus/icons-vue'

const props = defineProps<{
  project: Project
}>()

const visible = defineModel<boolean>({ default: false })
defineEmits<{
  edit: []
}>()

const statusLabel = computed(() => {
  const map: Record<string, string> = { pending: '待启动', active: '进行中', paused: '已暂停', completed: '已完成', error: '异常' }
  return map[props.project.status] ?? props.project.status
})

const statusTagType = computed(() => {
  const map: Record<string, string> = { pending: 'info', active: 'success', paused: 'warning', completed: '', error: 'danger' }
  return map[props.project.status] ?? 'info'
})

const doneCount = computed(() =>
  props.project.taskQueue?.filter((t) => t.status === 'done').length ?? 0,
)

function formatDateTime(iso?: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  const Y = d.getFullYear()
  const M = String(d.getMonth() + 1).padStart(2, '0')
  const D = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  return `${Y}-${M}-${D} ${h}:${m}:${s}`
}

function taskIcon(status: string) {
  const icons: Record<string, string> = { done: 'CircleCheck', in_progress: 'VideoPlay', pending: 'Clock', error: 'CircleClose' }
  return icons[status] ?? 'Clock'
}

function taskIconColor(status: string): string {
  const colors: Record<string, string> = { done: '#4caf50', in_progress: '#42a5f5', pending: '#94a3b8', error: '#f44336' }
  return colors[status] ?? '#94a3b8'
}

function taskStatusType(status: string): string {
  const map: Record<string, string> = { done: 'success', in_progress: '', pending: 'info', error: 'danger' }
  return map[status] ?? 'info'
}

function taskStatusLabel(status: string): string {
  const map: Record<string, string> = { done: '已完成', in_progress: '进行中', pending: '待执行', error: '异常' }
  return map[status] ?? status
}
</script>

<style scoped>
.drawer-section {
  margin-bottom: 20px;
}

.drawer-section__title {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #e2e8f0);
  padding-left: 10px;
  border-left: 3px solid #42a5f5;
}

.drawer-section__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.drawer-section__count {
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
}

.tags-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.task-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-radius: 6px;
  margin-bottom: 6px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.task-item--done {
  border-color: rgba(76, 175, 80, 0.2);
}

.task-item--error {
  border-color: rgba(244, 67, 54, 0.2);
}

.task-item__left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.task-item__title {
  font-size: 13px;
  color: var(--text-primary, #e2e8f0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-item__right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.task-item__agent {
  font-size: 11px;
  color: var(--text-secondary, #64748b);
}

.drawer-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

:deep(.el-drawer__header) {
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color, #334155);
}
</style>

<template>
  <div class="task-queue" v-if="tasks.length">
    <div
      v-for="task in tasks"
      :key="task.id"
      class="task-queue__item"
      :class="`task-queue__item--${task.status}`"
    >
      <div class="task-queue__item-left">
        <el-icon :size="16" :style="{ color: statusColor(task.status) }">
          <component :is="statusIcon(task.status)" />
        </el-icon>
        <span class="task-queue__item-title">{{ task.title }}</span>
      </div>
      <div class="task-queue__item-right">
        <span class="task-queue__item-agent" v-if="task.assignedAgent">{{ task.assignedAgent }}</span>
        <el-tag :type="tagType(task.status)" size="small">{{ label(task.status) }}</el-tag>
      </div>
    </div>
  </div>
  <div class="task-queue__empty" v-else>暂无任务</div>
</template>

<script setup lang="ts">
import type { ProjectTask } from '../types'
import { CircleCheck, Clock, VideoPlay, CircleClose } from '@element-plus/icons-vue'

defineProps<{
  tasks: ProjectTask[]
}>()

function statusIcon(status: string) {
  const map: Record<string, string> = { done: 'CircleCheck', in_progress: 'VideoPlay', pending: 'Clock', error: 'CircleClose' }
  return map[status] ?? 'Clock'
}

function statusColor(status: string): string {
  const map: Record<string, string> = { done: '#4caf50', in_progress: '#42a5f5', pending: '#94a3b8', error: '#f44336' }
  return map[status] ?? '#94a3b8'
}

function tagType(status: string): string {
  const map: Record<string, string> = { done: 'success', in_progress: '', pending: 'info', error: 'danger' }
  return map[status] ?? 'info'
}

function label(status: string): string {
  const map: Record<string, string> = { done: '已完成', in_progress: '进行中', pending: '待执行', error: '异常' }
  return map[status] ?? status
}
</script>

<style scoped>
.task-queue__item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-radius: 6px;
  margin-bottom: 6px;
  background: rgba(255, 255, 255, 0.03);
  border-left: 3px solid transparent;
}

.task-queue__item--done { border-left-color: #4caf50; }
.task-queue__item--in_progress { border-left-color: #42a5f5; }
.task-queue__item--error { border-left-color: #f44336; }

.task-queue__item-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.task-queue__item-title {
  font-size: 13px;
  color: var(--text-primary, #e2e8f0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-queue__item-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.task-queue__item-agent {
  font-size: 11px;
  color: var(--text-secondary, #64748b);
}

.task-queue__empty {
  text-align: center;
  padding: 16px;
  color: var(--text-secondary, #64748b);
  font-size: 13px;
}
</style>

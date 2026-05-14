<template>
  <div
    class="project-card"
    :class="{
      'project-card--active': project.status === 'active',
      'project-card--completed': project.status === 'completed',
      'project-card--error': project.status === 'error',
    }"
    @click="handleClick"
  >
    <!-- 头部 -->
    <div class="project-card__header">
      <div class="project-card__title-wrap">
        <el-tag
          v-if="project.status === 'active'"
          size="small"
          class="project-card__active-badge"
          style="background: rgba(76,175,80,0.2); color: #81c784; border-color: #4caf50;"
        >
          ● 活跃
        </el-tag>
        <h3 class="project-card__title">{{ project.name }}</h3>
      </div>
      <el-dropdown trigger="click" @command="handleCommand">
        <el-button link :icon="MoreFilled" class="project-card__menu-btn" />
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item :command="'scan'" v-if="project.status !== 'active'">
              <el-icon><Refresh /></el-icon> 扫描状态
            </el-dropdown-item>
            <el-dropdown-item :command="'setActive'" :disabled="project.status === 'active'">
              <el-icon><VideoPlay /></el-icon> 设为活跃
            </el-dropdown-item>
            <el-dropdown-item :command="'edit'">
              <el-icon><Edit /></el-icon> 编辑
            </el-dropdown-item>
            <el-dropdown-item :command="'detail'">
              <el-icon><View /></el-icon> 查看详情
            </el-dropdown-item>
            <el-dropdown-item :command="'delete'" divided>
              <el-icon><Delete /></el-icon> 删除
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <!-- 描述 -->
    <p class="project-card__desc" v-if="project.description">{{ project.description }}</p>

    <!-- 路径 -->
    <p class="project-card__path" v-if="fullPath" :title="fullPath">{{ fullPath }}</p>

    <!-- 进度条 -->
    <div class="project-card__progress">
      <div class="project-card__progress-label">
        <span>进度</span>
        <span class="project-card__progress-value">
          {{ project.progress }}%
          <el-tag v-if="project.manualOverride" size="small" type="warning" class="project-card__manual-tag">手动</el-tag>
        </span>
      </div>
      <el-progress
        :percentage="project.progress"
        :status="project.progress === 100 ? 'success' : project.status === 'error' ? 'exception' : undefined"
        :stroke-width="8"
        :show-text="false"
      />
      <div class="project-card__task-summary">
        {{ doneCount }}/{{ project.taskQueue?.length || 0 }} 任务完成
      </div>
    </div>

    <!-- 状态标签 -->
    <div class="project-card__footer">
      <el-tag :type="statusTagType" size="small" effect="dark">{{ statusLabel }}</el-tag>
      <span class="project-card__time">
        {{ formatDate(project.updatedAt) }}
      </span>
    </div>

    <!-- Tags -->
    <div class="project-card__tags" v-if="project.tags?.length">
      <el-tag v-for="tag in project.tags" :key="tag" size="small" effect="plain" class="project-card__tag">
        {{ tag }}
      </el-tag>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Project } from '../types'
import {
  MoreFilled,
  Refresh,
  VideoPlay,
  Edit,
  View,
  Delete,
} from '@element-plus/icons-vue'

const props = defineProps<{
  project: Project
}>()

const emit = defineEmits<{
  click: []
  command: [cmd: string]
}>()

const doneCount = computed(() =>
  props.project.taskQueue?.filter((t) => t.status === 'done').length ?? 0,
)

const fullPath = computed(() => {
  const p = props.project
  if (p.rootPath && p.subPath) return `${p.rootPath}/${p.subPath}`
  if (p.rootPath) return p.rootPath
  if (p.subPath) return p.subPath
  return ''
})

const statusLabel = computed(() => {
  const map: Record<string, string> = {
    pending: '待启动',
    active: '进行中',
    paused: '已暂停',
    completed: '已完成',
    error: '异常',
  }
  return map[props.project.status] ?? props.project.status
})

const statusTagType = computed(() => {
  const map: Record<string, string> = {
    pending: 'info',
    active: 'success',
    paused: 'warning',
    completed: '',
    error: 'danger',
  }
  return map[props.project.status] ?? 'info'
})

function formatDate(iso?: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  const Y = d.getFullYear()
  const M = String(d.getMonth() + 1).padStart(2, '0')
  const D = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${Y}-${M}-${D} ${h}:${m}`
}

function handleClick() {
  emit('click')
}

function handleCommand(cmd: string) {
  emit('command', cmd)
}
</script>

<style scoped>
.project-card {
  background: #1e293b;
  border: 1px solid var(--border-color, #334155);
  border-radius: 10px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.25s;
}

.project-card:hover {
  border-color: #42a5f5;
  box-shadow: 0 4px 16px rgba(66, 165, 245, 0.15);
  transform: translateY(-2px);
}

.project-card--active {
  border-color: #4caf50;
  box-shadow: 0 0 12px rgba(76, 175, 80, 0.2);
}

.project-card--completed {
  border-color: #607d8b;
  opacity: 0.85;
}

.project-card--error {
  border-color: #f44336;
}

.project-card__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.project-card__title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.project-card__active-badge {
  flex-shrink: 0;
}

.project-card__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary, #e2e8f0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.project-card__menu-btn {
  flex-shrink: 0;
  color: var(--text-secondary, #94a3b8);
  font-size: 18px;
}

.project-card__desc {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--text-secondary, #94a3b8);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.project-card__path {
  margin: 0 0 8px;
  font-size: 11px;
  font-family: 'Consolas', 'Courier New', monospace;
  color: var(--text-secondary, #64748b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.project-card__progress {
  margin-bottom: 10px;
}

.project-card__progress-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
  margin-bottom: 6px;
}

.project-card__progress-value {
  font-weight: 600;
  color: var(--text-primary, #e2e8f0);
}

.project-card__manual-tag {
  margin-left: 4px;
  font-size: 10px;
}

.project-card__task-summary {
  font-size: 11px;
  color: var(--text-secondary, #64748b);
  margin-top: 4px;
}

.project-card__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.project-card__time {
  font-size: 11px;
  color: var(--text-secondary, #64748b);
}

.project-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.project-card__tag {
  font-size: 11px;
}

:deep(.el-progress__text) {
  display: none;
}
</style>

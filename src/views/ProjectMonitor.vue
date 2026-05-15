<template>
  <div class="project-monitor">
    <!-- 工具栏 -->
    <div class="project-monitor__toolbar">
      <div class="project-monitor__toolbar-left">
        <h2 class="project-monitor__title">
          <el-icon :size="20" style="color: #42a5f5;"><Monitor /></el-icon>
          项目监控
        </h2>
        <div class="project-monitor__stats">
          <el-tag
            v-for="s in statusItems"
            :key="s.key"
            :type="s.type"
            size="small"
            effect="dark"
          >
            {{ s.label }}: {{ store.statusCounts[s.key] }}
          </el-tag>
        </div>
      </div>
      <div class="project-monitor__toolbar-right">
        <el-button :icon="Refresh" circle size="small" @click="handleScanAll" :loading="scanLoading" title="扫描所有项目" />
        <el-button type="primary" :icon="Plus" size="small" @click="openCreate">新建项目</el-button>
      </div>
    </div>

    <!-- 项目卡片网格 -->
    <div v-loading="store.loading" class="project-monitor__grid">
      <ProjectCard
        v-for="project in store.projects"
        :key="project.id"
        :project="project"
        @click="openDetail(project)"
        @command="(cmd: string) => handleCommand(cmd, project)"
      />

      <div v-if="store.projects.length === 0 && !store.loading" class="project-monitor__empty">
        <el-empty description="暂无项目" :image-size="80">
          <el-button type="primary" @click="openCreate">创建第一个项目</el-button>
        </el-empty>
      </div>
    </div>

    <!-- 详情抽屉 -->
    <ProjectDetailDrawer
      v-if="selectedProject"
      v-model:visible="detailVisible"
      :project="selectedProject"
      @edit="openEdit(selectedProject.id)"
    />

    <!-- 新建/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑项目' : '新建项目'"
      width="520px"
      destroy-on-close
      class="project-dialog"
    >
      <ProjectForm
        :project="editingProject"
        @submit="handleFormSubmit"
        @cancel="dialogVisible = false"
      />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useProjectStore } from '../stores/project'
import type { Project } from '../types'
import ProjectCard from '../components/ProjectCard.vue'
import ProjectDetailDrawer from '../components/ProjectDetailDrawer.vue'
import ProjectForm from '../components/ProjectForm.vue'
import { Monitor, Refresh, Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const store = useProjectStore()

const statusItems = [
  { key: 'pending', label: '待启动', type: 'info' as const },
  { key: 'active', label: '进行中', type: 'success' as const },
  { key: 'paused', label: '已暂停', type: 'warning' as const },
  { key: 'completed', label: '已完成', type: '' as const },
  { key: 'error', label: '异常', type: 'danger' as const },
]

// 详情抽屉
const detailVisible = ref(false)
const selectedProject = ref<Project | null>(null)

function openDetail(project: Project) {
  selectedProject.value = project
  detailVisible.value = true
}

// 对话框
const dialogVisible = ref(false)
const isEdit = ref(false)
const editingProject = ref<Project | null>(null)
const scanLoading = ref(false)

function openCreate() {
  isEdit.value = false
  editingProject.value = null
  dialogVisible.value = true
}

function openEdit(id: string) {
  const p = store.projects.find((x) => x.id === id)
  if (!p) return
  isEdit.value = true
  editingProject.value = p
  dialogVisible.value = true
}

async function handleFormSubmit(data: {
  name: string
  description?: string
  projectPath?: string
  status?: string
}) {
  if (isEdit.value && editingProject.value) {
    await store.updateProjectData(editingProject.value.id, data)
    ElMessage.success('项目已更新')
  } else {
    await store.createNewProject(data)
    ElMessage.success('项目已创建')
  }
  dialogVisible.value = false
}

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

    case 'edit':
      openEdit(project.id)
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

.project-monitor__toolbar-left {
  display: flex;
  flex-direction: column;
  gap: 10px;
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

.project-monitor__stats {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.project-monitor__toolbar-right {
  display: flex;
  gap: 8px;
  align-items: center;
}

.project-monitor__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
  min-height: 200px;
}

.project-monitor__empty {
  grid-column: 1 / -1;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 300px;
}

/* ==================== REC-083: 弹窗磨砂玻璃背景 ==================== */
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

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Project, ProjectStatus, ProjectTask } from '../types'
import {
  fetchProjects,
  fetchProject,
  createProject,
  updateProject,
  deleteProject,
  setActiveProject,
  scanProject,
  scanAllProjects,
  fetchTasks,
} from '../api/projects'

export const useProjectStore = defineStore('project', () => {
  const projects = ref<Project[]>([])
  const loading = ref(false)
  const activeProjectId = ref<string | null>(null)
  const error = ref<string | null>(null)
  const lastScanAt = ref<string | null>(null)

  // ─── Computed ───

  const activeProject = computed(
    () => projects.value.find((p) => p.id === activeProjectId.value) ?? null,
  )

  const projectCount = computed(() => projects.value.length)

  const statusCounts = computed(() => {
    const counts: Record<ProjectStatus, number> = {
      pending: 0,
      running: 0,
      active: 0,
      paused: 0,
      completed: 0,
      error: 0,
    }
    for (const p of projects.value) {
      counts[p.status] = (counts[p.status] || 0) + 1
      // running 和 active 视为同义
      if (p.status === 'active') counts.running = (counts.running || 0) + 1
      if (p.status === 'running') counts.active = (counts.active || 0) + 1
    }
    return counts
  })

  // ─── Actions ───

  async function loadProjects(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const result = await fetchProjects()
      projects.value = result.projects
      if (result.activeProjectId) activeProjectId.value = result.activeProjectId
    } catch (e: unknown) {
      error.value = (e as Error).message ?? '加载失败'
      console.error('[ProjectStore] loadProjects error:', e)
    } finally {
      loading.value = false
    }
  }

  async function loadProject(id: string): Promise<Project | null> {
    try {
      return await fetchProject(id)
    } catch (e) {
      console.error(`[ProjectStore] loadProject(${id}) error:`, e)
      return null
    }
  }

  async function createNewProject(data: {
    name: string
    description?: string
    projectPath?: string
    status?: string
  }): Promise<Project | null> {
    loading.value = true
    try {
      // 兼容旧接口：projectPath → rootPath
      const payload = {
        name: data.name,
        description: data.description,
        rootPath: data.projectPath || data.rootPath,
      }
      const project = await createProject(payload as any)
      projects.value.push(project)
      return project
    } catch (e) {
      error.value = (e as Error).message ?? '创建失败'
      return null
    } finally {
      loading.value = false
    }
  }

  async function updateProjectData(
    id: string,
    data: {
      name?: string
      description?: string
      projectPath?: string
      status?: string
      progress?: number
      manualOverride?: boolean
      tags?: string[]
      linkedAgents?: string[]
    },
  ): Promise<Project | null> {
    try {
      const payload = {
        name: data.name,
        description: data.description,
        rootPath: data.projectPath,
        status: data.status,
        progress: data.progress,
        manualOverride: data.manualOverride,
        tags: data.tags,
        linkedAgents: data.linkedAgents,
      }
      const updated = await updateProject(id, payload as any)
      const idx = projects.value.findIndex((p) => p.id === id)
      if (idx >= 0) projects.value[idx] = updated
      return updated
    } catch (e) {
      error.value = (e as Error).message ?? '更新失败'
      return null
    }
  }

  async function removeProject(id: string): Promise<boolean> {
    try {
      await deleteProject(id)
      projects.value = projects.value.filter((p) => p.id !== id)
      if (activeProjectId.value === id) activeProjectId.value = null
      return true
    } catch (e) {
      error.value = (e as Error).message ?? '删除失败'
      return false
    }
  }

  async function setActive(id: string): Promise<boolean> {
    try {
      const result = await setActiveProject(id)
      activeProjectId.value = result.activeProjectId ?? id
      // 如果后端返回了原活跃项目的状态变更，同步更新
      if (result.previousActive) {
        const prev = result.previousActive
        const idx = projects.value.findIndex((p) => p.id === prev.projectId)
        if (idx >= 0) {
          projects.value[idx] = {
            ...projects.value[idx],
            status: prev.newStatus as ProjectStatus,
          }
        }
      }
      return true
    } catch (e) {
      error.value = (e as Error).message ?? '切换失败'
      return false
    }
  }

  async function scan(id: string): Promise<boolean> {
    try {
      await scanProject(id)
      lastScanAt.value = new Date().toISOString()
      return true
    } catch (e) {
      error.value = (e as Error).message ?? '扫描失败'
      return false
    }
  }

  async function scanAll(): Promise<boolean> {
    try {
      await scanAllProjects()
      lastScanAt.value = new Date().toISOString()
      // 扫描后刷新列表
      await loadProjects()
      return true
    } catch (e) {
      error.value = (e as Error).message ?? '扫描失败'
      return false
    }
  }

  async function loadTasks(id: string): Promise<ProjectTask[]> {
    try {
      return await fetchTasks(id)
    } catch (e) {
      console.error(`[ProjectStore] loadTasks(${id}) error:`, e)
      return []
    }
  }

  return {
    projects,
    loading,
    activeProjectId,
    error,
    lastScanAt,
    activeProject,
    projectCount,
    statusCounts,
    loadProjects,
    loadProject,
    createNewProject,
    updateProjectData,
    removeProject,
    setActive,
    scan,
    scanAll,
    loadTasks,
  }
})

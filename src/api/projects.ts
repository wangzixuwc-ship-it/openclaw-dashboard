import axios from 'axios'
import type {
  Project,
  ProjectCreatePayload,
  ProjectUpdatePayload,
  ProjectTask,
} from '../types'

// 统一服务端口 31002
// 开发环境走 Vite proxy /api/projects → localhost:31002
// 生产环境直连
const BASE = import.meta.env.DEV
  ? '/api/projects'
  : `${import.meta.env.VITE_BACKEND_URL || 'http://localhost:31002'}/api/projects`

const http = axios.create({
  baseURL: BASE,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

// Response interceptor — unwrap data
http.interceptors.response.use(
  (res) => res.data,
  (err) => Promise.reject(err.response?.data || err),
)

// ─── Project CRUD ───

/**
 * GET /api/projects — 获取所有项目
 * 后端返回: { success: true, data: { activeProjectId, scanIntervalMs, projects } }
 * @returns [projects[], activeProjectId]
 */
export function fetchProjects(): Promise<{ projects: Project[]; activeProjectId: string | null }> {
  return http.get('').then((d) => {
    const data = (d as any)?.data ?? d
    return {
      projects: Array.isArray(data?.projects) ? data.projects : [],
      activeProjectId: data?.activeProjectId ?? null,
    }
  })
}

/**
 * GET /api/projects/:id — 获取项目详情
 * 后端返回: { success: true, project }
 */
export function fetchProject(id: string): Promise<Project> {
  return http.get(`/${id}`).then((d) => (d as any)?.project ?? d)
}

/**
 * POST /api/projects — 创建项目
 * 后端返回: { success: true, project }
 */
export function createProject(payload: ProjectCreatePayload): Promise<Project> {
  return http.post('', payload).then((d) => (d as any)?.project ?? d)
}

/**
 * PUT /api/projects/:id — 更新项目
 * 后端返回: { success: true, project }
 */
export function updateProject(id: string, payload: ProjectUpdatePayload): Promise<Project> {
  return http.put(`/${id}`, payload).then((d) => (d as any)?.project ?? d)
}

/** DELETE /api/projects/:id — 删除项目 */
export function deleteProject(id: string): Promise<{ success: boolean }> {
  return http.delete(`/${id}`)
}

// ─── Active / Scan ───

/** PATCH /api/projects/:id/active — 设为活跃项目 */
export function setActiveProject(id: string): Promise<{
  success: boolean
  activeProjectId: string
  previousActive?: { projectId: string; previousStatus: string; newStatus: string }
}> {
  return http.patch(`/${id}/active`)
}

/** POST /api/projects/:id/scan — 扫描单个项目 */
export function scanProject(id: string): Promise<{ success: boolean }> {
  return http.post(`/${id}/scan`)
}

/** POST /api/projects/scan-all — 扫描所有项目 */
export function scanAllProjects(): Promise<{ success: boolean }> {
  return http.post('/scan-all')
}

// ─── Task Queue ───

/** GET /api/projects/:id/tasks — 获取任务队列 */
export function fetchTasks(id: string): Promise<ProjectTask[]> {
  return http.get(`/${id}/tasks`).then((d) => (Array.isArray(d) ? d : (d as any)?.tasks || []))
}

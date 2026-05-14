/**
 * Shared type definitions for the OpenClaw Dashboard
 */

// ── Agent Info (normalized) ──
// Note: AgentInfo is exported from stores/agent.ts; kept here for type-only imports if needed.

// ── Project Monitor Types (REC-067) ──

export type ProjectStatus = 'pending' | 'active' | 'paused' | 'completed' | 'error'
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'error'

export interface ProjectTask {
  id: string
  title: string
  status: TaskStatus
  assignedAgent?: string
  createdAt: string
  completedAt?: string
}

export interface Project {
  id: string
  name: string
  description: string
  rootPath: string             // 主项目根目录（绝对路径）
  subPath: string              // 子路径（相对路径）
  status: ProjectStatus
  progress: number
  manualOverride: boolean
  createdAt: string
  updatedAt: string
  tags: string[]
  linkedAgents: string[]
  taskQueue: ProjectTask[]
}

export interface ProjectCreatePayload {
  name: string
  description?: string
  rootPath?: string            // 主项目根目录（绝对路径）
  subPath?: string             // 子路径（相对路径）
  tags?: string[]
  linkedAgents?: string[]
}

export interface ProjectUpdatePayload {
  name?: string
  description?: string
  rootPath?: string            // 主项目根目录（绝对路径）
  subPath?: string             // 子路径（相对路径）
  progress?: number
  manualOverride?: boolean
  tags?: string[]
  linkedAgents?: string[]
}

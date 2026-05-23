/**
 * 工作流步骤数据定义
 *
 * 该文件存放 Agent 工作流/任务的流程进度数据，
 * 用于在 Dashboard 统计区与看板之间展示步进组件（Simple Step Bar）。
 *
 * 数据结构:
 * - activeStep: 当前处于第几步（0-based），-1 表示无活跃流程
 * - steps: 步骤数组，每步包含标题、描述和状态
 */

export interface WorkflowStep {
  /** 步骤标题 */
  title: string
  /** 步骤说明（仅用于非 Simple 模式） */
  description?: string
  /**
   * 步骤状态（留空则由 Steps 组件根据 activeStep 自动计算）
   * 'waiting' | 'process' | 'finish' | 'error' | 'success'
   */
  status?: 'waiting' | 'process' | 'finish' | 'error' | 'success'
}

export interface WorkflowData {
  /** 当前活跃步骤索引（0-based），-1 表示无流程 */
  activeStep: number
  /** 流程步骤列表 */
  steps: WorkflowStep[]
  /** 项目名称（可选） */
  projectName?: string
  /** 任务概要（可选） */
  taskSummary?: string
  /** 运行模式（可选）：极速/简化/正常/最优 */
  mode?: string
}

/** 空工作流状态 — 表示没有流程进度，Dashboard 将显示原始横线分割线 */
export const emptyWorkflow: WorkflowData = {
  activeStep: -1,
  steps: [],
}

/**
 * 默认的流程步骤定义
 * 描述一个 Agent 任务的完整生命周期
 */
export const WORKFLOW_STEPS: WorkflowStep[] = [
  { title: '任务接收', description: '接收并解析任务指令' },
  { title: '上下文加载', description: '加载会话历史和系统提示' },
  { title: '任务执行', description: 'Agent 正在执行任务' },
  { title: '工具调用', description: '调用外部工具获取信息' },
  { title: '结果生成', description: '生成最终回复' },
]
const defaultSteps = WORKFLOW_STEPS

/**
 * 默认工作流数据
 * activeStep 默认为 -1（无流程），调用方根据实际数据更新
 */
export const defaultWorkflow: WorkflowData = {
  activeStep: -1,
  steps: defaultSteps,
}

/**
 * 模拟示例：一个运行中的工作流（activeStep = 2，表示执行到"任务执行"阶段）
 * 调用方可直接导入使用或作为参考模板
 */
export const sampleRunningWorkflow: WorkflowData = {
  activeStep: 2,
  steps: [
    { title: '任务接收', status: 'finish' },
    { title: '上下文加载', status: 'finish' },
    { title: '任务执行', status: 'process' },
    { title: '工具调用', status: 'waiting' },
    { title: '结果生成', status: 'waiting' },
  ],
}

<template>
  <div class="dashboard">
    <!-- ========= 1. 顶部状态栏 ========= -->
    <header class="status-bar">
      <div class="status-bar-inner">
        <div class="brand">
          <el-icon :size="24" class="brand-icon"><Monitor /></el-icon>
          <h1 class="brand-title">
            OpenClaw 监控台
            <span class="brand-version">v{{ APP_VERSION }}</span>
          </h1>
          <span class="brand-time">{{ currentTime }}</span>
        </div>

        <!-- 顶部右侧：版本 + 网关 + 通知 + 自定义布局 -->
        <div class="status-top-right">
          <!-- 版本 -->
          <el-tooltip content="点击切换 OpenClaw 版本" placement="bottom">
            <button class="top-indicator top-indicator-version" @click="versionDialogVisible = true">
              <el-icon :size="13"><Box /></el-icon>
              <span class="top-ind-label">OpenClaw 版本</span>
              <span class="top-ind-value mono">{{ store.gatewayVersion || '未知' }}</span>
            </button>
          </el-tooltip>

          <!-- 网关健康 -->
          <el-tooltip content="点击诊断网关问题" placement="bottom">
            <button class="top-indicator" :class="`top-indicator-${store.healthStatus}`" @click="doctorDialogVisible = true">
              <el-icon :size="13"><component :is="healthIcon" /></el-icon>
              <span class="top-ind-label">网关</span>
              <span class="top-ind-value">{{ healthDisplay }}</span>
            </button>
          </el-tooltip>

          <!-- 通知中心 -->
          <el-popover placement="bottom-end" :width="360" trigger="click" popper-class="notif-popper">
            <template #reference>
              <button class="top-indicator top-indicator-notif" :class="{ 'has-unread': store.unreadNotifications > 0 }">
                <el-icon :size="13"><Bell /></el-icon>
                <span class="top-ind-label">通知中心</span>
                <span class="top-ind-value">{{ store.unreadNotifications > 0 ? `${store.unreadNotifications} 条未读` : '无新通知' }}</span>
                <span v-if="store.unreadNotifications > 0" class="top-notif-badge">{{ store.unreadNotifications > 9 ? '9+' : store.unreadNotifications }}</span>
              </button>
            </template>
            <template #default>
              <div class="notif-panel">
                <div class="notif-header">
                  <span>通知中心</span>
                  <div class="notif-actions">
                    <el-button link size="small" @click="store.markAllNotificationsRead()" :disabled="store.unreadNotifications === 0">全部已读</el-button>
                    <el-button link size="small" type="danger" @click="store.clearNotifications()" :disabled="store.notifications.length === 0">清空</el-button>
                  </div>
                </div>
                <div v-if="store.notifications.length === 0" class="notif-empty">
                  <el-icon><BellFilled /></el-icon>
                  暂无通知
                </div>
                <div v-else class="notif-list">
                  <div
                    v-for="n in store.notifications"
                    :key="n.id"
                    class="notif-item"
                    :class="[`notif-${n.type}`, { unread: !n.read }]"
                  >
                    <span class="notif-icon">{{ n.type === 'error' ? '🔴' : n.type === 'aborted' ? '⚪' : 'ℹ️' }}</span>
                    <div class="notif-body">
                      <div class="notif-agent">{{ n.agentName }}</div>
                      <div class="notif-msg">{{ n.message }}</div>
                      <div class="notif-time">{{ formatNotifTime(n.timestamp) }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </el-popover>

          <!-- Sprint 7: 全局搜索 cmd+K -->
          <el-tooltip content="全局搜索（⌘K）" placement="bottom">
            <button class="top-indicator top-indicator-search" @click="commandPaletteVisible = true">
              <el-icon :size="13"><Search /></el-icon>
              <span class="top-ind-label">搜索</span>
              <kbd class="top-ind-kbd">⌘K</kbd>
            </button>
          </el-tooltip>

          <!-- Sprint 9: #18 主题切换（Dark/Light Theme Toggle）-->
          <el-tooltip :content="isDark ? '切换亮色主题' : '切换暗色主题'" placement="bottom">
            <button class="top-indicator top-indicator-theme" @click="toggleTheme">
              <span class="theme-icon">{{ isDark ? '☀️' : '🌙' }}</span>
              <span class="top-ind-label">{{ isDark ? '亮色' : '暗色' }}</span>
            </button>
          </el-tooltip>

          <!-- 自定义布局 -->
          <el-tooltip content="自定义布局：排序功能按钮 / 统计卡片" placement="bottom">
            <button class="top-layout-btn" @click="layoutDialogVisible = true">
              <el-icon :size="14"><Operation /></el-icon>
              <span>自定义布局</span>
            </button>
          </el-tooltip>
        </div>
      </div>
    </header>

    <!-- ========= 2. 统计区 ========= -->
    <section class="stats-section">
        <div class="stats-inner">
          <el-card
            v-for="stat in statsCards"
            :key="stat.label"
            class="stat-card"
            :class="stat.class"
            shadow="hover"
            @click="stat.onClick?.()"
          >
            <div class="stat-card-inner">
              <div class="stat-icon-wrap" :class="stat.iconClass">
                <el-icon :size="26"><component :is="stat.icon" /></el-icon>
              </div>
              <div class="stat-text">
                <div class="stat-number">{{ stat.value }}</div>
                <div class="stat-label">
                  {{ stat.label }}
                  <span v-if="stat.subtitle" class="stat-subtitle">{{ stat.subtitle }}</span>
                </div>
              </div>
            </div>
          </el-card>
        </div>
      </section>

    <!-- ========= 2.5 功能区（原顶部按钮，下移放大）========= -->
    <section class="action-bar-section">
      <div class="action-bar-inner">
        <!-- GPU VRAM Usage -->
        <div
          class="action-slot"
          v-if="store.gpuVramPercentage !== null && store.gpuVramPercentage !== undefined"
          :style="{ order: statusBarOrder('gpu') }"
        >
          <el-tooltip :content="`${store.gpuVramUsedMb} / ${store.gpuVramTotalMb} MB`" placement="top">
            <button class="action-btn action-gpu">
              <el-icon :size="22"><Monitor /></el-icon>
              <div class="action-text">
                <div class="action-label">GPU 显存</div>
                <div class="action-value">{{ store.gpuVramPercentage }}%</div>
              </div>
            </button>
          </el-tooltip>
        </div>

        <!-- 文件管理 -->
        <div class="action-slot" :style="{ order: statusBarOrder('fileManager') }">
          <button class="action-btn" @click="fileManagerVisible = true">
            <el-icon :size="22"><Folder /></el-icon>
            <div class="action-text">
              <div class="action-label">文件管理</div>
              <div class="action-value">系统文件预览</div>
            </div>
          </button>
        </div>

        <!-- 计费配置 -->
        <div class="action-slot" :style="{ order: statusBarOrder('billing') }">
          <button class="action-btn" @click="billingDialogVisible = true">
            <el-icon :size="22"><Money /></el-icon>
            <div class="action-text">
              <div class="action-label">计费配置</div>
              <div class="action-value">按模型定价</div>
            </div>
          </button>
        </div>

        <!-- 技能库 -->
        <div class="action-slot" :style="{ order: statusBarOrder('skills') }">
          <button class="action-btn" @click="skillsDialogVisible = true">
            <el-icon :size="22"><Briefcase /></el-icon>
            <div class="action-text">
              <div class="action-label">技能库</div>
              <div class="action-value">管理 / 安装技能</div>
            </div>
          </button>
        </div>

        <!-- WebUI -->
        <div class="action-slot" :style="{ order: statusBarOrder('webui') }">
          <button class="action-btn" @click="openWebUI">
            <el-icon :size="22"><Link /></el-icon>
            <div class="action-text">
              <div class="action-label">WebUI</div>
              <div class="action-value">原生控制台</div>
            </div>
          </button>
        </div>

        <!-- 项目看板 -->
        <div class="action-slot" :style="{ order: statusBarOrder('projects') }">
          <button class="action-btn action-projects" @click="projectBoardVisible = true">
            <el-icon :size="22"><Grid /></el-icon>
            <div class="action-text">
              <div class="action-label">项目看板</div>
              <div class="action-value">{{ projectSummary }}</div>
            </div>
          </button>
        </div>

        <!-- Cron 任务中心 -->
        <div class="action-slot" :style="{ order: statusBarOrder('cron') }">
          <button class="action-btn action-cron" @click="cronCenterVisible = true">
            <el-icon :size="22"><Timer /></el-icon>
            <div class="action-text">
              <div class="action-label">定时任务</div>
              <div class="action-value">Cron 中心</div>
            </div>
          </button>
        </div>
      </div>
    </section>

    <!-- ========= 3. 工作流进度步进条 / 空状态 ========= -->
    <div class="workflow-section" v-if="workflowData.projectName">
      <el-card shadow="hover" class="workflow-card">
        <div class="workflow-card-header">
          <span class="workflow-project-name">{{ workflowData.projectName }}</span>
          <div class="workflow-header-right" v-if="workflowData.activeStep >= 0">
            <span v-if="workflowData.taskSummary" class="workflow-task-summary-inline">
              {{ workflowData.taskSummary }}
            </span>
            <el-tag v-if="workflowData.mode" size="small" :type="getModeTagType(workflowData.mode)" effect="plain" class="workflow-mode-tag">
              {{ workflowData.mode }}
            </el-tag>
          </div>
          <div v-if="workflowData.steps.length > 0 && workflowData.activeStep >= 0">
            <span class="workflow-step-label">
              第 {{ workflowData.activeStep + 1 }} / {{ workflowData.steps.length }} 步
            </span>
          </div>
        </div>

        <div v-if="workflowData.activeStep >= 0 && workflowData.steps.length > 0" class="workflow-steps-simple">
          <template v-for="(step, idx) in workflowData.steps" :key="idx">
            <div class="workflow-step-simple-item" :class="{ 'is-active': idx === workflowData.activeStep }">
              <span class="simple-step-circle" :class="getSimpleStepClass(idx)"></span>
              <span class="simple-step-title">{{ step.title }}</span>
            </div>
            <div
              v-if="idx < workflowData.steps.length - 1"
              class="step-arrow-group"
              :class="getArrowState(idx)"
            >
              <el-icon class="step-arrow-chevron" :style="{ animationDelay: '0ms' }"><ArrowRight /></el-icon>
              <el-icon class="step-arrow-chevron" :style="{ animationDelay: '200ms' }"><ArrowRight /></el-icon>
              <el-icon class="step-arrow-chevron" :style="{ animationDelay: '400ms' }"><ArrowRight /></el-icon>
            </div>
          </template>
        </div>

        <div v-else class="workflow-empty-state">
          <el-icon :size="28" class="workflow-empty-icon"><VideoPause /></el-icon>
          <span class="workflow-empty-text">当前无任务执行</span>
        </div>
      </el-card>
    </div>

    <el-divider v-if="!workflowData.projectName" style="margin:0;"></el-divider>

    <!-- ========= 3.5 内联活动时间线（Inline Activity Timeline，可折叠）=========
         layoutConfig.sections.timeline 控制是否显示（可在自定义布局关闭）
    -->
    <section
      v-if="layoutConfig.sections?.timeline !== false"
      class="inline-timeline-section"
      :class="{ collapsed: layoutConfig.timelineCollapsed }"
    >
      <!-- 折叠栏头 -->
      <div class="itl-bar" @click="toggleTimelineCollapsed()">
        <span class="itl-bar-icon">📈</span>
        <span class="itl-bar-label">活动时间线</span>
        <span class="itl-bar-hint">Gantt 图</span>
        <span class="itl-bar-arrow">{{ layoutConfig.timelineCollapsed ? '▶' : '▼' }}</span>
      </div>
      <!-- 折叠内容（收起时 v-show 控制隐藏但保留 DOM）-->
      <div v-show="!layoutConfig.timelineCollapsed" class="itl-content">
        <ActivityTimelineDialog :inline="true" />
      </div>
    </section>

    <!-- ========= 3.6 内联版本迭代说明（Inline Changelog Panel，可折叠）=========
         layoutConfig.sections.changelog 控制是否显示（可在自定义布局关闭）
    -->
    <section
      v-if="layoutConfig.sections?.changelog !== false"
      class="inline-changelog-section"
      :class="{ collapsed: layoutConfig.changelogCollapsed }"
    >
      <!-- 折叠栏头 -->
      <div class="icl-bar" @click="toggleChangelogCollapsed()">
        <span class="icl-bar-icon">📋</span>
        <span class="icl-bar-label">版本迭代说明</span>
        <span class="icl-bar-hint">Changelog · 版本回退</span>
        <span class="icl-bar-badge">v{{ APP_VERSION }}</span>
        <span class="icl-bar-arrow">{{ layoutConfig.changelogCollapsed ? '▶' : '▼' }}</span>
      </div>
      <!-- 折叠内容 -->
      <div v-show="!layoutConfig.changelogCollapsed" class="icl-content">
        <ChangelogPanel />
      </div>
    </section>

    <!-- ========= 4. 看板主体（5列：空闲/运行中/已终止/错误/未知） ========= -->
    <main class="board-container">
      <!-- 空闲列 -->
      <div class="board-column board-column-idle">
        <div class="board-column-header" style="border-bottom-color: #f59e0b;">
          <span style="color: #f59e0b; font-weight: 700; font-size: 13px;">
            <el-icon><VideoPause /></el-icon>
            空闲
          </span>
          <el-tag size="small" style="background: rgba(245,158,11,0.15); color: #f59e0b; border-color: #f59e0b;">
            {{ store.idleAgents.length }} 个
          </el-tag>
        </div>
        <div class="board-column-tasks" v-loading="store.isPolling && store.agents.length === 0">
          <AgentCard
            v-for="agent in store.idleAgents"
            :key="agent.key"
            :agent="agent"
            :latest-messages="store.getAgentBubbles(agent.key)"
            @detail="onAgentDetail"
          />
          <el-empty v-if="store.idleAgents.length === 0 && !store.isPolling" description="暂无空闲的 Agent" :image-size="50" />
        </div>
      </div>

      <!-- 运行中列 -->
      <div class="board-column board-column-running">
        <div class="board-column-header" style="border-bottom-color: #3b82f6;">
          <span style="color: #3b82f6; font-weight: 700; font-size: 13px;">
            <el-icon><VideoPlay /></el-icon>
            运行中
          </span>
          <el-tag size="small" style="background: rgba(59,130,246,0.15); color: #3b82f6; border-color: #3b82f6;">
            {{ store.runningAgents.length }} 个
          </el-tag>
        </div>
        <div class="board-column-tasks">
          <AgentCard
            v-for="agent in store.runningAgents"
            :key="agent.key"
            :agent="agent"
            :latest-messages="store.getAgentBubbles(agent.key)"
            @detail="onAgentDetail"
          />
          <el-empty v-if="store.runningAgents.length === 0" description="暂无运行中的 Agent" :image-size="50" />
        </div>
      </div>

      <!-- 已终止列 -->
      <div class="board-column board-column-aborted">
        <div class="board-column-header" style="border-bottom-color: #6b7280;">
          <span style="color: #6b7280; font-weight: 700; font-size: 13px;">
            <el-icon><CircleClose /></el-icon>
            已终止
          </span>
          <el-tag size="small" style="background: rgba(107,114,128,0.15); color: #6b7280; border-color: #6b7280;">
            {{ store.abortedAgents.length }} 个
          </el-tag>
        </div>
        <div class="board-column-tasks">
          <AgentCard
            v-for="agent in store.abortedAgents"
            :key="agent.key"
            :agent="agent"
            :latest-messages="store.getAgentBubbles(agent.key)"
            @detail="onAgentDetail"
          />
          <el-empty v-if="store.abortedAgents.length === 0" description="暂无已终止的 Agent" :image-size="50" />
        </div>
      </div>

      <!-- 错误列 -->
      <div class="board-column board-column-error">
        <div class="board-column-header" style="border-bottom-color: #ef4444;">
          <span style="color: #ef4444; font-weight: 700; font-size: 13px;">
            <el-icon><CircleClose /></el-icon>
            错误
          </span>
          <el-tag size="small" style="background: rgba(239,68,68,0.15); color: #ef4444; border-color: #ef4444;">
            {{ store.errorAgents.length }} 个
          </el-tag>
        </div>
        <div class="board-column-tasks">
          <AgentCard
            v-for="agent in store.errorAgents"
            :key="agent.key"
            :agent="agent"
            :latest-messages="store.getAgentBubbles(agent.key)"
            @detail="onAgentDetail"
          />
          <el-empty v-if="store.errorAgents.length === 0" description="暂无错误的 Agent" :image-size="50" />
        </div>
      </div>

      <!-- 未知列 -->
      <div class="board-column board-column-unknown">
        <div class="board-column-header" style="border-bottom-color: #9ca3af;">
          <span style="color: #9ca3af; font-weight: 700; font-size: 13px;">
            <el-icon><QuestionFilled /></el-icon>
            未知
          </span>
          <el-tag size="small" style="background: rgba(156,163,175,0.15); color: #9ca3af; border-color: #9ca3af;">
            {{ store.unknownAgents.length }} 个
          </el-tag>
        </div>
        <div class="board-column-tasks">
          <AgentCard
            v-for="agent in store.unknownAgents"
            :key="agent.key"
            :agent="agent"
            :latest-messages="store.getAgentBubbles(agent.key)"
            @detail="onAgentDetail"
          />
          <el-empty v-if="store.unknownAgents.length === 0" description="暂无未知状态的 Agent" :image-size="50" />
        </div>
      </div>
    </main>

    <!-- Agent Detail Drawer -->
    <AgentDetailDrawer
      v-model:visible="drawerVisible"
      :agent-data="selectedAgent"
      :auto-focus-input="drawerAutoFocusInput"
    />

    <!-- Token 消耗详情弹窗 -->
    <TokenDetailDialog v-model:visible="tokenDetailVisible" />

    <!-- Version Dialog (REC-068) -->
    <VersionDialog v-model:visible="versionDialogVisible" :current-version="store.gatewayVersion || ''" />

    <!-- Gateway Doctor Dialog (REC-003) -->
    <GatewayDoctorDialog
      v-model:visible="doctorDialogVisible"
      @refresh="refreshAll"
    />

    <!-- Skills Dialog (REC-005) -->
    <SkillsDialog v-model:visible="skillsDialogVisible" />

    <!-- 计费配置 Dialog -->
    <BillingConfigDialog v-model:visible="billingDialogVisible" />

    <!-- 文件管理 Dialog -->
    <FileManagerDialog v-model:visible="fileManagerVisible" />

    <!-- 自定义布局 Dialog -->
    <LayoutSettingsDialog v-model:visible="layoutDialogVisible" />

    <!-- 项目看板 Dialog -->
    <ProjectBoardDialog v-model:visible="projectBoardVisible" />

    <!-- Cron 任务中心 Dialog -->
    <CronCenterDialog v-model:visible="cronCenterVisible" />

    <!-- Sprint 7: 命令面板 + 活动时间线 -->
    <CommandPaletteDialog
      v-model="commandPaletteVisible"
      @open-action="handlePaletteAction"
      @navigate-agent="handlePaletteNavigateAgent"
    />
    <!-- ActivityTimelineDialog 已改为内联时间线区域，保留弹窗备用（从命令面板打开）-->
    <ActivityTimelineDialog v-model="activityTimelineVisible" />


    <!-- Sprint 9: #6 快捷消息发送 FAB（Floating Action Button 浮动操作按钮）-->
    <QuickMsgFab />

    <!-- REC-011: 加载超时提示 -->
    <el-alert
      v-if="loadingHintVisible"
      title="正在加载，请稍候..."
      type="info"
      :closable="false"
      show-icon
      class="loading-hint-alert"
      plain
    >
      <template #default>
        <span>数据加载中（已超过 10 秒），请耐心等待...</span>
      </template>
    </el-alert>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAgentStore, type AgentInfo } from '../stores/agent'
import { getAuthToken } from '../config/auth'
import AgentCard from '../components/AgentCard.vue'
import AgentDetailDrawer from '../components/AgentDetailDrawer.vue'
import TokenDetailDialog from '../components/TokenDetailDialog.vue'
import VersionDialog from '../components/VersionDialog.vue'
import GatewayDoctorDialog from '../components/GatewayDoctorDialog.vue'
import SkillsDialog from '../components/SkillsDialog.vue'
import BillingConfigDialog from '../components/BillingConfigDialog.vue'
import FileManagerDialog from '../components/FileManagerDialog.vue'
import LayoutSettingsDialog from '../components/LayoutSettingsDialog.vue'
import ProjectBoardDialog from '../components/ProjectBoardDialog.vue'
import CronCenterDialog from '../components/CronCenterDialog.vue'
import CommandPaletteDialog from '../components/CommandPaletteDialog.vue'
import ActivityTimelineDialog from '../components/ActivityTimelineDialog.vue'
import ChangelogPanel from '../components/ChangelogPanel.vue'
import QuickMsgFab from '../components/QuickMsgFab.vue'
import { useLayoutSettings } from '../composables/useLayoutSettings'
import { useTheme } from '../composables/useTheme'
import { type WorkflowData } from '../data/workflow-steps'
import {
  Monitor,
  CircleCheck,
  Warning,
  Odometer,
  VideoPlay,
  VideoPause,
  CircleClose,
  Money,
  ArrowRight,
  QuestionFilled,
  Briefcase,
  Folder,
  Bell,
  BellFilled,
  Operation,
  Box,
  Link,
  Grid,
  Timer,
  Search,
} from '@element-plus/icons-vue'
// el import removed (unused)

// App version from package.json (injected by Vite define)
const APP_VERSION: string = __APP_VERSION__

const store = useAgentStore()

// Real-time clock in status bar (updates every minute)
const currentTime = ref('')
let clockTimer: ReturnType<typeof setInterval> | null = null

function updateClock(): void {
  const now = new Date()
  const Y = now.getFullYear()
  const M = String(now.getMonth() + 1).padStart(2, '0')
  const D = String(now.getDate()).padStart(2, '0')
  const h = String(now.getHours()).padStart(2, '0')
  const m = String(now.getMinutes()).padStart(2, '0')
  currentTime.value = `${Y}年${M}月${D}日 ${h}:${m}`
}

// Workflow steps data (REC-031: 从 workflow-progress.json 轮询)
const workflowData = ref<WorkflowData>({ activeStep: -1, steps: [] })
let workflowTimer: ReturnType<typeof setInterval> | null = null

async function fetchWorkflowData(): Promise<void> {
  try {
    const res = await fetch('/workflow-progress.json?t=' + Date.now())
    if (res.ok) {
      const data: WorkflowData = await res.json()
      workflowData.value = data
    }
  } catch {
    // 保持当前值
  }
}

/** 运行模式标签颜色映射 */
function getModeTagType(mode: string): string {
  const map: Record<string, string> = {
    '极速': 'danger',
    '简化': 'warning',
    '正常': 'primary',
    '最优': 'success',
  }
  return map[mode] || 'info'
}

/** 根据步骤索引返回圆点状态 class (Element Plus Simple 风格) */
function getSimpleStepClass(idx: number): string {
  const active = workflowData.value.activeStep
  if (idx < active) return 'simple-step-finished'
  if (idx === active) return 'simple-step-process'
  return 'simple-step-waiting'
}

/** 根据步骤索引返回箭头组的状态 class */
function getArrowState(idx: number): string {
  const active = workflowData.value.activeStep
  if (idx < active) return 'arrow-finished'   // 已完成节点后的箭头
  if (idx === active) return 'arrow-process'  // 正在执行节点后的箭头
  return 'arrow-waiting'                      // 未完成节点后的箭头
}

// Drawer
const drawerVisible = ref(false)
const selectedAgent = ref<AgentInfo | null>(null)

// Token 详情弹窗
const tokenDetailVisible = ref(false)

// Version dialog
const versionDialogVisible = ref(false)

// Gateway Doctor dialog (REC-003)
const doctorDialogVisible = ref(false)

// Skills dialog (REC-005)
const skillsDialogVisible = ref(false)

// 计费配置 dialog
const billingDialogVisible = ref(false)

// 文件管理 dialog
const fileManagerVisible = ref(false)

// 自定义布局
const { config: layoutConfig, toggleTimelineCollapsed, toggleChangelogCollapsed } = useLayoutSettings()
const layoutDialogVisible = ref(false)

// 项目看板
const projectBoardVisible = ref(false)
const projectSummary = ref('查看项目进度')

// Cron 任务中心
const cronCenterVisible = ref(false)

// Sprint 7: 命令面板 + 活动时间线弹窗备用（命令面板打开）
const commandPaletteVisible = ref(false)
const activityTimelineVisible = ref(false)

// Sprint 9: #18 主题切换（Dark/Light Theme Toggle）
const { isDark, toggleTheme } = useTheme()


function statusBarOrder(id: string): number {
  const idx = layoutConfig.value.statusBar.indexOf(id)
  return idx === -1 ? 100 : idx
}

// REC-011: 加载超时提示（加载超过 10s 时显示）
const loadingHintVisible = ref(false)
let loadingHintTimer: ReturnType<typeof setTimeout> | null = null
let loadingCheckTimer: ReturnType<typeof setInterval> | null = null

function checkLoadingHint(): void {
  // 只在"首次加载尚未完成"时（lastUpdateTime 仍为 0）才显示提示
  // isPolling 表示轮询循环在运行，不代表正在加载
  const initialLoadPending = store.isPolling && store.lastUpdateTime === 0
  if (initialLoadPending) {
    if (!loadingHintVisible.value && !loadingHintTimer) {
      loadingHintTimer = setTimeout(() => {
        loadingHintVisible.value = true
        loadingHintTimer = null
      }, 10000)
    }
  } else {
    if (loadingHintTimer) {
      clearTimeout(loadingHintTimer)
      loadingHintTimer = null
    }
    loadingHintVisible.value = false
  }
}

/** 打开 OpenClaw WebUI（携带 token + WebSocket 地址，实现自动登录）
 *
 * OpenClaw Control UI 支持 URL hash 参数：
 *   #token=<gateway_token>&gatewayUrl=<ws_url>
 * 传入两者后 UI 会弹确认框（若 URL 与已保存的不同），
 * 确认一次后就会记住设置，后续打开自动登录。
 * 注意：使用 hash fragment 而非 query param，避免 token 出现在服务器日志中。
 */
function openWebUI(): void {
  const token = getAuthToken()
  // 根据 VITE_GATEWAY_URL 推导 WebSocket 地址（http→ws，https→wss）
  const httpBase = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:18789'
  const wsBase = httpBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')

  if (token) {
    const hash = `token=${encodeURIComponent(token)}&gatewayUrl=${encodeURIComponent(wsBase)}`
    window.open(`${httpBase}/#${hash}`, '_blank')
  } else {
    window.open(httpBase, '_blank')
  }
}

// Stats cards（每张卡片带 id，便于自定义排序）
const statsCardsRaw = computed(() => [
  { id: 'total', label: '总计', value: store.totalAgents, icon: Odometer, iconClass: 'icon-blue', class: 'stat-total' },
  { id: 'running', label: '运行中', value: store.runningAgents.length, icon: VideoPlay, iconClass: 'icon-green', class: 'stat-running' },
  { id: 'idle', label: '空闲', value: store.idleAgents.length, icon: VideoPause, iconClass: 'icon-yellow', class: 'stat-idle' },
  { id: 'aborted', label: '已终止', value: store.abortedAgents.length, icon: CircleClose, iconClass: 'icon-gray', class: 'stat-aborted' },
  { id: 'error', label: '错误', value: store.errorAgents.length, icon: CircleClose, iconClass: 'icon-red', class: 'stat-error' },
  { id: 'uptime', label: '本次运行时间', value: store.formatUptime(store.uptimeMs), icon: Monitor, iconClass: 'icon-purple', class: 'stat-uptime' },
  {
    id: 'tokens',
    label: '历史消耗Token',
    value: (store.totalTokensUsed || 0).toLocaleString(),
    subtitle: topModelSummary.value,
    icon: Odometer, iconClass: 'icon-orange', class: 'stat-tokens stat-clickable',
    onClick: () => { tokenDetailVisible.value = true },
  },
  {
    id: 'cost',
    label: '本次运行费用',
    value: store.formatCost(store.totalCostCny),
    subtitle: costForecastSubtitle.value,
    icon: Money, iconClass: 'icon-green', class: 'stat-cost stat-clickable',
    onClick: () => { tokenDetailVisible.value = true },
  },
])

// 按用户自定义顺序重排
const statsCards = computed(() => {
  const order = layoutConfig.value.statsCards
  const map = new Map(statsCardsRaw.value.map(c => [c.id, c]))
  return order.map(id => map.get(id)).filter(Boolean) as typeof statsCardsRaw.value
})

// Sprint 1: 副标题显示今日 + 本月预估
const costForecastSubtitle = computed(() => {
  const s = store.costSummary
  if (!s) return store.costModeLabel
  const today = s.todayCNY < 0.01 ? '<¥0.01' : '¥' + s.todayCNY.toFixed(2)
  const forecast = s.monthForecastCNY < 0.01 ? '<¥0.01' : '¥' + s.monthForecastCNY.toFixed(0)
  return `今日 ${today} · 本月预估 ${forecast}`
})

// Token 卡片的模型摘要（最多显示 2 个主要模型）
const topModelSummary = computed(() => {
  const byModel = store.globalUsage.byModel
  if (!byModel) return ''
  const sorted = Object.entries(byModel).sort((a, b) => b[1].tokens - a[1].tokens)
  const names: Record<string, string> = {
    'deepseek-v4-pro': 'DeepSeek', 'MiniMax-M2.7': 'MiniMax',
    'claude-sonnet-4-6': 'Claude', 'claude-sonnet-4-5': 'Claude',
  }
  return sorted.slice(0, 2).map(([m]) => names[m] || m.split('-')[0]).join(' · ')
})

// Health
const healthDisplay = computed(() => {
  switch (store.healthStatus) {
    case 'healthy': return '正常'
    case 'degraded': return '降级'
    case 'unhealthy': return '异常'
    case 'unknown': return '未知'
    default: return '检查中...'
  }
})
const healthIcon = computed(() => {
  if (store.healthStatus === 'healthy') return CircleCheck
  if (store.healthStatus === 'degraded') return Warning
  return Warning
})

// Actions
const drawerAutoFocusInput = ref(false)
function onAgentDetail(agent: AgentInfo, opts?: { focusInput?: boolean }): void {
  selectedAgent.value = agent
  drawerAutoFocusInput.value = !!opts?.focusInput
  drawerVisible.value = true
}

function formatNotifTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function refreshAll(): Promise<void> {
  await Promise.all([store.fetchAgents(), store.fetchHealth()])
}

// Sprint 7: cmd+K global shortcut
function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    commandPaletteVisible.value = !commandPaletteVisible.value
  }
}

function handlePaletteAction(key: string) {
  switch (key) {
    case 'projects':     projectBoardVisible.value = true; break
    case 'cron':         cronCenterVisible.value = true; break
    case 'timeline':     activityTimelineVisible.value = true; break
    case 'fileManager':  fileManagerVisible.value = true; break
    case 'billing':      billingDialogVisible.value = true; break
    case 'skills':       skillsDialogVisible.value = true; break
    case 'token':        tokenDetailVisible.value = true; break
    default: break
  }
}

function handlePaletteNavigateAgent(agentId: string) {
  // Scroll to the agent card
  const el = document.querySelector(`[data-agent-id="${agentId}"]`)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

onMounted(() => {
  refreshAll()
  store.subscribeAgents()
  // Start real-time clock
  updateClock()
  clockTimer = setInterval(updateClock, 60 * 1000) // update every minute
  // REC-031: 工作流进度 — 每 5 秒轮询 JSON
  fetchWorkflowData()
  workflowTimer = setInterval(fetchWorkflowData, 5000)
  // REC-011: 加载超时提示 — 每 1 秒检查
  checkLoadingHint()
  loadingCheckTimer = setInterval(checkLoadingHint, 1000)
  // Sprint 7: cmd+K
  window.addEventListener('keydown', onGlobalKeydown)
})

onUnmounted(() => {
  if (clockTimer) {
    clearInterval(clockTimer)
    clockTimer = null
  }
  // REC-031: 清理工作流轮询定时器
  if (workflowTimer) {
    clearInterval(workflowTimer)
    workflowTimer = null
  }
  // REC-011: 清理加载提示定时器
  if (loadingHintTimer) {
    clearTimeout(loadingHintTimer)
    loadingHintTimer = null
  }
  if (loadingCheckTimer) {
    clearInterval(loadingCheckTimer)
    loadingCheckTimer = null
  }
  // Sprint 7: cmd+K
  window.removeEventListener('keydown', onGlobalKeydown)
})
</script>

<style scoped>
/* ==================== LAYOUT ==================== */
.dashboard {
  min-height: 100vh;
  background: var(--bg-primary);
  color: var(--text-primary);
}

/* ==================== STATUS BAR ==================== */
.status-bar {
  background: linear-gradient(135deg, #0f172a, #1e293b);
  border-bottom: 1px solid var(--border-color);
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow:0 2px 12px rgba(0, 0, 0, 0.15);
}

.status-bar-inner {
  max-width: 1440px;
  margin: 0 auto;
  padding: 10px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.brand-icon {
  color: var(--accent);
}

 .brand-title {
   color: var(--text-primary);
   font-size: 18px;
   font-weight: 700;
   margin: 0;
   background: linear-gradient(90deg, var(--accent), #42a5f5);
   -webkit-background-clip: text;
   -webkit-text-fill-color: transparent;
   background-clip: text;
   display: flex;
   align-items: baseline;
   gap: 6px;
 }

 .brand-version {
   font-size: 12px;
   font-weight: 400;
   color: var(--text-secondary);
   -webkit-text-fill-color: var(--text-secondary);
 }

 .brand-time {
   color: var(--text-secondary);
   font-size: 13px;
   font-variant-numeric: tabular-nums;
   margin-left: 12px;
   padding-left: 12px;
   border-left: 1px solid var(--border-color);
 }

.status-indicators {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

/* 顶部右侧容器（版本 + 网关 + 通知 + 自定义布局） */
.status-top-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* 顶部紧凑指示器（共用基础样式） */
.top-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border-color, rgba(255,255,255,0.08));
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  font-family: inherit;
  white-space: nowrap;
}
.top-indicator:hover {
  background: rgba(255,255,255,0.08);
  border-color: var(--accent, #38bdf8);
}
.top-ind-label {
  color: var(--text-secondary, #94a3b8);
  font-size: 11px;
}
.top-ind-value {
  color: var(--text-primary, #e2e8f0);
  font-weight: 600;
  font-size: 12px;
}
.top-ind-value.mono {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 11px;
}

/* 版本 */
.top-indicator-version {
  border-color: rgba(66,165,245,0.3);
  background: rgba(66,165,245,0.06);
}
.top-indicator-version .el-icon { color: #93c5fd; }
.top-indicator-version .top-ind-value { color: #93c5fd; }
.top-indicator-version:hover { border-color: rgba(66,165,245,0.6); box-shadow: 0 2px 8px rgba(66,165,245,0.15); }

/* 网关健康 */
.top-indicator-healthy { border-color: rgba(76,175,80,0.3); background: rgba(76,175,80,0.06); }
.top-indicator-healthy .el-icon, .top-indicator-healthy .top-ind-value { color: #4caf50; }
.top-indicator-healthy:hover { border-color: rgba(76,175,80,0.6); }
.top-indicator-unhealthy { border-color: rgba(244,67,54,0.3); background: rgba(244,67,54,0.06); }
.top-indicator-unhealthy .el-icon, .top-indicator-unhealthy .top-ind-value { color: #f44336; }
.top-indicator-degraded { border-color: rgba(255,152,0,0.3); background: rgba(255,152,0,0.06); }
.top-indicator-degraded .el-icon, .top-indicator-degraded .top-ind-value { color: #ff9800; }
.top-indicator-unknown .el-icon, .top-indicator-unknown .top-ind-value { color: #ffd54f; }

/* 通知中心 */
.top-indicator-notif { border-color: rgba(255,255,255,0.08); }
.top-indicator-notif.has-unread {
  border-color: rgba(244,67,54,0.5);
  background: rgba(244,67,54,0.08);
}
.top-indicator-notif.has-unread .el-icon {
  color: #ef4444;
  animation: notif-shake 1.5s ease-in-out infinite;
}
.top-notif-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  background: #ef4444;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  border-radius: 8px;
  line-height: 16px;
  text-align: center;
  border: 1px solid var(--bg-primary, #0f172a);
}

/* Sprint 7: 搜索 + 时间线按钮 */
.top-indicator-search { border-color: rgba(99,102,241,0.25); background: rgba(99,102,241,0.06); }
.top-indicator-search .el-icon { color: #818cf8; }
.top-indicator-search:hover { border-color: rgba(99,102,241,0.6); background: rgba(99,102,241,0.15); }
.top-ind-kbd {
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 10px;
  color: rgba(255,255,255,0.4);
  font-family: inherit;
}
.top-indicator-timeline { border-color: rgba(34,197,94,0.2); background: rgba(34,197,94,0.04); }
.top-indicator-timeline .el-icon { color: #4ade80; }
.top-indicator-timeline:hover { border-color: rgba(34,197,94,0.5); background: rgba(34,197,94,0.12); }

/* #18 主题切换按钮（Dark/Light Theme Toggle Button）*/
.top-indicator-theme { border-color: rgba(251,191,36,0.2); background: rgba(251,191,36,0.04); }
.top-indicator-theme .theme-icon { font-size: 13px; line-height: 1; }
.top-indicator-theme:hover { border-color: rgba(251,191,36,0.5); background: rgba(251,191,36,0.12); }

/* 自定义布局按钮 */
.top-layout-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(139,92,246,0.08);
  border: 1px solid rgba(139,92,246,0.25);
  color: #c4b5fd;
  border-radius: 8px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
}
.top-layout-btn:hover {
  background: rgba(139,92,246,0.18);
  border-color: rgba(139,92,246,0.5);
  color: #fff;
}

/* ==================== 功能区（action-bar）==================== */
/* ─── 内联活动时间线区域（Inline Activity Timeline Section）─────────────────── */
.inline-timeline-section {
  background: var(--bg-secondary, #1e293b);
  border-top: 1px solid var(--border-color, #334155);
  border-bottom: 1px solid var(--border-color, #334155);
  margin-bottom: 4px;
}

/* 折叠栏头 */
.itl-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 24px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.itl-bar:hover {
  background: rgba(255, 255, 255, 0.03);
}

.itl-bar-icon { font-size: 14px; }

.itl-bar-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #f1f5f9);
}

.itl-bar-hint {
  font-size: 11px;
  color: var(--text-muted, #64748b);
}

.itl-bar-arrow {
  margin-left: auto;
  font-size: 10px;
  color: var(--text-muted, #64748b);
  transition: transform 0.2s;
}

.inline-timeline-section.collapsed .itl-bar-arrow {
  /* 已通过内容"▶"/"▼"表示状态 */
}

/* 折叠内容区 */
.itl-content {
  overflow: hidden;
}

/* ── 内联版本迭代说明（Inline Changelog Section）── */
.inline-changelog-section {
  background: var(--bg-secondary, #1e293b);
  border-top: 1px solid var(--border-color, #334155);
  border-bottom: 1px solid var(--border-color, #334155);
  margin-bottom: 4px;
}

.icl-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 24px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.icl-bar:hover {
  background: rgba(255, 255, 255, 0.03);
}

.icl-bar-icon { font-size: 14px; }

.icl-bar-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #f1f5f9);
}

.icl-bar-hint {
  font-size: 11px;
  color: var(--text-muted, #64748b);
}

.icl-bar-badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(139,92,246,0.15);
  color: #8b5cf6;
  border: 1px solid rgba(139,92,246,0.25);
  font-weight: 600;
}

.icl-bar-arrow {
  margin-left: auto;
  font-size: 10px;
  color: var(--text-muted, #64748b);
  transition: transform 0.2s;
}

.icl-content {
  overflow: hidden;
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 24px 12px;
}

.action-bar-section {
  max-width: 1440px;
  margin: 0 auto;
  padding: 4px 24px 16px;
}
.action-bar-inner {
  display: grid;
  /* 自动按可用宽度均分，最小 168px，多余空间平摊 */
  grid-template-columns: repeat(auto-fit, minmax(168px, 1fr));
  gap: 12px;
}
.action-slot {
  display: flex;
  width: 100%;
}
.action-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  background: var(--bg-card, #1e293b);
  border: 1px solid var(--border-color, #2d3748);
  border-radius: 10px;
  color: var(--text-primary, #e2e8f0);
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  width: 100%;
  min-width: 0;  /* 允许收缩到 grid 单元宽度 */
  text-align: left;
  font-family: inherit;
}
.action-btn:hover {
  background: var(--bg-card-hover, #273549);
  border-color: var(--accent, #38bdf8);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(56,189,248,0.15);
}
.action-btn .el-icon {
  flex-shrink: 0;
  color: var(--accent, #38bdf8);
}
.action-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.action-label {
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
  font-weight: 500;
  letter-spacing: 0.3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.action-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #e2e8f0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.action-value.mono {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 13px;
}
.action-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  background: #ef4444;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  border-radius: 9px;
  line-height: 18px;
  text-align: center;
  border: 2px solid var(--bg-primary, #0f172a);
}

/* 健康状态变体 */
.action-btn.action-healthy .el-icon { color: #4caf50; }
.action-btn.action-healthy { border-color: rgba(76,175,80,0.25); background: rgba(76,175,80,0.04); }
.action-btn.action-healthy:hover { border-color: rgba(76,175,80,0.6); box-shadow: 0 4px 12px rgba(76,175,80,0.15); }

.action-btn.action-unhealthy .el-icon { color: #f44336; }
.action-btn.action-unhealthy { border-color: rgba(244,67,54,0.3); background: rgba(244,67,54,0.06); }

.action-btn.action-degraded .el-icon { color: #ff9800; }
.action-btn.action-degraded { border-color: rgba(255,152,0,0.25); }

.action-btn.action-unknown .el-icon { color: #ffd54f; }

.action-btn.action-version .el-icon,
.action-btn.action-version .action-value { color: #93c5fd; }
.action-btn.action-version { border-color: rgba(66,165,245,0.25); background: rgba(66,165,245,0.04); }

.action-btn.action-gpu .el-icon { color: #ce93d8; }
.action-btn.action-gpu .action-value { color: #e1bee7; font-family: 'Cascadia Code', monospace; }
.action-btn.action-gpu { border-color: rgba(156,39,176,0.25); background: rgba(156,39,176,0.04); }

.action-btn.action-notif.has-unread {
  border-color: rgba(244,67,54,0.5);
  background: rgba(244,67,54,0.08);
}
.action-btn.action-notif.has-unread .el-icon {
  color: #ef4444;
  animation: notif-shake 1.5s ease-in-out infinite;
}

.action-btn.action-projects .el-icon { color: #34d399; }
.action-btn.action-projects { border-color: rgba(52,211,153,0.25); background: rgba(52,211,153,0.04); }
.action-btn.action-projects:hover { border-color: rgba(52,211,153,0.6); box-shadow: 0 4px 12px rgba(52,211,153,0.15); }

.action-btn.action-cron .el-icon { color: #a78bfa; }
.action-btn.action-cron { border-color: rgba(167,139,250,0.25); background: rgba(167,139,250,0.04); }
.action-btn.action-cron:hover { border-color: rgba(167,139,250,0.6); box-shadow: 0 4px 12px rgba(167,139,250,0.15); }


.indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 16px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  transition: all 0.3s;
  cursor: pointer;
}

.indicator:hover {
  border-color: var(--accent);
  box-shadow: 0 0 8px var(--accent-glow);
}

.indicator-label {
  color: var(--text-secondary);
}

.indicator-value {
  color: var(--text-primary);
  font-weight: 600;
}

.health-healthy { background: rgba(76, 175, 80, 0.15); color: #81c784; border-color: rgba(76,175,80,0.3) !important; }
.health-degraded { background: rgba(255, 152, 0, 0.15); color: #ffb74d; border-color: rgba(255,152,0,0.3) !important; }
.health-unhealthy { background: rgba(244, 67, 54, 0.15); color: #e57373; border-color: rgba(244,67,54,0.3) !important; }
.health-unknown { background: rgba(255, 193, 7, 0.15); color: #ffd54f; border-color: rgba(255,193,7,0.3) !important; }

.indicator-version {
  background: rgba(66, 165, 245, 0.15);
  border-color: rgba(66,165,245,0.3) !important;
}

.indicator-version .indicator-label {
  color: #64b5f6;
  font-weight: 600;
}

.indicator-version .indicator-value {
  color: #90caf9;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
}

.indicator-gpu {
  background: rgba(156, 39, 176, 0.15);
  border-color: rgba(156,39,176,0.3) !important;
}

.indicator-gpu .indicator-label {
  color: #ce93d8;
  font-weight: 600;
}

.indicator-gpu .indicator-value {
  color: #e1bee7;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
}

.indicator-action {
  cursor: pointer;
  user-select: none;
}
.indicator-action:hover {
  border-color: var(--accent);
  background: rgba(66, 165, 245, 0.12);
  box-shadow: 0 0 8px var(--accent-glow);
}
.indicator-action .indicator-label {
  color: var(--text-primary);
  font-weight: 500;
}

/* 自定义布局：每个 indicator 外层包装，作为 flex 直接子元素以接收 order */
.indicator-slot {
  display: inline-flex;
  align-items: center;
}

/* 自定义布局按钮 */
.indicator-layout {
  padding: 5px 8px !important;
  background: rgba(255,255,255,0.03);
  opacity: 0.6;
}
.indicator-layout:hover {
  opacity: 1;
  background: rgba(139, 92, 246, 0.15);
  border-color: rgba(139,92,246,0.4) !important;
}

/* 通知铃铛 */
.notif-bell {
  position: relative;
}
.notif-bell.has-unread {
  border-color: rgba(244,67,54,0.4) !important;
  background: rgba(244,67,54,0.08);
}
.notif-bell.has-unread .el-icon {
  color: #ef4444;
  animation: notif-shake 1.5s ease-in-out infinite;
}
@keyframes notif-shake {
  0%, 100% { transform: rotate(0deg); }
  10%, 30% { transform: rotate(-15deg); }
  20%, 40% { transform: rotate(15deg); }
  50% { transform: rotate(0deg); }
}
.notif-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  background: #ef4444;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  border-radius: 8px;
  line-height: 16px;
  text-align: center;
  border: 1px solid rgba(0,0,0,0.3);
}

.loading-hint-alert {
  position: fixed;
  top: 70px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2000;
  min-width: 280px;
  animation: loadingHintFadeIn 0.3s ease;
}

@keyframes loadingHintFadeIn {
  from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

/* ==================== STATS SECTION ==================== */
.stats-section {
  background: var(--bg-primary);
}

.stats-inner {
  max-width: 1440px;
  margin: 0 auto;
  padding: 16px 24px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}

.stat-card {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  transition: all 0.3s;
}

.stat-card:hover {
  border-color: var(--accent);
  box-shadow: 0 4px 16px var(--accent-glow);
  transform: translateY(-2px);
}

.stat-clickable {
  cursor: pointer;
}

.stat-clickable:hover {
  border-color: #f59e0b !important;
  box-shadow: 0 4px 16px rgba(245,158,11,0.2) !important;
}

.stat-subtitle {
  display: block;
  font-size: 10px;
  color: var(--text-secondary);
  margin-top: 1px;
  opacity: 0.8;
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

 .icon-blue { background: rgba(66, 165, 245, 0.15); color: #42a5f5; }
 .icon-green { background: rgba(76, 175, 80, 0.15); color: #4caf50; }
 .icon-yellow { background: rgba(255, 193, 7, 0.15); color: #ffc107; }
 .icon-red { background: rgba(244, 67, 54, 0.15); color: #f44336; }
 .icon-gray { background: rgba(107, 114, 128, 0.15); color: #6b7280; }
 .icon-purple { background: rgba(139, 92, 246, 0.15); color: #8b5cf6; }
 .icon-orange { background: rgba(249, 115, 22, 0.15); color: #f97316; }

.stat-total { border-left: 3px solid #42a5f5; }
.stat-running { border-left: 3px solid #4caf50; }
.stat-idle { border-left: 3px solid #ffc107; }
.stat-error { border-left: 3px solid #f44336; }

/* ==================== WORKFLOW STEPS / DIVIDER ==================== */
.workflow-section {
  max-width: 1440px;
  margin: 0 auto;
  padding: 8px 24px;
}

/* REC-029: workflow-steps-wrapper 已移除，padding 合并到 workflow-section */

.workflow-card {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  transition: all 0.3s;
}

.workflow-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  padding: 0 4px;
}

.workflow-project-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.workflow-step-label {
  font-size: 11px;
  color: var(--text-secondary);
  padding: 2px 8px;
  background: var(--bg-card-hover);
  border-radius: 4px;
}

.workflow-card:hover {
  border-color: var(--accent);
  box-shadow: 0 4px 16px var(--accent-glow);
}

.workflow-card :deep(.el-card__body) {
  padding: 8px 16px;
}

/* 自定义步进条布局 (模仿 Element Plus Simple) */
.workflow-steps-simple {
  display: flex;
  align-items: center;
  justify-content: space-evenly;
  gap: 0;
  width: 100%;
  overflow: auto;
  padding: 8px 0;
}

.workflow-step-simple-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  min-width: 80px;
}

.workflow-step-simple-item.is-active .simple-step-title {
  color: var(--el-color-primary);
  font-weight: 600;
}

/* 圆点指示器 (Element Plus Simple 风格) */
.simple-step-circle {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
  transition: all 0.3s;
}

.simple-step-finished {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.simple-step-process {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  box-shadow: 0 0 8px var(--accent-glow);
}

.workflow-step-simple-item.is-active .simple-step-process {
  background: transparent;
  border-color: var(--el-color-success);
  color: #fff;
  box-shadow: 0 0 8px var(--accent-glow);
}

.simple-step-waiting {
  background: transparent;
  border-color: var(--text-secondary);
  color: var(--text-secondary);
}

/* 步骤标题 */
.simple-step-title {
  font-size: 13px;
  color: var(--text-secondary);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  transition: color 0.3s;
}

.simple-step-finished + .simple-step-title {
  color: var(--accent);
}

.workflow-step-simple-item.is-active .simple-step-title{
  color: var(--el-color-success);
}

/* ==================== 箭头分隔符 ==================== */
.step-arrow-group {
  display: flex;
  align-items: center;
  gap: 2px;
  margin: 0 8px;
  flex-shrink: 0;
}

.step-arrow-chevron {
  width: 12px;
  height: 12px;
  transition: color 0.3s, opacity 0.3s;
}

/* 已完成节点后的箭头 → 高亮，无动画 */
.step-arrow-group.arrow-finished .step-arrow-chevron {
  color: var(--accent);
  opacity: 1;
}

/* 正在执行节点后的箭头 → 波浪流水动画 */
.step-arrow-group.arrow-process .step-arrow-chevron {
  color: var(--accent);
  opacity: 0.5;
  animation: arrowWaveFlow 1s ease-in-out infinite;
}

/* 未完成节点后的箭头 → 灰色，无动画 */
.step-arrow-group.arrow-waiting .step-arrow-chevron {
  color: var(--text-secondary);
  opacity: 0.3;
}

@keyframes arrowWaveFlow {
  0%, 100% {
    opacity: 0.3;
    transform: translateX(0);
  }
  50% {
    opacity: 1;
    transform: translateX(4px);
  }
}

.workflow-divider-line {
  height: 1px;
  background: var(--border-color);
  border-radius: 1px;
}

/* REC-033: header 右侧布局 */
.workflow-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.workflow-task-summary-inline {
  font-size: 12px;
  color: var(--text-primary);
  opacity: 0.8;
  font-weight: 500;
}

.workflow-mode-tag {
  font-size: 11px;
}

/* REC-028: 空状态提示 */
.workflow-empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 0 0 18px 0;
  color: #9ca3af;
  font-size: 14px;
}

.workflow-empty-icon {
  color: #9ca3af;
  opacity: 0.6;
}

/* ==================== BOARD LAYOUT ==================== */
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

/* ==================== VIEW TRANSITION ==================== */
.view-fade-enter-active,
.view-fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.view-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.view-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* ==================== RESPONSIVE ==================== */
@media (max-width: 1024px) {
  .stats-inner {
    grid-template-columns: repeat(2, 1fr);
  }

  .board-container {
    flex-direction: column;
  }

  .board-column {
    max-width: 100%;
  }
}

@media (max-width: 768px) {
  .status-bar-inner {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .status-indicators {
    width: 100%;
    flex-wrap: wrap;
    gap: 6px;
  }

  .stats-inner {
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    padding: 12px 16px;
  }

  .stat-number {
    font-size: 22px;
  }

  .stat-icon-wrap {
    width: 38px;
    height: 38px;
  }

  .board-container {
    padding: 14px;
  }
}

@media (max-width: 480px) {
  .brand-title {
    font-size: 16px;
  }

  .stats-inner {
    padding: 10px 12px;
  }
}
</style>

<!-- 非 scoped：通知 popper 渲染到 body，需要全局选择器 -->
<style>
.notif-popper {
  background: #1e293b !important;
  border: 1px solid rgba(255,255,255,0.1) !important;
  padding: 0 !important;
  max-height: 480px;
  overflow: hidden;
}
.notif-panel { display: flex; flex-direction: column; max-height: 480px; }
.notif-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  font-weight: 700;
  font-size: 13px;
  color: rgba(255,255,255,0.9);
}
.notif-actions { display: flex; gap: 4px; }
.notif-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 30px 0;
  color: rgba(255,255,255,0.4);
  font-size: 12px;
}
.notif-empty .el-icon { font-size: 24px; }
.notif-list {
  flex: 1;
  overflow-y: auto;
  max-height: 380px;
}
.notif-item {
  display: flex;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  transition: background 0.15s;
}
.notif-item:hover { background: rgba(255,255,255,0.03); }
.notif-item.unread { background: rgba(66,165,245,0.06); }
.notif-error.unread { background: rgba(244,67,54,0.08); }
.notif-icon { font-size: 16px; flex-shrink: 0; }
.notif-body { flex: 1; min-width: 0; }
.notif-agent { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.9); }
.notif-msg { font-size: 12px; color: rgba(255,255,255,0.7); margin-top: 2px; line-height: 1.4; word-break: break-word; }
.notif-time { font-size: 10px; color: rgba(255,255,255,0.4); margin-top: 4px; }
</style>

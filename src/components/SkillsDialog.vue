<template>
  <el-dialog
    v-model="dialogVisible"
    title="OpenClaw 技能库"
    width="860px"
    :close-on-click-modal="false"
    destroy-on-close
    class="skills-dialog"
    :modal-class="'skills-dialog-modal'"
    top="4vh"
  >
    <!-- 顶部统计栏 -->
    <div v-if="skillsData" class="skills-stats-bar">
      <div class="stats-item">
        <span class="stats-label">全部技能</span>
        <span class="stats-value">{{ skillsData.total }}</span>
      </div>
      <div class="stats-divider" />
      <div class="stats-item">
        <span class="stats-label">已就绪</span>
        <span class="stats-value stats-ready">{{ skillsData.ready }}</span>
      </div>
      <el-button
        v-if="skillsData.skills.length > 0"
        class="refresh-skills-btn"
        :icon="Refresh"
        circle
        size="small"
        @click="fetchSkills"
        :loading="loading"
      />
    </div>

    <!-- 加载状态 -->
    <div v-if="loading && !skillsData" class="skills-loading">
      <el-icon :size="24" class="is-loading"><Loading /></el-icon>
      <span>加载技能列表...</span>
    </div>

    <!-- Tab 标签页 -->
    <el-tabs v-else-if="skillsData?.skills.length" v-model="activeTab" class="skills-tabs">
      <el-tab-pane name="activated">
        <template #label>
          <span>已激活</span>
          <el-tag size="small" type="success" class="tab-count">{{ activatedSkills.length }}</el-tag>
        </template>
      </el-tab-pane>
      <el-tab-pane name="deactivated">
        <template #label>
          <span>未激活</span>
          <el-tag size="small" type="info" class="tab-count">{{ deactivatedSkills.length }}</el-tag>
        </template>
      </el-tab-pane>
      <el-tab-pane name="notInstalled">
        <template #label>
          <span>未安装</span>
          <el-tag size="small" type="info" class="tab-count">{{ notInstalledSkills.length }}</el-tag>
        </template>
      </el-tab-pane>
      <el-tab-pane name="byAgent">
        <template #label>
          <span>按 Agent</span>
        </template>
      </el-tab-pane>
      <el-tab-pane name="compare">
        <template #label>
          <span>对比</span>
        </template>
      </el-tab-pane>
      <el-tab-pane name="clawhub">
        <template #label>
          <span>ClawHub</span>
        </template>
      </el-tab-pane>
    </el-tabs>

    <!-- ══ 按 Agent tab ══ -->
    <div v-if="activeTab === 'byAgent' && skillsData" class="by-agent-section">
      <!-- Agent 选择器 -->
      <div class="agent-chips">
        <div
          v-for="agent in agentsConfigured"
          :key="agent.id"
          :class="['agent-chip', selectedAgentId === agent.id ? 'agent-chip--active' : '']"
          @click="selectedAgentId = agent.id"
        >
          <span class="agent-chip-emoji">{{ agent.emoji || agent.id[0].toUpperCase() }}</span>
          <span class="agent-chip-name">{{ shortAgentName(agent.name || agent.id) }}</span>
          <span class="agent-chip-count">{{ agent.skills.length }}</span>
        </div>
      </div>

      <!-- 已选 Agent 的技能（按分类） -->
      <el-scrollbar class="skills-scrollbar" v-if="selectedAgentId">
        <div v-if="selectedAgentSkills.length === 0" class="agent-no-skills">
          <el-empty description="该 Agent 暂未配置技能" :image-size="60" />
        </div>
        <template v-else v-for="(group, catName) in selectedAgentSkillsByCategory" :key="catName">
          <div class="category-header">
            <span class="category-icon">{{ getCategoryIcon(catName) }}</span>
            <span class="category-name">{{ catName }}</span>
            <span class="category-count">{{ group.length }}</span>
          </div>
          <div class="skills-list-compact">
            <div
              v-for="skill in group"
              :key="skill.name"
              :class="[
                'skill-row',
                skill.enabled ? 'skill-row--enabled'
                  : skill.installed ? 'skill-row--inactive'
                  : 'skill-row--uninstalled',
                expandedSkillName === skill.name ? 'skill-row--expanded' : ''
              ]"
              @click.stop="toggleSkillExpand(skill.name)"
            >
              <div class="skill-row-status">
                <span
                  :class="[
                    'status-dot',
                    skill.enabled ? 'status-dot--on'
                      : skill.installed ? 'status-dot--inactive'
                      : 'status-dot--off'
                  ]"
                  :title="skill.enabled ? '已激活' : skill.installed ? '已安装，未激活' : '未安装'"
                />
              </div>
              <div class="skill-row-info">
                <div class="skill-row-name">
                  {{ getSkillDisplayName(skill.name) }}
                  <span class="skill-row-id">{{ skill.name }}</span>
                </div>
                <div class="skill-row-desc">{{ getSkillDescription(skill.name) }}</div>
                <!-- 展开详情：工具列表 -->
                <div v-if="expandedSkillName === skill.name" class="skill-row-expand" @click.stop>
                  <div v-if="expandedSkillLoading" class="skill-row-expand-loading">加载中...</div>
                  <div v-else-if="expandedSkillTools.length > 0" class="skill-row-tools">
                    <span class="skill-tools-label">工具清单 ({{ expandedSkillTools.length }})</span>
                    <div class="skill-tools-list">
                      <span v-for="t in expandedSkillTools" :key="t" class="skill-tool-tag">{{ t }}</span>
                    </div>
                  </div>
                  <div v-else class="skill-row-expand-loading">暂无工具信息</div>
                </div>
              </div>
              <!-- 操作按钮（仅限已安装） -->
              <el-button
                v-if="skill.installed && skill.enabled"
                size="small"
                type="danger"
                plain
                :loading="togglingSkills.get(skill.name)"
                :disabled="togglingSkills.get(skill.name)"
                @click="handleToggle(skill.name, false)"
                class="skill-row-btn"
              >禁用</el-button>
              <el-button
                v-else-if="skill.installed && !skill.enabled"
                size="small"
                type="success"
                plain
                :loading="togglingSkills.get(skill.name)"
                :disabled="togglingSkills.get(skill.name)"
                @click="handleToggle(skill.name, true)"
                class="skill-row-btn"
              >启用</el-button>
              <span v-else class="skill-uninstalled-label">未安装</span>
            </div>
          </div>
        </template>
      </el-scrollbar>
    </div>

    <!-- ══ 对比 tab ══ -->
    <div v-else-if="activeTab === 'compare' && skillsData" class="compare-section">
      <div v-if="agentsConfigured.length === 0" class="compare-empty">
        <el-empty description="暂无可对比的 Agent" :image-size="60" />
      </div>
      <el-scrollbar v-else class="compare-scrollbar">
        <!-- 列标题行 -->
        <div class="compare-header">
          <div class="compare-skill-col">技能</div>
          <div
            v-for="ag in agentsConfigured"
            :key="ag.id"
            class="compare-agent-col"
            :title="ag.name"
          >{{ shortAgentName(ag.name || ag.id) }}</div>
        </div>
        <!-- 分组行 -->
        <template v-for="(skills, catName) in compareSkillsByCategory" :key="catName">
          <div class="compare-cat-row">
            <span class="compare-cat-icon">{{ getCategoryIcon(catName) }}</span>
            {{ catName }}
          </div>
          <div
            v-for="skillName in skills"
            :key="skillName"
            class="compare-row"
          >
            <div class="compare-skill-col">
              <span class="compare-skill-name">{{ getSkillDisplayName(skillName) }}</span>
              <span class="compare-skill-id">{{ skillName }}</span>
            </div>
            <div
              v-for="ag in agentsConfigured"
              :key="ag.id"
              class="compare-agent-col"
            >
              <span
                :class="['compare-dot', `compare-dot--${compareStatus(skillName, ag.id)}`]"
                :title="compareDotTitle(skillName, ag.id)"
              />
            </div>
          </div>
        </template>
        <!-- 图例 -->
        <div class="compare-legend">
          <span class="compare-legend-item"><span class="compare-dot compare-dot--enabled" /> 已激活</span>
          <span class="compare-legend-item"><span class="compare-dot compare-dot--inactive" /> 已安装未激活</span>
          <span class="compare-legend-item"><span class="compare-dot compare-dot--absent" /> 未配置</span>
        </div>
      </el-scrollbar>
    </div>

    <!-- ══ ClawHub 搜索模式 ══ -->
    <div v-else-if="activeTab === 'clawhub'" class="clawhub-search-section">
      <el-input
        v-model="searchQuery"
        placeholder="搜索技能..."
        @keyup.enter="handleSearch"
        prefix-icon="Search"
        class="clawhub-search-input"
      >
        <template #append>
          <el-button @click="handleSearch">搜索</el-button>
        </template>
      </el-input>

      <el-scrollbar v-if="hasSearched" class="clawhub-scrollbar" view-class="clawhub-results-scroll">
        <div class="clawhub-results">
          <div v-if="searching" class="clawhub-loading">
            <el-icon :size="20" class="is-loading"><Loading /></el-icon>
            <span>搜索中...</span>
          </div>
          <div v-else-if="searchResults.length === 0" class="clawhub-empty">
            <el-empty description="未找到相关技能" :image-size="60" />
          </div>
          <div v-else class="skills-grid">
            <el-card
              v-for="skill in searchResults"
              :key="'search-' + skill.name"
              class="skill-card"
              shadow="hover"
            >
              <div class="skill-status-badges">
                <el-button
                  v-if="!skill.installed"
                  size="small"
                  type="primary"
                  plain
                  @click="handleInstall(skill.name)"
                  :loading="installingSkills.get(skill.name)"
                  :disabled="installingSkills.get(skill.name)"
                  class="install-skill-btn"
                >
                  <template #icon><el-icon><Download /></el-icon></template>
                  安装
                </el-button>
                <span v-else class="status-badge badge-enabled">🟢 已安装</span>
              </div>
              <div class="skill-card-inner">
                <div class="skill-icon-wrap">
                  <el-icon :size="28" class="skill-icon skill-icon-default"><Collection /></el-icon>
                </div>
                <div class="skill-info">
                  <div class="skill-name-row">
                    <span class="skill-name">{{ skill.name }}</span>
                  </div>
                  <div class="skill-description" v-if="skill.description">{{ skill.description }}</div>
                  <div class="skill-stats" v-if="skill.updatedAt || skill.stars !== undefined || skill.downloads !== undefined">
                    <span v-if="skill.updatedAt" class="stat-item">📅 {{ formatDate(skill.updatedAt) }}</span>
                    <span v-if="skill.stars !== undefined" class="stat-item">⭐ {{ skill.stars }}</span>
                    <span v-if="skill.downloads !== undefined" class="stat-item">📦 {{ skill.downloads }}</span>
                  </div>
                </div>
              </div>
            </el-card>
          </div>
        </div>
      </el-scrollbar>

      <div v-else class="clawhub-hint">
        <el-icon :size="40" class="clawhub-hint-icon"><Search /></el-icon>
        <p class="clawhub-hint-text">在上方输入关键词搜索 ClawHub 技能</p>
      </div>
    </div>

    <!-- ══ 技能卡片列表（已激活 / 未激活 / 未安装 tab）带分类 ══ -->
    <el-scrollbar
      v-else-if="skillsData?.skills.length && activeTab !== 'clawhub' && activeTab !== 'byAgent'"
      class="skills-scrollbar"
    >
      <template v-for="(catSkills, catName) in filteredSkillsByCategory" :key="catName">
        <div class="category-header">
          <span class="category-icon">{{ getCategoryIcon(catName) }}</span>
          <span class="category-name">{{ catName }}</span>
          <span class="category-count">{{ catSkills.length }}</span>
        </div>
        <div class="skills-grid">
          <el-card
            v-for="skill in catSkills"
            :key="skill.name"
            class="skill-card"
            shadow="hover"
          >
            <div class="skill-status-badges">
              <div class="install-btn-group">
                <el-button
                  v-if="!skill.installed"
                  size="small"
                  type="primary"
                  plain
                  @click="handleInstall(skill)"
                  :loading="installingSkills.get(skill.name)"
                  :disabled="installingSkills.get(skill.name)"
                  class="install-skill-btn"
                >
                  <template #icon><el-icon><Download /></el-icon></template>
                  安装
                </el-button>
              </div>
              <template v-if="skill.installed">
                <el-button
                  v-if="skill.enabled"
                  size="small"
                  type="danger"
                  @click="handleToggle(skill.name, false)"
                  :loading="togglingSkills.get(skill.name)"
                  :disabled="togglingSkills.get(skill.name)"
                  class="toggle-skill-btn"
                >
                  禁用
                </el-button>
                <el-button
                  v-else
                  size="small"
                  type="success"
                  @click="handleToggle(skill.name, true)"
                  :loading="togglingSkills.get(skill.name)"
                  :disabled="togglingSkills.get(skill.name)"
                  class="toggle-skill-btn"
                >
                  启用
                </el-button>
              </template>
            </div>

            <div class="skill-card-inner">
              <div class="skill-icon-wrap">
                <el-icon :size="28" class="skill-icon skill-icon-default"><Collection /></el-icon>
              </div>
              <div class="skill-info">
                <div class="skill-name-row">
                  <span class="skill-name">{{ getSkillDisplayName(skill.name) }}</span>
                  <el-tag
                    v-if="skill.status"
                    :type="getStatusType(skill.status)"
                    size="small"
                    class="skill-status-tag"
                  >
                    {{ skill.status }}
                  </el-tag>
                </div>
                <div class="skill-id-row">{{ skill.name }}</div>
                <div class="skill-description">{{ getSkillDescription(skill.name) }}</div>
              </div>
            </div>
          </el-card>
        </div>
      </template>
    </el-scrollbar>

    <!-- 空状态 -->
    <el-empty v-else-if="!loading && skillsData?.skills.length === 0" description="暂无技能" :image-size="80" />
    <el-empty v-else-if="!loading && !skillsData" description="加载失败，请重试" :image-size="80">
      <el-button type="primary" @click="fetchSkills">重新加载</el-button>
    </el-empty>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { getSkills, installSkill, searchClawHubSkills, toggleSkill, type SkillsResponse, type SkillInfo } from '../api/system'
import { ElMessage } from 'element-plus'
import {
  Loading,
  Collection,
  Download,
  Refresh,
  Search,
} from '@element-plus/icons-vue'

const props = withDefaults(defineProps<{
  visible: boolean
}>(), {
  visible: false
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const dialogVisible = computed({
  get: () => props.visible,
  set: (val: boolean) => emit('update:visible', val),
})

// ── 状态 ──────────────────────────────────────────────────
const loading = ref(false)
const skillsData = ref<SkillsResponse | null>(null)
const installingSkills = ref<Map<string, boolean>>(new Map())
const togglingSkills = ref<Map<string, boolean>>(new Map())
const activeTab = ref('activated')
const searchQuery = ref('')
const searchResults = ref<SkillInfo[]>([])
const searching = ref(false)
const hasSearched = ref(false)

// ── 技能详情展开 ──────────────────────────────────────────
const expandedSkillName = ref('')
const expandedSkillTools = ref<string[]>([])
const expandedSkillLoading = ref(false)

async function toggleSkillExpand(skillName: string): Promise<void> {
  if (expandedSkillName.value === skillName) {
    expandedSkillName.value = ''
    return
  }
  expandedSkillName.value = skillName
  if (expandedSkillTools.value.length > 0) return // 已经加载过了
  expandedSkillLoading.value = true
  try {
    const resp = await fetch(`/api/system/skill-readme?name=${encodeURIComponent(skillName)}`)
    if (resp.ok) {
      const data = await resp.json()
      expandedSkillTools.value = data.tools || []
    }
  } catch (_) { /* ignore */ }
  finally { expandedSkillLoading.value = false }
}

// 切换 skill 时重置 tools 缓存
watch(expandedSkillName, () => {
  expandedSkillTools.value = []
})

// ── 按 Agent tab 状态 ────────────────────────────────────
interface AgentConfigured {
  id: string
  name: string
  emoji: string
  skills: string[]
  model: string
  skillsUnconstrained?: boolean
}
const agentsConfigured = ref<AgentConfigured[]>([])
const selectedAgentId = ref<string>('')

// ── 技能中文显示名 ────────────────────────────────────────
const SKILL_DISPLAY_NAMES: Record<string, string> = {
  'lark-im': '飞书即时通讯',
  'lark-task': '飞书任务',
  'lark-calendar': '飞书日历',
  'lark-doc': '飞书文档',
  'lark-wiki': '飞书知识库',
  'lark-base': '飞书多维表格',
  'lark-sheets': '飞书电子表格',
  'lark-drive': '飞书云盘',
  'lark-contact': '飞书通讯录',
  'lark-mail': '飞书邮件',
  'lark-approval': '飞书审批',
  'lark-attendance': '飞书考勤',
  'lark-event': '飞书活动',
  'lark-minutes': '飞书会议纪要',
  'lark-okr': '飞书 OKR',
  'lark-slides': '飞书幻灯片',
  'lark-vc': '飞书视频会议',
  'lark-vc-agent': '飞书视会助手',
  'lark-whiteboard': '飞书白板',
  'lark-shared': '飞书共享资源',
  'lark-apps': '飞书妙搭部署',
  'lark-markdown': '飞书 Markdown',
  'lark-workflow-meeting-summary': '会议总结工作流',
  'lark-workflow-standup-report': '站会报告工作流',
  'lark-openapi-explorer': '飞书开放平台浏览器',
  'lark-skill-maker': '技能制作器',
  'feishu-toolkit': '飞书工具包',
  'feishu-doc': '飞书文档（增强）',
  'feishu-wiki': '飞书知识库（增强）',
  'feishu-drive': '飞书云盘（增强）',
  'feishu-perm': '飞书权限管理',
  'jw-feishu-suite': '嘉维飞书套件',
  'Feishu All-in-One': '飞书全能套件',
  'diagram-maker': '流程图绘制',
  'browser-automation': '浏览器自动化',
  'python-debugpy': 'Python 调试',
  'node-inspect-debugger': 'Node.js 调试',
  'spike': '技术调研工具',
  'weather': '天气查询',
  'canvas': '画布工具',
  '1password': '密码管理器',
  'apple-notes': 'Apple 备忘录',
  'apple-reminders': 'Apple 提醒事项',
  'lark-approval-extra': '飞书审批（扩展）',
  'Feishu Task Daily Summary': '飞书任务每日汇总',
  'healthcheck': '主机安全巡检',
}

// ── 技能中文描述 ──────────────────────────────────────────
const SKILL_DESCRIPTIONS: Record<string, string> = {
  'lark-im': '发送消息、创建群组、管理对话和频道',
  'lark-task': '创建、分配、追踪任务，管理项目进度',
  'lark-calendar': '查看和管理日程，创建会议邀请',
  'lark-doc': '读写飞书文档，创建和编辑富文本内容',
  'lark-wiki': '管理知识库页面，查询和发布知识文章',
  'lark-base': '操作多维表格数据库，读写结构化数据',
  'lark-sheets': '读写电子表格，执行数据计算与分析',
  'lark-drive': '文件管理与上传下载，搜索云盘内容',
  'lark-contact': '查询用户信息和部门结构，获取员工通讯录',
  'lark-mail': '发送和管理邮件，设置邮件签名',
  'lark-approval': '发起和处理审批流程，查看审批进度',
  'lark-attendance': '查询和管理考勤数据，处理打卡记录',
  'lark-event': '管理活动和报名，创建线上线下活动',
  'lark-minutes': '生成和管理会议纪要，整理会议决议',
  'lark-okr': '管理目标与关键结果，追踪 OKR 进展',
  'lark-slides': '创建和编辑演示文稿，生成 PPT',
  'lark-vc': '发起和管理视频会议，查询会议室',
  'lark-vc-agent': '视频会议 AI 助理，会中实时辅助',
  'lark-whiteboard': '协作绘制白板，创建思维导图',
  'lark-shared': '管理共享文件和协作内容',
  'lark-apps': '将本地 HTML 文件或目录部署到飞书妙搭，生成公网可访问链接；管理应用共享范围',
  'lark-markdown': '以 Markdown 格式创建飞书文档',
  'lark-workflow-meeting-summary': '自动提取会议录音，生成结构化会议摘要',
  'lark-workflow-standup-report': '汇总任务进展，自动生成站会报告',
  'lark-openapi-explorer': '探索和测试飞书开放平台 API',
  'lark-skill-maker': '创建和发布自定义技能',
  'feishu-toolkit': '通用飞书操作工具集，包含常用飞书 API 封装',
  'feishu-doc': '高级文档操作，支持更多格式和功能',
  'feishu-wiki': '高级知识库操作，支持树状结构管理',
  'feishu-drive': '高级文件操作，支持批量处理和权限管理',
  'feishu-perm': '管理文件、文档和知识库的访问权限',
  'jw-feishu-suite': '嘉维扩展飞书功能，提供定制化业务能力',
  'Feishu All-in-One': '整合所有飞书功能的全能套件',
  'diagram-maker': '创建流程图、架构图和 UML 图，支持多种图表类型',
  'browser-automation': '控制浏览器完成网页操作，抓取网页内容',
  'python-debugpy': '调试 Python 代码，支持断点、变量查看和异常追踪',
  'node-inspect-debugger': '调试 JavaScript/TypeScript 代码，支持 Node.js 调试协议',
  'spike': '快速验证技术方案可行性，进行技术调研与原型测试',
  'weather': '获取实时天气信息和未来天气预报',
  'canvas': '创建可视化图形内容，生成图像和设计资产',
  '1password': '安全访问密码管理器中的凭据和机密',
  'apple-notes': '读写系统备忘录，管理笔记内容',
  'apple-reminders': '创建和管理系统提醒事项',
  'lark-approval-extra': '扩展版飞书审批，支持自定义表单字段、条件分支和多级审批人配置',
  'Feishu Task Daily Summary': '读取飞书任务清单，筛选未完成任务，生成每日待办汇总；支持创建、修改、关闭和归档任务',
  'healthcheck': '对 OpenClaw 主机进行安全审计：检查 SSH 配置、防火墙规则、系统更新、磁盘加密及备份状态',
}

// ── 技能分类 ──────────────────────────────────────────────
const SKILL_CATEGORIES: Record<string, string[]> = {
  '飞书协作': [
    'lark-im', 'lark-task', 'lark-calendar', 'lark-doc', 'lark-wiki',
    'lark-base', 'lark-sheets', 'lark-drive', 'lark-contact', 'lark-mail',
    'lark-approval', 'lark-attendance', 'lark-event', 'lark-minutes', 'lark-okr',
    'lark-slides', 'lark-vc', 'lark-vc-agent', 'lark-whiteboard', 'lark-shared',
    'lark-apps', 'lark-markdown', 'lark-workflow-meeting-summary', 'lark-workflow-standup-report',
    'lark-openapi-explorer', 'lark-skill-maker',
    'feishu-toolkit', 'feishu-doc', 'feishu-wiki', 'feishu-drive', 'feishu-perm',
    'jw-feishu-suite', 'Feishu All-in-One',
  ],
  '开发工具': [
    'browser-automation', 'python-debugpy', 'node-inspect-debugger', 'spike',
  ],
  '生产力工具': [
    'diagram-maker', 'canvas', 'weather', 'apple-notes', 'apple-reminders',
    'Feishu Task Daily Summary',
  ],
  '系统与安全': [
    '1password', 'healthcheck',
  ],
}

const CATEGORY_ICONS: Record<string, string> = {
  '飞书协作': '🐦',
  '开发工具': '🔧',
  '生产力工具': '⚡',
  '系统与安全': '🔒',
  '其他': '📦',
}

function getSkillDisplayName(name: string): string {
  return SKILL_DISPLAY_NAMES[name] || name
}

function getSkillDescription(name: string): string {
  // 优先使用硬编码中文描述，回退到 API 返回的 description（SKILL.md frontmatter）
  if (SKILL_DESCRIPTIONS[name]) return SKILL_DESCRIPTIONS[name]
  const apiSkill = skillsData.value?.skills.find(s => s.name === name)
  if (apiSkill?.description) {
    // 截取第一句/前80字
    const desc = apiSkill.description.split(/[。\n]/)[0].trim()
    return desc.slice(0, 80) || apiSkill.description.slice(0, 80)
  }
  return '暂无中文说明'
}

function getSkillCategory(name: string): string {
  for (const [cat, skills] of Object.entries(SKILL_CATEGORIES)) {
    if (skills.includes(name)) return cat
  }
  return '其他'
}

function getCategoryIcon(catName: string): string {
  return CATEGORY_ICONS[catName] || '📦'
}

function shortAgentName(fullName: string): string {
  // "产品经理-怡雯" → "怡雯"
  const dash = fullName.lastIndexOf('-')
  if (dash >= 0 && dash < fullName.length - 1) return fullName.slice(dash + 1)
  return fullName
}

// ── 计算属性 ──────────────────────────────────────────────
const installedSkills = computed(() => skillsData.value?.skills.filter(s => s.installed) ?? [])
const activatedSkills = computed(() => installedSkills.value.filter(s => s.enabled) ?? [])
const deactivatedSkills = computed(() => installedSkills.value.filter(s => !s.enabled) ?? [])
const notInstalledSkills = computed(() => skillsData.value?.skills.filter(s => !s.installed) ?? [])

const filteredSkills = computed(() => {
  switch (activeTab.value) {
    case 'activated': return activatedSkills.value
    case 'deactivated': return deactivatedSkills.value
    case 'notInstalled': return notInstalledSkills.value
    default: return skillsData.value?.skills ?? []
  }
})

/** 将当前 tab 的技能按分类分组，返回有序的对象 */
const filteredSkillsByCategory = computed(() => {
  const result: Record<string, SkillInfo[]> = {}
  const catOrder = Object.keys(SKILL_CATEGORIES).concat(['其他'])
  for (const cat of catOrder) result[cat] = []
  for (const skill of filteredSkills.value) {
    const cat = getSkillCategory(skill.name)
    if (!result[cat]) result[cat] = []
    result[cat].push(skill)
  }
  // 移除空分类
  for (const cat of catOrder) {
    if (result[cat].length === 0) delete result[cat]
  }
  return result
})

/** 按 Agent tab：已选 Agent 的技能（与 skillsData 合并，得到 installed/enabled 状态） */
const selectedAgentSkills = computed(() => {
  const agent = agentsConfigured.value.find(a => a.id === selectedAgentId.value)
  if (!agent) return []
  return agent.skills.map(skillName => {
    const info = skillsData.value?.skills.find(s => s.name === skillName)
    return {
      name: skillName,
      installed: info?.installed ?? false,
      enabled: info?.enabled ?? false,
      status: info?.status || '',
    }
  })
})

const selectedAgentSkillsByCategory = computed(() => {
  const result: Record<string, typeof selectedAgentSkills.value> = {}
  const catOrder = Object.keys(SKILL_CATEGORIES).concat(['其他'])
  for (const cat of catOrder) result[cat] = []
  for (const skill of selectedAgentSkills.value) {
    const cat = getSkillCategory(skill.name)
    if (!result[cat]) result[cat] = []
    result[cat].push(skill)
  }
  for (const cat of catOrder) {
    if (result[cat].length === 0) delete result[cat]
  }
  return result
})

// ── 对比 tab 计算属性 ─────────────────────────────────────

/** 所有 agent 技能的并集（去重） */
const allCompareSkills = computed<string[]>(() => {
  const s = new Set<string>()
  for (const ag of agentsConfigured.value) {
    for (const sk of ag.skills) s.add(sk)
  }
  return [...s]
})

/** 按分类分组的对比技能 */
const compareSkillsByCategory = computed<Record<string, string[]>>(() => {
  const result: Record<string, string[]> = {}
  const catOrder = Object.keys(SKILL_CATEGORIES).concat(['其他'])
  for (const cat of catOrder) result[cat] = []
  for (const sk of allCompareSkills.value) {
    const cat = getSkillCategory(sk)
    if (!result[cat]) result[cat] = []
    result[cat].push(sk)
  }
  for (const cat of catOrder) {
    if (result[cat].length === 0) delete result[cat]
  }
  return result
})

/** 对比状态：某技能在某 agent 上的状态 */
function compareStatus(skillName: string, agentId: string): 'enabled' | 'inactive' | 'absent' {
  const ag = agentsConfigured.value.find(a => a.id === agentId)
  if (!ag) return 'absent'
  // skills 数组已经在 fetchAgents 处理过 unconstrained，直接判断是否包含
  if (!ag.skills.includes(skillName)) return 'absent'
  const info = skillsData.value?.skills.find(s => s.name === skillName)
  if (!info?.installed) return 'inactive'
  return info.enabled ? 'enabled' : 'inactive'
}

function compareDotTitle(skillName: string, agentId: string): string {
  const ag = agentsConfigured.value.find(a => a.id === agentId)
  const agName = ag ? shortAgentName(ag.name || ag.id) : agentId
  const st = compareStatus(skillName, agentId)
  if (st === 'enabled') return `${agName} · 已激活`
  if (st === 'inactive') {
    const ag2 = agentsConfigured.value.find(a => a.id === agentId)
    const configured = ag2?.skills.includes(skillName)
    if (configured) {
      const info = skillsData.value?.skills.find(s => s.name === skillName)
      if (!info?.installed) return `${agName} · 已配置但未安装`
      return `${agName} · 已安装未激活`
    }
    return `${agName} · 未配置`
  }
  return `${agName} · 未配置`
}

// ── watch ─────────────────────────────────────────────────
watch(() => props.visible, async (val) => {
  if (val) {
    await nextTick()
    fetchSkills()
    fetchAgents()
  }
})

// ── API 调用 ──────────────────────────────────────────────
async function fetchSkills(): Promise<void> {
  loading.value = true
  try {
    const data = await getSkills()
    if (data) {
      skillsData.value = data
    } else {
      ElMessage.error('获取技能列表失败')
    }
  } catch (e: unknown) {
    console.error('[SkillsDialog] fetchSkills error:', e)
    ElMessage.error('获取技能列表异常')
  } finally {
    loading.value = false
  }
}

async function fetchAgents(): Promise<void> {
  try {
    const resp = await fetch('/api/agents-configured')
    if (resp.ok) {
      const data = await resp.json()
      // 处理 skillsUnconstrained：没有限制的 agent 使用所有已安装技能
      const allInstalled = (skillsData.value?.skills || []).filter(s => s.installed).map(s => s.name)
      agentsConfigured.value = (data.agents || []).map((a: AgentConfigured) => ({
        ...a,
        skills: a.skillsUnconstrained ? allInstalled : (a.skills || []),
      })).filter((a: AgentConfigured) => a.skills.length > 0)
      if (agentsConfigured.value.length > 0 && !selectedAgentId.value) {
        selectedAgentId.value = agentsConfigured.value[0].id
      }
    }
  } catch (e: unknown) {
    console.error('[SkillsDialog] fetchAgents error:', e)
  }
}

function handleSearch(): void {
  searchSkills(searchQuery.value)
}

async function searchSkills(query: string): Promise<void> {
  if (!query.trim()) return
  searching.value = true
  hasSearched.value = true
  try {
    const result = await searchClawHubSkills(query.trim())
    if (result?.success) {
      searchResults.value = result.skills ?? []
    } else {
      searchResults.value = []
      ElMessage.warning('未找到相关技能')
    }
  } catch (e: unknown) {
    console.error('[SkillsDialog] searchSkills error:', e)
    searchResults.value = []
    ElMessage.error('搜索失败')
  } finally {
    searching.value = false
  }
}

async function handleInstall(skill: SkillInfo | string): Promise<void> {
  const skillName = typeof skill === 'string' ? skill : skill.name
  const source = typeof skill === 'string' ? undefined : skill.source
  const wasClawHubTab = activeTab.value === 'clawhub'
  installingSkills.value.set(skillName, true)
  try {
    const result = await installSkill(skillName, source)
    if (result?.success) {
      ElMessage.success(`"${skillName}" 安装成功`)
      installingSkills.value.delete(skillName)
      await fetchSkills()
      if (wasClawHubTab && hasSearched.value && searchQuery.value.trim()) {
        await searchSkills(searchQuery.value.trim())
      }
    } else {
      ElMessage.error(result?.message ?? `安装 "${skillName}" 失败`)
    }
  } catch (e: unknown) {
    console.error('[SkillsDialog] install error:', e)
    ElMessage.error(`安装 "${skillName}" 异常`)
  } finally {
    installingSkills.value.delete(skillName)
  }
}

async function handleToggle(skillName: string, enabled: boolean): Promise<void> {
  togglingSkills.value.set(skillName, true)
  try {
    const result = await toggleSkill(skillName, enabled)
    if (result?.success) {
      ElMessage.success(`"${skillName}" 已${enabled ? '启用' : '禁用'}`)
      togglingSkills.value.delete(skillName)
      await fetchSkills()
    } else {
      ElMessage.error(result?.message ?? `切换 "${skillName}" 状态失败`)
    }
  } catch (e: unknown) {
    console.error('[SkillsDialog] toggle error:', e)
    ElMessage.error(`切换 "${skillName}" 状态异常`)
  } finally {
    togglingSkills.value.delete(skillName)
  }
}

function getStatusType(status: string): '' | 'success' | 'warning' | 'danger' | 'info' {
  const s = status.toLowerCase()
  if (s.includes('ready') || s.includes('active') || s.includes('enabled')) return 'success'
  if (s.includes('disabled') || s.includes('inactive')) return 'info'
  if (s.includes('error') || s.includes('fail')) return 'danger'
  return 'warning'
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays === 0) return '今天'
    if (diffDays === 1) return '昨天'
    if (diffDays < 30) return `${diffDays}天前`
    return date.toLocaleDateString('zh-CN')
  } catch {
    return dateStr
  }
}
</script>

<style scoped>
/* ── 统计栏 ── */
.skills-stats-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  margin-bottom: 16px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-elevated);
  font-size: 14px;
}

.stats-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.stats-label { color: var(--text-secondary); font-size: 13px; }
.stats-value { color: var(--text-primary); font-weight: 700; font-size: 18px; font-variant-numeric: tabular-nums; }
.stats-ready { color: #4caf50; }
.stats-divider { width: 1px; height: 24px; background: var(--border-color); }
.refresh-skills-btn { margin-left: auto; flex-shrink: 0; }

/* ── Tab ── */
.skills-tabs { margin-bottom: 16px; }
.skills-tabs :deep(.el-tabs__header) { margin-bottom: 0; }
.skills-tabs :deep(.el-tabs__nav-wrap)::after { background-color: var(--border-color); }
.skills-tabs :deep(.el-tabs__item) { color: var(--text-secondary); font-size: 14px; font-weight: 500; }
.skills-tabs :deep(.el-tabs__item.is-active) { color: var(--accent, #42a5f5); }
.skills-tabs :deep(.el-tabs__active-bar) { background-color: var(--accent, #42a5f5); }

.tab-count {
  margin-left: 4px;
  font-size: 11px;
  padding: 0 6px;
  height: 18px;
  line-height: 18px;
}

/* ── 加载 ── */
.skills-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 0;
  color: var(--text-secondary);
  font-size: 14px;
}

/* ── 滚动区域 ── */
.skills-scrollbar { height: 65vh; }

/* ── 分类标题 ── */
.category-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 4px 6px;
  margin-top: 8px;
}
.category-header:first-child { margin-top: 0; }
.category-icon { font-size: 15px; }
.category-name { font-size: 13px; font-weight: 700; color: var(--text-primary); }
.category-count {
  font-size: 11px;
  color: var(--text-secondary);
  background: rgba(255,255,255,0.07);
  border-radius: 10px;
  padding: 0 7px;
  height: 18px;
  line-height: 18px;
}

/* ── 卡片网格 ── */
.skills-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
  padding: 0 4px 12px;
}

/* ── 技能卡片 ── */
.skill-card {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  transition: all 0.2s;
}
.skill-card:hover {
  border-color: var(--accent);
  box-shadow: 0 3px 12px var(--accent-glow);
  transform: translateY(-1px);
}
.skill-card :deep(.el-card__body) {
  padding: 12px 14px;
  position: relative;
}

.skill-status-badges {
  position: absolute;
  top: 8px;
  right: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 1;
}

.status-badge { font-size: 11px; padding: 2px 8px; border-radius: 4px; white-space: nowrap; }
.badge-enabled { color: #4caf50; background: rgba(76,175,80,0.1); }

.install-skill-btn, .toggle-skill-btn {
  font-size: 11px;
  padding: 4px 10px;
  height: auto;
  line-height: 1;
}
.install-skill-btn :deep(.el-icon) { font-size: 11px; }
.install-btn-group { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }

.skill-card-inner { display: flex; gap: 12px; align-items: flex-start; }
.skill-icon-wrap {
  width: 38px;
  height: 38px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: rgba(159,122,234,0.15);
  color: #9f7aea;
}
.skill-icon-default { background: rgba(159,122,234,0.15); color: #9f7aea; }
.skill-info { flex: 1; min-width: 0; }
.skill-name-row { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
.skill-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.skill-id-row { font-size: 10px; color: var(--text-secondary); opacity: 0.7; margin-bottom: 3px; font-family: monospace; }
.skill-status-tag { flex-shrink: 0; }
.skill-description {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ── 按 Agent tab ── */
.by-agent-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.agent-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 0;
}

.agent-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 20px;
  border: 1px solid var(--border-color);
  cursor: pointer;
  background: var(--bg-elevated);
  transition: all 0.2s;
  user-select: none;
}
.agent-chip:hover {
  border-color: var(--accent, #42a5f5);
  background: rgba(66,165,245,0.08);
}
.agent-chip--active {
  border-color: var(--accent, #42a5f5);
  background: rgba(66,165,245,0.15);
}
.agent-chip-emoji { font-size: 16px; }
.agent-chip-name { font-size: 13px; font-weight: 500; color: var(--text-primary); }
.agent-chip-count {
  font-size: 11px;
  color: var(--text-secondary);
  background: rgba(255,255,255,0.08);
  border-radius: 8px;
  padding: 1px 6px;
}

.agent-no-skills { padding: 30px 0; }

/* 按 Agent tab 技能列表（列表式，更紧凑） */
.skills-list-compact {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 4px 14px;
}

.skill-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid transparent;
  transition: background 0.15s;
}
.skill-row:hover {
  background: rgba(255,255,255,0.04);
  border-color: var(--border-color);
}
.skill-row--enabled  { /* full opacity */ }
.skill-row--inactive  { opacity: 0.75; }
.skill-row--uninstalled { opacity: 0.4; }

.skill-row-status { padding-top: 5px; flex-shrink: 0; }
.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: all 0.2s;
}
/* 已激活：绿色实心 */
.status-dot--on {
  background: #4caf50;
  box-shadow: 0 0 5px rgba(76,175,80,0.7);
}
/* 已安装但未激活：橙色实心 */
.status-dot--inactive {
  background: #f59e0b;
  box-shadow: 0 0 4px rgba(245,158,11,0.5);
}
/* 未安装：灰色虚线圆圈 */
.status-dot--off {
  background: transparent;
  border: 1.5px dashed rgba(255,255,255,0.3);
}

.skill-row-info { flex: 1; min-width: 0; }
.skill-row-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.skill-row-id { font-size: 11px; color: var(--text-secondary); opacity: 0.65; font-family: monospace; font-weight: 400; }
.skill-row-desc { font-size: 12px; color: var(--text-secondary); margin-top: 2px; line-height: 1.4; }
.skill-row--expanded { background: rgba(56,189,248,0.06); border-radius: 6px; }
.skill-row { cursor: pointer; }

.skill-row-expand {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed rgba(255,255,255,0.1);
}
.skill-row-expand-loading { font-size: 11px; color: var(--text-secondary); }
.skill-tools-label {
  font-size: 10px; color: var(--text-secondary);
  font-weight: 600; letter-spacing: 0.05em;
  text-transform: uppercase; display: block; margin-bottom: 5px;
}
.skill-tools-list {
  display: flex; flex-wrap: wrap; gap: 4px;
}
.skill-tool-tag {
  font-size: 10px; background: rgba(56,189,248,0.1);
  color: #60a5fa; border: 1px solid rgba(96,165,250,0.25);
  border-radius: 4px; padding: 1px 6px;
  font-family: monospace;
}

.skill-row-btn {
  flex-shrink: 0;
  font-size: 11px;
  padding: 2px 8px;
  height: auto;
  line-height: 1.4;
  align-self: center;
}
.skill-uninstalled-label {
  flex-shrink: 0;
  font-size: 10px;
  color: rgba(255,255,255,0.2);
  align-self: center;
  white-space: nowrap;
}

/* ── 弹框样式 ── */
:deep(.skills-dialog.el-dialog) {
  background-color: var(--bg-card) !important;
  border: 1px solid var(--border-color) !important;
  border-radius: 12px !important;
}
:deep(.skills-dialog .el-dialog__header) {
  background-color: var(--bg-card) !important;
  border-bottom: 1px solid var(--border-color) !important;
  padding: 16px 20px !important;
  margin-right: 0 !important;
}
:deep(.skills-dialog .el-dialog__title) { color: var(--text-primary) !important; }
:deep(.skills-dialog .el-dialog__body) {
  background-color: var(--bg-card) !important;
  padding: 20px !important;
  color: var(--text-primary) !important;
  max-height: 90vh !important;
  overflow-y: auto !important;
}
:deep(.skills-dialog .el-dialog__close) { color: var(--text-primary) !important; }
:deep(.skills-dialog .el-dialog__close):hover { color: var(--accent, #38bdf8) !important; }

/* ── ClawHub ── */
.clawhub-search-section { display: flex; flex-direction: column; gap: 16px; }
.clawhub-search-input { width: 100%; }
.clawhub-search-input :deep(.el-input__wrapper) { border-radius: 8px; }
.clawhub-results { display: flex; flex-direction: column; gap: 8px; }
.clawhub-scrollbar { height: 60vh; }
.clawhub-results-scroll { padding: 4px; }
.clawhub-loading { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 32px 0; color: var(--text-secondary); font-size: 14px; }
.clawhub-empty { padding: 16px 0; }
.clawhub-hint { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; color: var(--text-secondary); }
.clawhub-hint-icon { color: var(--border-color); margin-bottom: 12px; }
.clawhub-hint-text { font-size: 14px; color: var(--text-secondary); margin: 0; }

/* ── 统计信息 ── */
.skill-stats { display: flex; align-items: center; gap: 12px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-color); }
.stat-item { font-size: 11px; color: var(--text-secondary); white-space: nowrap; }

/* ── 对比 tab ── */
.compare-section { display: flex; flex-direction: column; }
.compare-empty { padding: 32px 0; }
.compare-scrollbar { height: 65vh; }
.compare-header {
  display: flex; align-items: center;
  padding: 6px 0 6px 0;
  border-bottom: 2px solid var(--border-color);
  position: sticky; top: 0;
  background: var(--bg-card, #1a1d25);
  z-index: 2;
}
.compare-cat-row {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 0 4px 2px;
  font-size: 12px; font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.compare-cat-icon { font-size: 13px; }
.compare-row {
  display: flex; align-items: center;
  padding: 5px 0;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.compare-row:hover { background: rgba(255,255,255,0.03); }
.compare-skill-col {
  flex: 0 0 220px; min-width: 220px;
  display: flex; flex-direction: column; gap: 1px;
  padding-right: 8px;
}
.compare-skill-name {
  font-size: 13px; color: var(--text-primary); font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.compare-skill-id {
  font-size: 10px; color: var(--text-secondary); opacity: 0.6;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.compare-header .compare-skill-col {
  font-size: 11px; font-weight: 600; color: var(--text-secondary);
  text-transform: uppercase; letter-spacing: 0.05em;
}
.compare-agent-col {
  flex: 1; min-width: 52px;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 600;
  color: var(--text-secondary);
  text-align: center;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.compare-dot {
  display: inline-block;
  width: 12px; height: 12px; border-radius: 50%;
  flex-shrink: 0;
}
.compare-dot--enabled { background: #22c55e; box-shadow: 0 0 6px rgba(34,197,94,0.5); }
.compare-dot--inactive { background: #f59e0b; opacity: 0.85; }
.compare-dot--absent { background: transparent; border: 1.5px dashed rgba(255,255,255,0.2); }
.compare-legend {
  display: flex; gap: 20px; align-items: center;
  padding: 14px 4px 6px 4px;
  border-top: 1px solid var(--border-color);
  margin-top: 8px;
}
.compare-legend-item {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--text-secondary);
}
</style>

<template>
  <el-dialog
    v-model="visible"
    title="Token 消耗详情"
    width="700px"
    :close-on-click-modal="true"
    class="token-detail-dialog"
  >
    <!-- 全局按模型汇总 -->
    <div class="section">
      <div class="section-title">
        <el-icon><Odometer /></el-icon>
        全局汇总（按模型）
      </div>
      <el-table :data="modelRows" stripe size="small" class="model-table">
        <el-table-column label="模型" min-width="160">
          <template #default="{ row }">
            <div class="model-cell">
              <span class="model-dot" :style="{ background: row.color }"></span>
              <span class="model-name">{{ row.displayName }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="Token 用量" align="right" min-width="120">
          <template #default="{ row }">
            <span class="token-num">{{ row.tokens.toLocaleString() }}</span>
          </template>
        </el-table-column>
        <el-table-column label="占比" align="right" width="100">
          <template #default="{ row }">
            <el-progress
              :percentage="row.pct"
              :stroke-width="6"
              :show-text="false"
              :color="row.color"
              style="width: 60px; display: inline-block; margin-right: 6px; vertical-align: middle;"
            />
            <span class="pct-num">{{ row.pct }}%</span>
          </template>
        </el-table-column>
        <el-table-column label="费用" align="right" width="100">
          <template #default="{ row }">
            <span :class="row.cost > 0 ? 'cost-num' : 'cost-zero'">
              {{ row.cost > 0 ? '¥' + row.cost.toFixed(4) : '-' }}
            </span>
          </template>
        </el-table-column>
      </el-table>

      <!-- 总计行 -->
      <div class="total-row">
        <span class="total-label">合计</span>
        <span class="total-tokens">{{ totalTokens.toLocaleString() }} tokens</span>
        <span class="total-cost">{{ totalCost > 0 ? '¥' + totalCost.toFixed(4) : '-' }}</span>
      </div>
    </div>

    <!-- 各 Agent 明细 -->
    <div class="section" style="margin-top: 20px;">
      <div class="section-title">
        <el-icon><UserFilled /></el-icon>
        各 Agent 明细
      </div>
      <el-table :data="agentModelRows" stripe size="small" class="agent-table">
        <el-table-column label="Agent" width="130">
          <template #default="{ row }">
            <div v-if="row.isFirst" class="agent-cell">
              <span class="agent-avatar-sm">{{ row.emoji || row.agentId[0].toUpperCase() }}</span>
              <span class="agent-id-name">{{ row.agentName }}</span>
            </div>
            <div v-else class="agent-cell-empty"></div>
          </template>
        </el-table-column>
        <el-table-column label="模型" min-width="140">
          <template #default="{ row }">
            <div class="model-cell">
              <span class="model-dot" :style="{ background: getModelColor(row.model) }"></span>
              <span>{{ getModelDisplayName(row.model) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="Token 用量" align="right" min-width="120">
          <template #default="{ row }">
            <span class="token-num">{{ row.tokens.toLocaleString() }}</span>
          </template>
        </el-table-column>
        <el-table-column label="费用" align="right" width="100">
          <template #default="{ row }">
            <span :class="row.cost > 0 ? 'cost-num' : 'cost-zero'">
              {{ row.cost > 0 ? '¥' + row.cost.toFixed(4) : '-' }}
            </span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <span class="updated-at">数据更新：{{ store.globalUsage.updatedAt ? new Date(store.globalUsage.updatedAt).toLocaleString('zh-CN') : '-' }}</span>
        <el-button @click="visible = false">关闭</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Odometer, UserFilled } from '@element-plus/icons-vue'
import { useAgentStore } from '../stores/agent'

const visible = defineModel<boolean>('visible', { default: false })

const store = useAgentStore()

// 模型颜色映射
const MODEL_COLORS: Record<string, string> = {
  'deepseek-v4-pro': '#4f6ef7',
  'MiniMax-M2.7': '#10b981',
  'claude-sonnet-4-6': '#f59e0b',
  'claude-sonnet-4-5': '#f59e0b',
  'gpt-4o': '#6366f1',
}
const FALLBACK_COLORS = ['#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316']
let colorIdx = 0
const dynamicColors: Record<string, string> = {}

function getModelColor(model: string): string {
  if (MODEL_COLORS[model]) return MODEL_COLORS[model]
  if (!dynamicColors[model]) {
    dynamicColors[model] = FALLBACK_COLORS[colorIdx % FALLBACK_COLORS.length]
    colorIdx++
  }
  return dynamicColors[model]
}

// 模型显示名映射
const MODEL_DISPLAY: Record<string, string> = {
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'deepseek-v3': 'DeepSeek V3',
  'MiniMax-M2.7': 'MiniMax M2.7',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-sonnet-4-5': 'Claude Sonnet 4.5',
  'claude-opus-4': 'Claude Opus 4',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'unknown': '未知模型',
}

function getModelDisplayName(model: string): string {
  return MODEL_DISPLAY[model] || model
}

// Agent 显示名（从 store）
function getAgentDisplayName(agentId: string): string {
  const agent = store.agents.find(a => {
    const id = (a.key || '').split(':')[1] || ''
    return id === agentId
  })
  return agent?.name || agentId
}

function getAgentEmoji(agentId: string): string {
  const agent = store.agents.find(a => {
    const id = (a.key || '').split(':')[1] || ''
    return id === agentId
  })
  return agent?.emoji || ''
}

// 全局总计
const totalTokens = computed(() => store.globalUsage.totalTokens || 0)
const totalCost = computed(() => store.globalUsage.totalCost || 0)

// 按模型汇总行
const modelRows = computed(() => {
  const byModel = store.globalUsage.byModel || {}
  const total = totalTokens.value || 1
  return Object.entries(byModel)
    .map(([model, data]) => ({
      model,
      displayName: getModelDisplayName(model),
      tokens: data.tokens,
      cost: data.cost,
      pct: Math.round((data.tokens / total) * 100),
      color: getModelColor(model),
    }))
    .sort((a, b) => b.tokens - a.tokens)
})

// 各 Agent x 模型明细行（扁平化，带 isFirst 标记）
const agentModelRows = computed(() => {
  const byAgentByModel = store.globalUsage.byAgentByModel || {}
  const rows: any[] = []
  const agentOrder = ['main', 'pm', 'developer', 'tester', 'inspector', 'archivist']

  // 先按预设顺序，再按 token 量排剩余
  const sortedAgents = [
    ...agentOrder.filter(id => byAgentByModel[id]),
    ...Object.keys(byAgentByModel).filter(id => !agentOrder.includes(id)),
  ]

  for (const agentId of sortedAgents) {
    const modelMap = byAgentByModel[agentId]
    if (!modelMap) continue
    const models = Object.entries(modelMap).sort((a, b) => b[1].tokens - a[1].tokens)
    models.forEach(([model, data], idx) => {
      rows.push({
        agentId,
        agentName: getAgentDisplayName(agentId),
        emoji: getAgentEmoji(agentId),
        model,
        tokens: data.tokens,
        cost: data.cost,
        isFirst: idx === 0,
      })
    })
  }
  return rows
})
</script>

<style scoped>
.section {
  margin-bottom: 4px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #e2e8f0);
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-color, #2d3748);
}

.model-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.model-name {
  font-size: 13px;
}

.token-num {
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  font-weight: 500;
}

.pct-num {
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
  vertical-align: middle;
}

.cost-num {
  color: #10b981;
  font-weight: 500;
}

.cost-zero {
  color: var(--text-secondary, #94a3b8);
}

.total-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 20px;
  padding: 8px 12px;
  background: var(--bg-elevated, rgba(255,255,255,0.04));
  border-radius: 6px;
  margin-top: 6px;
  font-size: 13px;
}

.total-label {
  color: var(--text-secondary, #94a3b8);
  margin-right: auto;
  font-weight: 600;
}

.total-tokens {
  font-weight: 600;
  color: var(--text-primary, #e2e8f0);
}

.total-cost {
  font-weight: 600;
  color: #10b981;
  min-width: 80px;
  text-align: right;
}

.agent-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.agent-cell-empty {
  height: 20px;
}

.agent-avatar-sm {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: var(--bg-elevated, rgba(255,255,255,0.08));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  flex-shrink: 0;
}

.agent-id-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary, #e2e8f0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.updated-at {
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
}

/* 覆盖 Element Plus 表格样式 */
:deep(.el-table) {
  background: transparent;
  font-size: 13px;
}

:deep(.el-table tr) {
  background: transparent;
}

:deep(.el-table--striped .el-table__body tr.el-table__row--striped td) {
  background: rgba(255,255,255,0.03);
}

:deep(.el-table th) {
  background: rgba(255,255,255,0.04);
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
</style>

<template>
  <el-dialog
    v-model="visible"
    title="计费配置"
    width="780px"
    :close-on-click-modal="false"
    class="billing-config-dialog"
  >
    <div class="bc-intro">
      <el-icon><InfoFilled /></el-icon>
      <span>
        按模型分别配置计费方式。三种模式：
        <b>包月订阅</b>（如 MiniMax 包月）、
        <b>按 token 计费</b>（如 OpenAI / Claude / DeepSeek，支持时段折扣）、
        <b>使用 OpenClaw 默认</b>（沿用 Gateway 自带计费）。
      </span>
    </div>

    <el-scrollbar height="56vh" class="bc-scroll">
      <div v-if="!localConfig" class="bc-empty">
        <el-icon class="is-loading"><Loading /></el-icon> 加载中…
      </div>

      <template v-else>
        <div v-if="displayedModelIds.length === 0" class="bc-empty">
          <el-icon><InfoFilled /></el-icon>
          暂无已使用的模型。开始使用 OpenClaw 后，已消耗 token 的模型会自动出现在这里。
        </div>

        <!-- 各模型卡片（只展示有 token 用量的模型） -->
        <div
          v-for="(cfg, modelId) in displayedModels"
          :key="modelId"
          class="bc-model-card"
        >
          <div class="bc-model-header">
            <span class="bc-model-id">{{ modelId }}</span>
            <el-select
              v-model="cfg.mode"
              size="small"
              class="bc-mode-select"
              :teleported="false"
            >
              <el-option label="📅 包月订阅" value="subscription_monthly" />
              <el-option label="💰 按 token 计费" value="per_token" />
              <el-option label="⚙️ OpenClaw 默认" value="use_default" />
              <el-option label="🆓 免费" value="free" />
            </el-select>
            <el-button
              type="danger"
              link
              size="small"
              :icon="Delete"
              @click="removeModel(String(modelId))"
            >移除</el-button>
          </div>

          <!-- 包月订阅字段 -->
          <div v-if="cfg.mode === 'subscription_monthly'" class="bc-fields">
            <div class="bc-field">
              <label>月订阅费 (¥/月)</label>
              <el-input-number v-model="cfg.monthlyCNY" :min="0" :precision="2" size="small" style="width: 100%;" />
            </div>
            <div class="bc-field">
              <label>月度 token 配额（可选）</label>
              <el-input-number v-model="cfg.quotaTokensPerMonth" :min="0" :step="1000000" size="small" style="width: 100%;" />
            </div>
            <div class="bc-field">
              <label>超额单价 (¥/百万 token)</label>
              <el-input-number v-model="cfg.overTokenPriceCNYPerMillion" :min="0" :precision="2" size="small" style="width: 100%;" />
            </div>
          </div>

          <!-- 按 token 字段 -->
          <div v-else-if="cfg.mode === 'per_token'" class="bc-fields">
            <div class="bc-field">
              <label>输入价 (¥/百万 token)</label>
              <el-input-number v-model="cfg.inputPriceCNYPerMillion" :min="0" :precision="4" size="small" style="width: 100%;" />
            </div>
            <div class="bc-field">
              <label>输出价 (¥/百万 token)</label>
              <el-input-number v-model="cfg.outputPriceCNYPerMillion" :min="0" :precision="4" size="small" style="width: 100%;" />
            </div>
            <div class="bc-field">
              <label>缓存读价 (¥/百万 token，可选)</label>
              <el-input-number v-model="cfg.cacheReadPriceCNYPerMillion" :min="0" :precision="4" size="small" style="width: 100%;" />
            </div>
            <div class="bc-field bc-field-full">
              <label class="bc-field-section">📉 时段折扣（可选，例：DeepSeek 夜间半价）</label>
              <div class="bc-discount-row">
                <span class="bc-discount-label">折扣系数</span>
                <el-input-number
                  v-model="cfg.discountFactor"
                  :min="0" :max="1" :step="0.1" :precision="2"
                  size="small"
                  placeholder="0.5 = 5折"
                />
                <span class="bc-discount-label">生效时段（北京时间）</span>
                <el-input-number v-model="cfg.discountStartHour" :min="0" :max="23" size="small" />
                <span class="bc-discount-sep">至</span>
                <el-input-number v-model="cfg.discountEndHour" :min="0" :max="23" size="small" />
                <span class="bc-discount-label">时</span>
              </div>
            </div>
          </div>

          <div v-else-if="cfg.mode === 'use_default'" class="bc-fields-note">
            使用 OpenClaw Gateway 自带的计费数据（usage-stats 返回的 cost 字段）。
          </div>

          <div v-else-if="cfg.mode === 'free'" class="bc-fields-note">
            该模型不计费（费用恒为 ¥0）。
          </div>

          <div v-if="cfg.note" class="bc-note">💡 {{ cfg.note }}</div>
        </div>

        <!-- 添加新模型 -->
        <div class="bc-add-row">
          <el-input
            v-model="newModelId"
            placeholder="输入模型 ID（如 gpt-4-turbo）"
            size="small"
            style="width: 280px;"
            @keyup.enter="addModel"
          />
          <el-button
            type="primary"
            size="small"
            :icon="Plus"
            :disabled="!newModelId.trim()"
            @click="addModel"
          >添加模型</el-button>
          <el-button
            size="small"
            :icon="RefreshLeft"
            @click="restoreDefaults"
          >恢复内置默认</el-button>
        </div>

        <!-- 全局电费叠加（可选） -->
        <div class="bc-global-section">
          <div class="bc-global-title">🔌 全局电费（可选，叠加在所有模型成本之上）</div>
          <div class="bc-global-field">
            <span>电费单价 (¥/小时)</span>
            <el-input-number
              v-model="localConfig.globalAddons!.electricityPerHour"
              :min="0" :precision="2" size="small"
              placeholder="0 = 不叠加"
            />
          </div>
        </div>
      </template>
    </el-scrollbar>

    <template #footer>
      <div class="bc-footer">
        <span class="bc-footer-hint">配置保存于 <code>billing-config.json</code></span>
        <div>
          <el-button @click="visible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { InfoFilled, Delete, Plus, RefreshLeft, Loading } from '@element-plus/icons-vue'
import { useAgentStore } from '../stores/agent'

const visible = defineModel<boolean>('visible', { default: false })
const store = useAgentStore()

const localConfig = ref<any>(null)
const newModelId = ref('')
const saving = ref(false)
const presetDefaults = ref<any>(null)

// 已使用过的模型 ID 集合（从 usage-stats 拿）
const usedModelIds = computed<string[]>(() => {
  const byModel = store.globalUsage.byModel || {}
  return Object.keys(byModel).filter(id => (byModel[id]?.tokens ?? 0) > 0)
})

// 仅展示已使用过的模型 + 用户手动添加的（按 token 用量降序）
const displayedModelIds = computed<string[]>(() => {
  if (!localConfig.value) return []
  const byModel = store.globalUsage.byModel || {}
  const inConfig = Object.keys(localConfig.value.models)
  const all = new Set([...usedModelIds.value, ...inConfig.filter(id => manuallyAdded.value.has(id))])
  return [...all].sort((a, b) => (byModel[b]?.tokens ?? 0) - (byModel[a]?.tokens ?? 0))
})

// 用于 v-for 双参数迭代：返回 { modelId: cfg } 对象（保持 displayedModelIds 顺序）
const displayedModels = computed<Record<string, any>>(() => {
  if (!localConfig.value) return {}
  const out: Record<string, any> = {}
  for (const id of displayedModelIds.value) {
    if (localConfig.value.models[id]) out[id] = localConfig.value.models[id]
  }
  return out
})

// 跟踪用户手动添加（点过"添加模型"按钮）的 ID，让它们即使没用过也能展示
const manuallyAdded = ref<Set<string>>(new Set())

// 打开时加载最新配置（深拷贝避免直接改 store）
watch(visible, async (val) => {
  if (val) {
    await store.fetchBillingConfig()
    const src = store.billingConfig
    localConfig.value = src ? JSON.parse(JSON.stringify(src)) : { version: 1, models: {}, fallback: { mode: 'use_default' }, globalAddons: { electricityPerHour: 0 } }
    if (!localConfig.value.globalAddons) localConfig.value.globalAddons = { electricityPerHour: 0 }
    if (!localConfig.value.fallback) localConfig.value.fallback = { mode: 'use_default' }
    // 拉一次后端的内置预设，给新模型自动套用
    if (!presetDefaults.value) {
      try {
        const resp = await fetch('/api/billing-config/defaults')
        presetDefaults.value = await resp.json()
      } catch { /* 静默 */ }
    }
    // 已使用但还没有配置的模型 → 自动加上（用预设或合理默认值）
    autoAddUsedModels()
  }
})

function autoAddUsedModels() {
  if (!localConfig.value) return
  for (const modelId of usedModelIds.value) {
    if (localConfig.value.models[modelId]) continue  // 已有
    const preset = presetDefaults.value?.models?.[modelId]
    if (preset) {
      localConfig.value.models[modelId] = JSON.parse(JSON.stringify(preset))
    } else {
      // 没预设 → 默认按 token 计费，单价 0，提示用户编辑
      localConfig.value.models[modelId] = {
        mode: 'per_token',
        inputPriceCNYPerMillion: 0,
        outputPriceCNYPerMillion: 0,
        note: '⚠️ 新模型自动添加，请编辑实际单价',
      }
    }
  }
}

function addModel() {
  const id = newModelId.value.trim()
  if (!id) return
  if (localConfig.value.models[id]) {
    ElMessage.warning(`"${id}" 已存在`)
    return
  }
  const preset = presetDefaults.value?.models?.[id]
  localConfig.value.models[id] = preset ? JSON.parse(JSON.stringify(preset)) : {
    mode: 'per_token',
    inputPriceCNYPerMillion: 0,
    outputPriceCNYPerMillion: 0,
  }
  manuallyAdded.value.add(id)
  newModelId.value = ''
}

function removeModel(id: string) {
  ElMessageBox.confirm(`确定移除 "${id}" 的计费配置？`, '提示', {
    confirmButtonText: '移除',
    cancelButtonText: '取消',
    type: 'warning',
  }).then(() => {
    delete localConfig.value.models[id]
  }).catch(() => {})
}

async function restoreDefaults() {
  try {
    const resp = await fetch('/api/billing-config/defaults')
    const data = await resp.json()
    localConfig.value = JSON.parse(JSON.stringify(data))
    if (!localConfig.value.globalAddons) localConfig.value.globalAddons = { electricityPerHour: 0 }
    ElMessage.success('已重置为内置默认值，需要点击「保存」才生效')
  } catch (e: any) {
    ElMessage.error('恢复失败：' + e.message)
  }
}

async function handleSave() {
  saving.value = true
  try {
    const result = await store.saveBillingConfig(localConfig.value)
    if (result.success) {
      ElMessage.success('计费配置已保存')
      visible.value = false
    } else {
      ElMessage.error('保存失败：' + result.error)
    }
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.bc-intro {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(66,165,245,0.08);
  border: 1px solid rgba(66,165,245,0.2);
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
  margin-bottom: 12px;
  line-height: 1.6;
}
.bc-intro b { color: var(--text-primary, #e2e8f0); }
.bc-intro .el-icon { color: #42a5f5; margin-top: 2px; flex-shrink: 0; }

.bc-empty {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 60px 0; color: var(--text-secondary, #94a3b8);
}

.bc-model-card {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}
.bc-model-header {
  display: flex; align-items: center; gap: 12px;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.bc-model-id {
  flex: 1;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 13px;
  font-weight: 600;
  color: #90caf9;
}
.bc-mode-select { width: 200px; }

.bc-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 16px;
}
.bc-field { display: flex; flex-direction: column; gap: 4px; }
.bc-field-full { grid-column: 1 / -1; }
.bc-field label {
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
  letter-spacing: 0.3px;
}
.bc-field-section {
  font-size: 12px !important;
  color: var(--text-primary, #e2e8f0) !important;
  font-weight: 600;
  margin-top: 6px;
}

.bc-fields-note {
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
  padding: 8px 4px;
  font-style: italic;
}

.bc-discount-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 10px;
  background: rgba(245,158,11,0.06);
  border: 1px solid rgba(245,158,11,0.15);
  border-radius: 6px;
}
.bc-discount-label { font-size: 11px; color: #fbbf24; }
.bc-discount-sep { color: var(--text-secondary, #94a3b8); }

.bc-note {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
  padding: 6px 8px;
  background: rgba(255,255,255,0.02);
  border-left: 2px solid rgba(255,255,255,0.2);
  border-radius: 0 4px 4px 0;
}

.bc-add-row {
  display: flex; gap: 10px;
  padding: 12px 0;
  margin-top: 8px;
  border-top: 1px dashed rgba(255,255,255,0.1);
}

.bc-global-section {
  margin-top: 16px;
  padding: 12px;
  background: rgba(76,175,80,0.06);
  border: 1px solid rgba(76,175,80,0.15);
  border-radius: 8px;
}
.bc-global-title { font-size: 13px; font-weight: 600; margin-bottom: 8px; color: var(--text-primary); }
.bc-global-field { display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--text-secondary); }

.bc-footer {
  display: flex; align-items: center; justify-content: space-between;
}
.bc-footer-hint { font-size: 11px; color: var(--text-secondary, #94a3b8); }
.bc-footer-hint code { background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 3px; }
</style>

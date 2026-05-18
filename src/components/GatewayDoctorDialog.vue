<template>
  <el-dialog
    v-model="dialogVisible"
    title="网关诊断修复"
    width="720px"
    :close-on-click-modal="false"
    destroy-on-close
    class="doctor-dialog"
    :modal-class="'doctor-dialog-modal'"
  >
    <!-- 状态指示器 -->
    <div class="doctor-status-bar" :class="statusClass">
      <el-icon :size="18" :class="statusIconClass">
        <component :is="statusIcon" />
      </el-icon>
      <span class="status-text">{{ statusText }}</span>
      <el-icon v-if="running" class="is-loading" :size="16"><Loading /></el-icon>
    </div>

    <!-- 执行信息 -->
    <div v-if="result" class="doctor-info">
      <div class="info-row">
        <span class="info-label">命令</span>
        <span class="info-value code">{{ result.command }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">平台</span>
        <span class="info-value">{{ result.platform }}</span>
      </div>
      <div class="info-row" v-if="result.error">
        <span class="info-label">错误</span>
        <span class="info-value error-text">{{ result.error }}</span>
      </div>
    </div>

    <!-- 诊断输出 (stdout) -->
    <div v-if="result?.stdout" class="doctor-output">
      <div class="output-header">
        <el-icon :size="14"><Document /></el-icon>
        <span>标准输出</span>
      </div>
      <pre class="output-content">{{ result.stdout }}</pre>
    </div>

    <!-- 错误输出 (stderr) -->
    <div v-if="result?.stderr" class="doctor-output doctor-output-error">
      <div class="output-header">
        <el-icon :size="14"><Warning /></el-icon>
        <span>错误输出</span>
      </div>
      <pre class="output-content">{{ result.stderr }}</pre>
    </div>

    <!-- 空状态 -->
    <el-empty v-if="!running && !result" description="暂无诊断结果" :image-size="60" />

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="dialogVisible = false">关闭</el-button>
        <el-button
          v-if="done"
          type="primary"
          @click="handleRefreshAndClose"
        >
          刷新状态并关闭
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { runDoctor, type DoctorResult } from '../api/system'
import { ElMessage } from 'element-plus'
import {
  Loading,
  Document,
  Warning,
  CircleCheck,
  CircleClose,
} from '@element-plus/icons-vue'

const props = withDefaults(defineProps<{
  visible: boolean
}>(), {
  visible: false
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'refresh': []
}>()

const dialogVisible = computed({
  get: () => props.visible,
  set: (val: boolean) => emit('update:visible', val),
})

const running = ref(false)
const result = ref<DoctorResult | null>(null)

// Status states: 'idle' | 'running' | 'success' | 'failed'
const status = ref<'idle' | 'running' | 'success' | 'failed'>('idle')

const done = computed(() => status.value === 'success' || status.value === 'failed')

const statusText = computed(() => {
  switch (status.value) {
    case 'idle': return '等待执行...'
    case 'running': return '正在执行诊断命令...'
    case 'success': return '诊断完成'
    case 'failed': return '诊断失败'
    default: return ''
  }
})

const statusClass = computed(() => {
  switch (status.value) {
    case 'running': return 'status-running'
    case 'success': return 'status-success'
    case 'failed': return 'status-failed'
    default: return 'status-idle'
  }
})

const statusIconClass = computed(() => {
  switch (status.value) {
    case 'success': return 'icon-success'
    case 'failed': return 'icon-failed'
    case 'running': return 'icon-running'
    default: return 'icon-idle'
  }
})

const statusIcon = computed(() => {
  switch (status.value) {
    case 'running': return Loading
    case 'success': return CircleCheck
    case 'failed': return CircleClose
    default: return Document
  }
})

watch(() => props.visible, async (val) => {
  if (val) {
    // Reset state
    status.value = 'idle'
    result.value = null

    // Auto-run doctor on open
    await nextTick()
    runDiagnosis()
  }
})

async function runDiagnosis(): Promise<void> {
  running.value = true
  status.value = 'running'
  result.value = null

  try {
    const data = await runDoctor()
    if (data) {
      result.value = data
      status.value = data.success ? 'success' : 'failed'
      if (data.success) {
        ElMessage.success('诊断修复完成')
      } else {
        ElMessage.warning('诊断完成，但检测到问题')
      }
    } else {
      status.value = 'failed'
      ElMessage.error('诊断请求失败，请检查后端服务')
    }
  } catch (e: unknown) {
    console.error('[GatewayDoctorDialog] runDiagnosis error:', e)
    status.value = 'failed'
    ElMessage.error('诊断执行异常')
  } finally {
    running.value = false
  }
}

function handleRefreshAndClose(): void {
  emit('refresh')
  dialogVisible.value = false
}
</script>

<style scoped>
/* ── 状态栏 ── */
.doctor-status-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  margin-bottom: 16px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-elevated);
  font-size: 14px;
}

.status-idle {
  border-color: var(--border-color);
}

.status-running {
  border-color: rgba(59, 130, 246, 0.4);
  background: rgba(59, 130, 246, 0.08);
}

.status-success {
  border-color: rgba(76, 175, 80, 0.4);
  background: rgba(76, 175, 80, 0.08);
}

.status-failed {
  border-color: rgba(244, 67, 54, 0.4);
  background: rgba(244, 67, 54, 0.08);
}

.status-text {
  flex: 1;
  color: var(--text-primary);
  font-weight: 500;
}

.icon-idle { color: var(--text-secondary); }
.icon-running { color: #3b82f6; }
.icon-success { color: #4caf50; }
.icon-failed { color: #f44336; }

/* ── 执行信息 ── */
.doctor-info {
  margin-bottom: 16px;
  padding: 12px 16px;
  background: var(--bg-elevated);
  border-radius: 8px;
  border: 1px solid var(--border-color);
}

.info-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 0;
}

.info-row:not(:last-child) {
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 8px;
  margin-bottom: 4px;
}

.info-label {
  font-size: 12px;
  color: var(--text-secondary);
  min-width: 48px;
  flex-shrink: 0;
}

.info-value {
  font-size: 13px;
  color: var(--text-primary);
  word-break: break-all;
}

.info-value.code {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  color: var(--accent, #38bdf8);
}

.error-text {
  color: #f44336;
}

/* ── 诊断输出 ── */
.doctor-output {
  margin-bottom: 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  overflow: hidden;
}

.doctor-output-error {
  border-color: rgba(244, 67, 54, 0.3);
}

.output-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border-color);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.output-content {
  margin: 0;
  padding: 14px 16px;
  max-height: 400px;
  overflow-y: auto;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-primary);
  background: var(--bg-card);
  white-space: pre-wrap;
  word-break: break-word;
}

/* 滚动条样式 */
.output-content::-webkit-scrollbar {
  width: 6px;
}

.output-content::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 3px;
}

.output-content::-webkit-scrollbar-track {
  background: transparent;
}

/* ── Footer ── */
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}

/* ── 弹框样式 ── */
:deep(.doctor-dialog.el-dialog) {
  background-color: var(--bg-card) !important;
  border: 1px solid var(--border-color) !important;
  border-radius: 12px !important;
}

:deep(.doctor-dialog .el-dialog__header) {
  background-color: var(--bg-card) !important;
  border-bottom: 1px solid var(--border-color) !important;
  padding: 16px 20px !important;
  margin-right: 0 !important;
}

:deep(.doctor-dialog .el-dialog__title) {
  color: var(--text-primary) !important;
}

:deep(.doctor-dialog .el-dialog__body) {
  background-color: var(--bg-card) !important;
  padding: 20px !important;
  color: var(--text-primary) !important;
  max-height: 75vh !important;
  overflow-y: auto !important;
}

:deep(.doctor-dialog .el-dialog__footer) {
  background-color: var(--bg-card) !important;
  padding: 12px 20px 20px !important;
  border-top: none !important;
}

:deep(.doctor-dialog .el-dialog__close) {
  color: var(--text-primary) !important;
}

:deep(.doctor-dialog .el-dialog__close):hover {
  color: var(--accent, #38bdf8) !important;
}

.doctor-dialog-modal {
  background-color: rgba(0, 0, 0, 0.5);
}
</style>

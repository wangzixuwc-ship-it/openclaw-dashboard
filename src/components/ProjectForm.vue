<template>
  <el-form ref="formRef" :model="form" :rules="rules" label-width="80px" label-position="top">
    <!-- 项目目录（必填） -->
    <el-form-item label="项目目录" prop="projectPath">
      <div class="directory-picker">
        <el-input v-model="form.projectPath" placeholder="选择或输入项目目录路径" @input="onPathChange">
          <template #prefix>
            <el-icon><Folder /></el-icon>
          </template>
        </el-input>
        <el-button @click="pickDirectory">选择目录</el-button>
      </div>
    </el-form-item>

    <!-- 项目名称（必填，默认从目录提取） -->
    <el-form-item label="项目名称" prop="name">
      <el-input v-model="form.name" placeholder="输入项目名称" maxlength="64" show-word-limit />
    </el-form-item>

    <!-- 项目状态（必填） -->
    <el-form-item label="项目状态" prop="status">
      <el-radio-group v-model="form.status">
        <el-radio-button value="pending">待启动</el-radio-button>
        <el-radio-button value="active">进行中</el-radio-button>
        <el-radio-button value="paused">已暂停</el-radio-button>
        <el-radio-button value="completed">已完成</el-radio-button>
      </el-radio-group>
    </el-form-item>

    <!-- 项目描述（可选） -->
    <el-form-item label="描述">
      <el-input
        v-model="form.description"
        type="textarea"
        :rows="3"
        placeholder="项目描述（可选）"
        maxlength="500"
      />
    </el-form-item>

    <!-- 提交按钮 -->
    <el-form-item>
      <div class="form-actions">
        <el-button type="primary" @click="handleSubmit" :loading="submitting">
          {{ isEdit ? '保存' : '创建' }}
        </el-button>
        <el-button @click="$emit('cancel')">取消</el-button>
      </div>
    </el-form-item>
  </el-form>

  <!-- 目录选择弹窗 -->
  <el-dialog
    v-model="showPicker"
    title="选择项目目录"
    width="480px"
    :close-on-click-modal="false"
    class="picker-dialog"
  >
    <el-input
      v-model="pickerPath"
      placeholder="输入或粘贴项目目录路径"
      clearable
      @keyup.enter="confirmPick"
    >
      <template #prefix>
        <el-icon><Folder /></el-icon>
      </template>
    </el-input>
    <template #footer>
      <el-button @click="showPicker = false">取消</el-button>
      <el-button type="primary" @click="confirmPick">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { Folder } from '@element-plus/icons-vue'
import type { Project } from '../types'
import type { FormInstance, FormRules } from 'element-plus'

const props = defineProps<{
  project?: Project | null
}>()

const emit = defineEmits<{
  submit: [data: { name: string; description?: string; projectPath?: string; status?: string }]
  cancel: []
}>()

const isEdit = computed(() => !!props.project)

const form = reactive({
  projectPath: props.project?.rootPath ?? '',
  name: props.project?.name ?? '',
  status: props.project?.status ?? 'pending',
  description: props.project?.description ?? '',
})

const rules: FormRules = {
  projectPath: [{ required: true, message: '请选择项目目录', trigger: 'blur' }],
  name: [{ required: true, message: '请输入项目名称', trigger: 'blur' }],
  status: [{ required: true, message: '请选择项目状态', trigger: 'change' }],
}

const formRef = ref<FormInstance>()
const submitting = ref(false)
const showPicker = ref(false)
const pickerPath = ref('')

// 从目录路径提取名称，自动填充项目名称
function onPathChange(val: string) {
  if (val && !form.name) {
    const basename = val.split(/[\\/]/).pop()
    if (basename) {
      form.name = basename
    }
  }
}

// 初始化：如果有目录但没有名称，自动填充
watch(
  () => props.project,
  (p) => {
    if (p?.rootPath && !p.name) {
      const basename = p.rootPath.split(/[\\/]/).pop()
      if (basename) form.name = basename
    }
  },
  { immediate: true }
)

function pickDirectory() {
  pickerPath.value = form.projectPath
  showPicker.value = true
}

function confirmPick() {
  const path = pickerPath.value.trim()
  if (path) {
    form.projectPath = path
    onPathChange(path)
  }
  showPicker.value = false
}

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  submitting.value = true
  try {
    emit('submit', {
      name: form.name,
      description: form.description || undefined,
      projectPath: form.projectPath || undefined,
      status: form.status,
    })
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.directory-picker {
  display: flex;
  gap: 8px;
  width: 100%;
}

.directory-picker .el-input {
  flex: 1;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* 目录选择弹窗深色磨砂玻璃样式 */
:deep(.picker-dialog.el-dialog) {
  background: rgba(30, 30, 45, 0.85);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
}

:deep(.picker-dialog .el-dialog__header) {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  margin-right: 0;
}

:deep(.picker-dialog .el-dialog__title) {
  color: #e0e0e0;
}

:deep(.picker-dialog .el-dialog__body) {
  padding-top: 16px;
}

:deep(.picker-dialog .el-dialog__footer) {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

:deep(.picker-dialog .el-overlay-dialog) {
  background: rgba(0, 0, 0, 0.5);
}
</style>

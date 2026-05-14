<template>
  <el-form ref="formRef" :model="form" :rules="rules" label-width="80px" label-position="top">
    <el-form-item label="项目名称" prop="name">
      <el-input v-model="form.name" placeholder="输入项目名称" maxlength="64" show-word-limit />
    </el-form-item>

    <el-form-item label="描述">
      <el-input
        v-model="form.description"
        type="textarea"
        :rows="3"
        placeholder="项目描述（可选）"
        maxlength="500"
      />
    </el-form-item>

    <el-form-item label="根目录">
      <div class="directory-picker">
        <el-input v-model="form.rootPath" placeholder="项目主根目录，如 D:\AI（可选）">
          <template #prefix>
            <el-icon><Folder /></el-icon>
          </template>
        </el-input>
        <el-button @click="openDirectoryPicker">选择目录</el-button>
      </div>
    </el-form-item>

    <el-form-item label="子路径">
      <el-input v-model="form.subPath" placeholder="子路径（可选，相对根目录的相对路径）" />
    </el-form-item>

    <el-form-item label="标签">
      <el-select v-model="form.tags" multiple filterable allow-create default-first-option placeholder="输入标签" style="width: 100%">
        <el-option v-for="tag in defaultTags" :key="tag" :label="tag" :value="tag" />
      </el-select>
    </el-form-item>

    <el-form-item label="进度" v-if="isEdit">
      <div class="progress-editor">
        <el-slider v-model="form.progress" :min="0" :max="100" :step="5" />
        <el-input-number v-model="form.progress" :min="0" :max="100" :step="5" size="small" controls-position="right" />
        <el-checkbox v-model="form.manualOverride">手动覆盖</el-checkbox>
      </div>
    </el-form-item>

    <el-form-item>
      <div class="form-actions">
        <el-button type="primary" @click="handleSubmit" :loading="submitting">
          {{ isEdit ? '保存' : '创建' }}
        </el-button>
        <el-button @click="$emit('cancel')">取消</el-button>
      </div>
    </el-form-item>
  </el-form>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { Folder } from '@element-plus/icons-vue'
import type { Project } from '../types'
import type { FormInstance, FormRules } from 'element-plus'

const props = defineProps<{
  project?: Project | null
}>()

const emit = defineEmits<{
  submit: [data: { name: string; description?: string; rootPath?: string; subPath?: string; tags?: string[]; progress?: number; manualOverride?: boolean }]
  cancel: []
}>()

const isEdit = computed(() => !!props.project)

const defaultTags = ['frontend', 'backend', 'devops', 'monitoring', 'AI', 'infra']

const form = reactive({
  name: props.project?.name ?? '',
  description: props.project?.description ?? '',
  rootPath: props.project?.rootPath ?? '',
  subPath: props.project?.subPath ?? '',
  tags: props.project?.tags ?? [] as string[],
  progress: props.project?.progress ?? 0,
  manualOverride: props.project?.manualOverride ?? false,
})

const rules: FormRules = {
  name: [{ required: true, message: '请输入项目名称', trigger: 'blur' }],
}

const formRef = ref<FormInstance>()
const submitting = ref(false)

function openDirectoryPicker() {
  const path = prompt('请输入根目录路径：', form.rootPath)
  if (path !== null) {
    form.rootPath = path.trim()
  }
}

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  submitting.value = true
  try {
    const data = {
      name: form.name,
      description: form.description || undefined,
      rootPath: form.rootPath || undefined,
      subPath: form.subPath || undefined,
      tags: form.tags.length ? form.tags : undefined,
    }

    if (isEdit.value) {
      ;(data as Record<string, unknown>).progress = form.progress
      ;(data as Record<string, unknown>).manualOverride = form.manualOverride
    }

    emit('submit', data)
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

.progress-editor {
  display: flex;
  align-items: center;
  gap: 16px;
}

.progress-editor .el-slider {
  flex: 1;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>

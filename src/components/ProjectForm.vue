<template>
  <el-form ref="formRef" :model="form" :rules="rules" label-width="80px" label-position="top">
    <!-- 项目目录（必填，手动输入完整路径） -->
    <el-form-item label="项目目录" prop="projectPath">
      <el-input
        v-model="form.projectPath"
        placeholder="输入项目目录完整路径，如 D:\AI\my-project"
        @input="onPathChange"
      >
        <template #prefix>
          <el-icon><Folder /></el-icon>
        </template>
      </el-input>
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
  projectPath: [{ required: true, message: '请输入项目目录', trigger: 'blur' }],
  name: [{ required: true, message: '请输入项目名称', trigger: 'blur' }],
  status: [{ required: true, message: '请选择项目状态', trigger: 'change' }],
}

const formRef = ref<FormInstance>()
const submitting = ref(false)

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
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>

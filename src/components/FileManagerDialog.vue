<template>
  <el-dialog
    v-model="visible"
    title="📁 文件管理"
    width="1100px"
    :close-on-click-modal="true"
    class="fm-dialog"
  >
    <div class="fm-body">
      <!-- 左侧：分组文件树 -->
      <div class="fm-tree">
        <el-input
          v-model="search"
          placeholder="搜索文件名 / 中文译名 / 说明"
          size="small"
          :prefix-icon="Search"
          clearable
        />

        <div v-if="loading" class="fm-empty">
          <el-icon class="is-loading"><Loading /></el-icon> 加载中…
        </div>

        <template v-else>
          <div v-for="cat in filteredCategories" :key="cat.name" class="fm-cat">
            <div
              class="fm-cat-header fm-collapsible"
              @click="toggleCat(cat.name)"
            >
              <el-icon class="fm-chevron" :class="{ collapsed: isCatCollapsed(cat.name) }"><ArrowDown /></el-icon>
              <span class="fm-cat-name">{{ cat.name }}</span>
              <span class="fm-cat-count">{{ cat.groups.reduce((s, g) => s + g.items.length, 0) }}</span>
            </div>
            <div v-show="!isCatCollapsed(cat.name)" class="fm-cat-body">
              <div class="fm-cat-desc">{{ cat.rootDesc }}</div>

              <div v-for="grp in cat.groups" :key="grp.name" class="fm-group">
                <div
                  class="fm-group-name fm-collapsible"
                  @click="toggleGroup(cat.name + '::' + grp.name)"
                >
                  <el-icon class="fm-chevron sm" :class="{ collapsed: isGroupCollapsed(cat.name + '::' + grp.name) }"><ArrowDown /></el-icon>
                  <span>{{ grp.name }}</span>
                  <span class="fm-group-count">{{ grp.items.length }}</span>
                </div>
                <div v-show="!isGroupCollapsed(cat.name + '::' + grp.name)">
                  <div
                    v-for="item in grp.items"
                    :key="item.path"
                    class="fm-item"
                    :class="{
                      active: selectedPath === item.path,
                      missing: !item.exists,
                      sensitive: item.sensitive,
                      binary: item.binary,
                      dir: item.isDir,
                    }"
                    @click="selectFile(item)"
                  >
                    <span class="fm-item-icon">{{ getIcon(item) }}</span>
                    <div class="fm-item-info">
                      <div class="fm-item-cn">{{ item.cn }}</div>
                      <div class="fm-item-path">{{ shortPath(item.path) }}</div>
                    </div>
                    <span class="fm-item-meta">
                      <span v-if="item.isDir" class="fm-tag dir">目录 {{ item.entries ?? '?' }}</span>
                      <span v-else-if="!item.exists" class="fm-tag missing">缺失</span>
                      <span v-else class="fm-tag size">{{ formatSize(item.size) }}</span>
                    </span>
                    <!-- 快捷打开按钮 -->
                    <div class="fm-item-actions" v-if="item.exists" @click.stop>
                      <el-tooltip content="在 Finder 中显示" placement="top">
                        <el-button
                          link
                          size="small"
                          @click.stop="revealInFinder(item)"
                          class="fm-icon-btn"
                        >
                          <el-icon><FolderOpened /></el-icon>
                        </el-button>
                      </el-tooltip>
                      <el-tooltip :content="item.isDir ? '在 Finder 打开此目录' : '用默认应用打开'" placement="top">
                        <el-button
                          link
                          size="small"
                          @click.stop="openWithDefault(item)"
                          class="fm-icon-btn"
                        >
                          <el-icon><Position /></el-icon>
                        </el-button>
                      </el-tooltip>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="filteredCategories.length === 0" class="fm-empty">
            <el-icon><DocumentRemove /></el-icon>
            没找到匹配「{{ search }}」的文件
          </div>
        </template>
      </div>

      <!-- 右侧：内容预览 -->
      <div class="fm-preview">
        <div v-if="!selected" class="fm-preview-empty">
          <el-icon :size="48"><Document /></el-icon>
          <div>点击左侧任一文件查看详情</div>
        </div>

        <template v-else>
          <!-- 文件元信息 -->
          <div class="fm-meta-card">
            <div class="fm-meta-title">
              <span>{{ getIcon(selected) }} {{ selected.cn }}</span>
              <span v-if="selected.sensitive" class="fm-badge danger">敏感</span>
              <span v-if="selected.binary" class="fm-badge warning">二进制</span>
              <span v-if="selected.isDir" class="fm-badge info">目录</span>
              <div class="fm-meta-actions" v-if="selected.exists">
                <el-button
                  size="small"
                  :icon="FolderOpened"
                  @click="revealInFinder(selected)"
                >在 Finder 中显示</el-button>
                <el-button
                  size="small"
                  type="primary"
                  :icon="Position"
                  @click="openWithDefault(selected)"
                >{{ selected.isDir ? '打开目录' : '用默认应用打开' }}</el-button>
                <el-button
                  v-if="isEditable"
                  size="small"
                  type="warning"
                  :icon="Edit"
                  @click="startEditing"
                >✏️ 编辑</el-button>
              </div>
            </div>
            <div class="fm-meta-grid">
              <div class="fm-meta-row">
                <span class="fm-meta-label">说明</span>
                <span class="fm-meta-val">{{ selected.desc }}</span>
              </div>
              <div class="fm-meta-row">
                <span class="fm-meta-label">谁在用</span>
                <span class="fm-meta-val">
                  <el-tag
                    v-for="u in selected.usedBy"
                    :key="u"
                    size="small"
                    class="fm-user-tag"
                  >{{ u }}</el-tag>
                </span>
              </div>
              <div class="fm-meta-row">
                <span class="fm-meta-label">路径</span>
                <span class="fm-meta-val mono">{{ selected.path }}</span>
              </div>
              <div class="fm-meta-row" v-if="selected.exists && !selected.isDir">
                <span class="fm-meta-label">大小</span>
                <span class="fm-meta-val">{{ formatSize(selected.size) }}</span>
              </div>
              <div class="fm-meta-row" v-if="selected.exists && selected.mtime">
                <span class="fm-meta-label">修改时间</span>
                <span class="fm-meta-val">{{ formatTime(selected.mtime) }}</span>
              </div>
              <div class="fm-meta-row" v-if="selected.isDir">
                <span class="fm-meta-label">子项数</span>
                <span class="fm-meta-val">{{ selected.entries }}</span>
              </div>
            </div>
          </div>

          <!-- 内容预览 / 编辑器 -->
          <div class="fm-content-card">
            <!-- 编辑模式 header -->
            <div v-if="editing" class="fm-content-header fm-editor-header">
              <span><el-icon><Edit /></el-icon> 编辑模式</span>
              <div class="fm-editor-actions">
                <el-tag v-if="editDirty" size="small" type="warning" effect="dark">未保存</el-tag>
                <el-button size="small" @click="cancelEditing">取消</el-button>
                <el-button
                  size="small"
                  type="primary"
                  :loading="saving"
                  @click="saveFile"
                >💾 保存</el-button>
              </div>
            </div>
            <div v-else class="fm-content-header">
              <el-icon><Document /></el-icon>
              内容预览
            </div>

            <!-- 编辑器区域 -->
            <div v-if="editing" class="fm-editor-wrap">
              <div class="fm-editor-line-nums" ref="lineNumsRef">
                <div
                  v-for="n in editorLineCount"
                  :key="n"
                  class="fm-line-num"
                >{{ n }}</div>
              </div>
              <textarea
                ref="editorRef"
                v-model="editContent"
                class="fm-editor-textarea"
                spellcheck="false"
                @scroll="syncLineNums"
                @input="onEditorInput"
              />
            </div>

            <!-- 预览模式 -->
            <template v-else>
              <div v-if="loadingContent" class="fm-content-loading">
                <el-icon class="is-loading"><Loading /></el-icon> 读取中…
              </div>

              <template v-else-if="content">
                <div v-if="content.type === 'binary'" class="fm-content-notice">
                  <el-icon><Warning /></el-icon> {{ content.message }}
                </div>
                <div v-else-if="content.type === 'too_large'" class="fm-content-notice">
                  <el-icon><Warning /></el-icon> {{ content.message }}
                </div>
                <div v-else-if="content.type === 'error'" class="fm-content-notice error">
                  <el-icon><WarningFilled /></el-icon> 读取失败：{{ content.error }}
                </div>
                <div v-else-if="content.type === 'dir'" class="fm-content-dir">
                  <div class="fm-dir-summary">共 {{ content.totalCount }} 项{{ content.totalCount > 50 ? '（显示前 50）' : '' }}：</div>
                  <div class="fm-dir-list">
                    <span v-for="entry in content.entries" :key="entry" class="fm-dir-entry">{{ entry }}</span>
                  </div>
                </div>
                <div v-else-if="content.type === 'text'">
                  <div
                    v-if="isMarkdown"
                    class="fm-md markdown-body"
                    v-html="renderedMarkdown"
                  />
                  <pre v-else-if="isJson" class="fm-code fm-json">{{ prettifiedJson }}</pre>
                  <pre v-else class="fm-code">{{ content.content }}</pre>
                </div>
              </template>

              <div v-else class="fm-content-notice">
                <el-icon><DocumentRemove /></el-icon> 文件不存在或无法读取
              </div>
            </template>
          </div>
        </template>
      </div>
    </div>

    <!-- 保存后 reset 提示 -->
    <el-dialog
      v-model="resetHintVisible"
      title="💡 建议重载 Agent 配置"
      width="420px"
      append-to-body
      :close-on-click-modal="true"
    >
      <div class="fm-reset-hint">
        <p>你编辑了 <strong>IDENTITY.md</strong>，新配置需要 Agent 重新加载才能生效。</p>
        <p class="fm-reset-cmd">openclaw agent --reset <strong>{{ resetAgentId }}</strong></p>
        <p class="fm-reset-sub">或在 Agent 抽屉中点击「重启」按钮。</p>
      </div>
      <template #footer>
        <el-button type="primary" @click="resetHintVisible = false">知道了</el-button>
      </template>
    </el-dialog>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import {
  Search, Document, DocumentRemove, Loading, Warning, WarningFilled,
  ArrowDown, FolderOpened, Position, Edit,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const visible = defineModel<boolean>('visible', { default: false })

interface FileItem {
  path: string
  cn: string
  desc: string
  usedBy: string[]
  exists?: boolean
  size?: number
  entries?: number
  mtime?: number
  isDir?: boolean
  binary?: boolean
  sensitive?: boolean
}
interface Group { name: string; items: FileItem[] }
interface Category { name: string; rootDesc: string; groups: Group[] }

const loading = ref(false)
const categories = ref<Category[]>([])
const search = ref('')
const selected = ref<FileItem | null>(null)
const selectedPath = computed(() => selected.value?.path || '')
const content = ref<any>(null)
const loadingContent = ref(false)

// ── 编辑器状态 ──
const editing = ref(false)
const editContent = ref('')
const editDirty = ref(false)
const saving = ref(false)
const editorRef = ref<HTMLTextAreaElement | null>(null)
const lineNumsRef = ref<HTMLElement | null>(null)
const resetHintVisible = ref(false)
const resetAgentId = ref('')

const EDITABLE_EXTS = ['.md', '.json', '.py', '.txt', '.yaml', '.yml', '.sh', '.js', '.ts']
const isEditable = computed(() => {
  if (!selected.value || !content.value || content.value.type !== 'text') return false
  if (selected.value.sensitive || selected.value.isDir) return false
  const ext = selected.value.path.toLowerCase().split('.').pop()
  return EDITABLE_EXTS.includes('.' + ext)
})

const editorLineCount = computed(() => {
  return editContent.value.split('\n').length
})

function startEditing() {
  editContent.value = content.value?.content || ''
  editDirty.value = false
  editing.value = true
  nextTick(() => {
    editorRef.value?.focus()
  })
}

function cancelEditing() {
  if (editDirty.value) {
    if (!confirm('放弃未保存的更改？')) return
  }
  editing.value = false
  editDirty.value = false
}

function onEditorInput() {
  editDirty.value = true
}

function syncLineNums() {
  if (editorRef.value && lineNumsRef.value) {
    lineNumsRef.value.scrollTop = editorRef.value.scrollTop
  }
}

async function saveFile() {
  if (!selected.value) return
  saving.value = true
  try {
    const resp = await fetch('/api/file-manager/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: selected.value.path, content: editContent.value }),
    })
    const data = await resp.json()
    if (!data.ok) throw new Error(data.error || '保存失败')

    ElMessage.success(`保存成功${data.backupPath ? '（已备份）' : ''}`)
    // 同步本地 content
    content.value = { ...content.value, content: editContent.value }
    editDirty.value = false
    editing.value = false

    // IDENTITY.md 提示 reset
    if (data.resetHint) {
      resetAgentId.value = data.resetHint
      resetHintVisible.value = true
    }
  } catch (e: any) {
    ElMessage.error('保存失败：' + e.message)
  } finally {
    saving.value = false
  }
}

// 切换文件时退出编辑
watch(selected, () => {
  editing.value = false
  editDirty.value = false
})

watch(visible, (val) => {
  if (val) loadTree()
  else { selected.value = null; content.value = null }
})

async function loadTree() {
  loading.value = true
  try {
    const resp = await fetch('/api/file-manager/tree')
    const data = await resp.json()
    categories.value = data.categories || []
  } catch (e) {
    console.error('[FileManager] loadTree:', e)
  } finally {
    loading.value = false
  }
}

// ── 折叠状态：默认全部展开 ──
const collapsedCats = ref<Set<string>>(new Set())
const collapsedGroups = ref<Set<string>>(new Set())

function toggleCat(name: string) {
  const s = new Set(collapsedCats.value)
  s.has(name) ? s.delete(name) : s.add(name)
  collapsedCats.value = s
}
function toggleGroup(key: string) {
  const s = new Set(collapsedGroups.value)
  s.has(key) ? s.delete(key) : s.add(key)
  collapsedGroups.value = s
}
function isCatCollapsed(name: string): boolean {
  return collapsedCats.value.has(name)
}
function isGroupCollapsed(key: string): boolean {
  return collapsedGroups.value.has(key)
}

// ── 打开文件/文件夹 ──
async function callReveal(path: string, mode: 'open' | 'reveal') {
  try {
    const resp = await fetch('/api/file-manager/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, mode }),
    })
    const data = await resp.json()
    if (!data.success) {
      ElMessage.error('打开失败：' + (data.error || '未知错误'))
    }
  } catch (e: any) {
    ElMessage.error('打开失败：' + e.message)
  }
}

function revealInFinder(item: FileItem) {
  if (!item.exists) {
    ElMessage.warning('文件不存在')
    return
  }
  callReveal(item.path, 'reveal')
}

function openWithDefault(item: FileItem) {
  if (!item.exists) {
    ElMessage.warning('文件不存在')
    return
  }
  callReveal(item.path, 'open')
}

async function selectFile(item: FileItem) {
  selected.value = item
  content.value = null
  if (!item.exists) return
  if (item.sensitive) {
    content.value = { type: 'binary', message: '敏感文件，已跳过预览（避免泄露凭证）' }
    return
  }
  loadingContent.value = true
  try {
    const resp = await fetch('/api/file-manager/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: item.path }),
    })
    content.value = await resp.json()
  } catch (e: any) {
    content.value = { type: 'error', error: e.message }
  } finally {
    loadingContent.value = false
  }
}

const filteredCategories = computed<Category[]>(() => {
  if (!search.value.trim()) return categories.value
  const q = search.value.toLowerCase()
  return categories.value
    .map(cat => ({
      ...cat,
      groups: cat.groups
        .map(g => ({
          ...g,
          items: g.items.filter(it =>
            it.path.toLowerCase().includes(q) ||
            it.cn.toLowerCase().includes(q) ||
            it.desc.toLowerCase().includes(q)
          ),
        }))
        .filter(g => g.items.length > 0),
    }))
    .filter(cat => cat.groups.length > 0)
})

function getIcon(item: FileItem): string {
  if (!item.exists) return '❓'
  if (item.isDir) return '📂'
  if (item.binary) return '💾'
  if (item.sensitive) return '🔐'
  const ext = item.path.split('.').pop()?.toLowerCase()
  if (ext === 'md') return '📝'
  if (ext === 'json') return '⚙️'
  if (ext === 'py') return '🐍'
  if (ext === 'sh') return '🐚'
  if (ext === 'log') return '📜'
  return '📄'
}

function shortPath(p: string): string {
  return p.replace(/^~\//, '~/').replace(/^\/Users\/[^/]+\//, '~/')
}

function formatSize(bytes?: number): string {
  if (!bytes && bytes !== 0) return '-'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── 内容渲染 ──
const isMarkdown = computed(() => {
  if (!selected.value || content.value?.type !== 'text') return false
  return selected.value.path.toLowerCase().endsWith('.md')
})
const isJson = computed(() => {
  if (!selected.value || content.value?.type !== 'text') return false
  return selected.value.path.toLowerCase().endsWith('.json')
})
const renderedMarkdown = computed<string>(() => {
  if (!content.value?.content) return ''
  try {
    const html = marked.parse(content.value.content, { async: false }) as string
    return DOMPurify.sanitize(html)
  } catch {
    return content.value.content
  }
})
const prettifiedJson = computed<string>(() => {
  if (!content.value?.content) return ''
  try {
    return JSON.stringify(JSON.parse(content.value.content), null, 2)
  } catch {
    return content.value.content
  }
})
</script>

<style scoped>
.fm-body {
  display: flex;
  gap: 14px;
  height: 70vh;
}

/* ── 左侧文件树 ── */
.fm-tree {
  width: 380px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  padding-right: 4px;
}
.fm-tree::-webkit-scrollbar { width: 4px; }
.fm-tree::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }

.fm-cat { margin-bottom: 10px; }
.fm-cat-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px 4px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  margin-bottom: 6px;
}
.fm-collapsible {
  cursor: pointer;
  user-select: none;
  border-radius: 4px;
  transition: background 0.15s;
}
.fm-collapsible:hover { background: rgba(255,255,255,0.04); }
.fm-chevron {
  font-size: 14px;
  color: var(--text-secondary);
  transition: transform 0.2s;
  flex-shrink: 0;
}
.fm-chevron.sm { font-size: 11px; }
.fm-chevron.collapsed { transform: rotate(-90deg); }
.fm-cat-name { font-size: 14px; font-weight: 700; color: var(--text-primary); flex: 1; }
.fm-cat-count {
  font-size: 10px;
  color: var(--text-secondary);
  background: rgba(255,255,255,0.07);
  border-radius: 8px;
  padding: 1px 8px;
}
.fm-cat-body { padding-left: 4px; }
.fm-cat-desc { font-size: 11px; color: var(--text-secondary); margin-bottom: 8px; padding: 0 4px; }

.fm-group-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: #60a5fa;
  margin: 8px 4px 4px;
  padding: 3px 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.fm-group-count {
  font-size: 10px;
  color: var(--text-secondary);
  background: rgba(96,165,250,0.1);
  border-radius: 6px;
  padding: 0 6px;
  margin-left: auto;
  text-transform: none;
}
.fm-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
  margin-bottom: 2px;
}
.fm-item:hover { background: rgba(255,255,255,0.04); }
.fm-item.active {
  background: rgba(66,165,245,0.15);
  border: 1px solid rgba(66,165,245,0.3);
  padding: 5px 7px;
}
.fm-item.missing { opacity: 0.4; }
.fm-item-icon { font-size: 16px; flex-shrink: 0; }
.fm-item-info { flex: 1; min-width: 0; }
.fm-item-cn { font-size: 13px; font-weight: 500; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fm-item-path { font-size: 10px; color: var(--text-secondary); font-family: 'Cascadia Code', monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fm-item-meta { flex-shrink: 0; }

.fm-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: rgba(255,255,255,0.06);
  color: var(--text-secondary);
}
.fm-tag.dir { background: rgba(96,165,250,0.15); color: #93c5fd; }
.fm-tag.missing { background: rgba(244,67,54,0.15); color: #f87171; }

/* 列表项快捷打开按钮（hover 才显示） */
.fm-item-actions {
  display: none;
  gap: 2px;
  flex-shrink: 0;
}
.fm-item:hover .fm-item-actions {
  display: flex;
}
.fm-item.active .fm-item-actions {
  display: flex;
}
.fm-icon-btn {
  padding: 2px !important;
  height: auto !important;
}
.fm-icon-btn :deep(.el-icon) {
  font-size: 14px;
  color: var(--text-secondary);
}
.fm-icon-btn:hover :deep(.el-icon) {
  color: #60a5fa;
}

.fm-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 0;
  color: var(--text-secondary);
  font-size: 13px;
}

/* ── 右侧预览 ── */
.fm-preview {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
}
.fm-preview::-webkit-scrollbar { width: 4px; }
.fm-preview::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }

.fm-preview-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100%;
  color: var(--text-secondary);
  font-size: 14px;
}

.fm-meta-card,
.fm-content-card {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  padding: 14px;
}
.fm-meta-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.fm-meta-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
}
.fm-badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
}
.fm-badge.danger { background: rgba(244,67,54,0.2); color: #f87171; }
.fm-badge.warning { background: rgba(245,158,11,0.2); color: #fbbf24; }
.fm-badge.info { background: rgba(96,165,250,0.2); color: #93c5fd; }

.fm-meta-grid { display: flex; flex-direction: column; gap: 6px; }
.fm-meta-row { display: flex; gap: 10px; font-size: 12px; }
.fm-meta-label { width: 70px; flex-shrink: 0; color: var(--text-secondary); font-weight: 600; }
.fm-meta-val { flex: 1; color: var(--text-primary); word-break: break-all; }
.fm-meta-val.mono { font-family: 'Cascadia Code', monospace; font-size: 11px; }
.fm-user-tag { margin-right: 4px !important; }

.fm-content-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.fm-content-loading,
.fm-content-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  color: var(--text-secondary);
  font-size: 13px;
  background: rgba(255,255,255,0.02);
  border-radius: 6px;
}
.fm-content-notice.error { color: #f87171; }

.fm-code,
.fm-json {
  margin: 0;
  padding: 12px;
  background: rgba(0,0,0,0.3);
  border-radius: 6px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 12px;
  line-height: 1.6;
  color: #d4d4d4;
  max-height: 50vh;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.fm-json { color: #a5d6a7; }

.fm-md {
  padding: 12px 16px;
  background: rgba(0,0,0,0.15);
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-primary);
  max-height: 50vh;
  overflow-y: auto;
}
.fm-md :deep(h1) { font-size: 18px; margin: 12px 0 8px; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.1); }
.fm-md :deep(h2) { font-size: 16px; margin: 10px 0 6px; }
.fm-md :deep(h3) { font-size: 14px; margin: 8px 0 4px; }
.fm-md :deep(code) { background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 3px; font-size: 12px; }
.fm-md :deep(pre) { background: rgba(0,0,0,0.3); padding: 10px; border-radius: 4px; overflow-x: auto; }
.fm-md :deep(pre code) { background: transparent; padding: 0; }
.fm-md :deep(ul), .fm-md :deep(ol) { padding-left: 24px; }
.fm-md :deep(blockquote) { border-left: 3px solid #60a5fa; padding-left: 10px; color: var(--text-secondary); margin: 6px 0; }
.fm-md :deep(a) { color: #60a5fa; }
.fm-md :deep(table) { border-collapse: collapse; margin: 8px 0; }
.fm-md :deep(td), .fm-md :deep(th) { border: 1px solid rgba(255,255,255,0.1); padding: 4px 8px; }

.fm-content-dir { padding: 8px; }
.fm-dir-summary { font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; }
.fm-dir-list { display: flex; flex-wrap: wrap; gap: 6px; }
.fm-dir-entry {
  font-family: 'Cascadia Code', monospace;
  font-size: 11px;
  padding: 3px 8px;
  background: rgba(255,255,255,0.04);
  border-radius: 4px;
  color: var(--text-primary);
}

/* ── 编辑器 ── */
.fm-editor-header {
  justify-content: space-between;
  border-color: rgba(245,158,11,0.3) !important;
  color: #fbbf24 !important;
}
.fm-editor-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.fm-editor-wrap {
  display: flex;
  gap: 0;
  background: rgba(0,0,0,0.35);
  border-radius: 6px;
  overflow: hidden;
  height: 52vh;
  border: 1px solid rgba(255,255,255,0.08);
}
.fm-editor-line-nums {
  width: 42px;
  flex-shrink: 0;
  overflow: hidden;
  background: rgba(0,0,0,0.25);
  border-right: 1px solid rgba(255,255,255,0.06);
  padding: 12px 0;
  user-select: none;
}
.fm-line-num {
  height: 22px;
  line-height: 22px;
  text-align: right;
  padding-right: 8px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 11px;
  color: rgba(255,255,255,0.2);
}
.fm-editor-textarea {
  flex: 1;
  resize: none;
  background: transparent;
  border: none;
  outline: none;
  padding: 12px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 12px;
  line-height: 22px;
  color: #e2e8f0;
  caret-color: #38bdf8;
  tab-size: 2;
  white-space: pre;
  overflow-wrap: normal;
  overflow: auto;
}
.fm-editor-textarea::selection {
  background: rgba(56,189,248,0.25);
}

/* reset 提示 */
.fm-reset-hint { font-size: 13px; color: var(--text-primary); line-height: 1.7; }
.fm-reset-cmd {
  margin: 10px 0;
  padding: 8px 14px;
  background: rgba(0,0,0,0.3);
  border-radius: 6px;
  font-family: 'Cascadia Code', monospace;
  font-size: 12px;
  color: #93c5fd;
  border-left: 3px solid #3b82f6;
}
.fm-reset-sub { font-size: 12px; color: var(--text-secondary); }
</style>

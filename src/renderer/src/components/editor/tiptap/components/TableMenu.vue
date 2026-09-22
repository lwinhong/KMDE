<template>
  <ToolbarDropdown align-right>
    <template #trigger="{ toggle }">
      <ToolbarButton :is-active="editor?.isActive('table')" :title="$t('editor.table')" @click="toggle">
        <TableIcon :size="18" />
      </ToolbarButton>
    </template>
    <template #default="{ close }">
      <template v-if="!editor?.isActive('table')">
        <div class="table-grid-picker" @mouseleave="hoverRow = 0; hoverCol = 0">
          <div class="table-grid-label">
            {{ hoverRow && hoverCol ? `${hoverCol} × ${hoverRow}` : $t('editor.pickTableSize') }}
          </div>
          <div class="table-grid">
            <div
              v-for="row in gridRows"
              :key="row"
              class="table-grid-row"
            >
              <div
                v-for="col in gridCols"
                :key="col"
                class="table-grid-cell"
                :class="{ 'is-highlighted': col <= hoverCol && row <= hoverRow }"
                @mouseenter="hoverCol = col; hoverRow = row"
                @click="doInsertTable(close, hoverRow, hoverCol)"
              />
            </div>
          </div>
        </div>
      </template>
      <template v-else>
        <button class="dropdown-item" @click="cmd(() => editor.chain().focus().addColumnBefore().run(), close)">
          <AddColumnBeforeIcon :size="16" />
          <span>{{ $t('editor.addColBefore') }}</span>
        </button>
        <button class="dropdown-item" @click="cmd(() => editor.chain().focus().addColumnAfter().run(), close)">
          <AddColumnAfterIcon :size="16" />
          <span>{{ $t('editor.addColAfter') }}</span>
        </button>
        <button class="dropdown-item" @click="cmd(() => editor.chain().focus().addRowBefore().run(), close)">
          <AddRowBeforeIcon :size="16" />
          <span>{{ $t('editor.addRowAbove') }}</span>
        </button>
        <button class="dropdown-item" @click="cmd(() => editor.chain().focus().addRowAfter().run(), close)">
          <AddRowAfterIcon :size="16" />
          <span>{{ $t('editor.addRowBelow') }}</span>
        </button>
        <div class="dropdown-divider" />
        <button class="dropdown-item" :disabled="!editor.can().deleteColumn()"
          @click="cmd(() => editor.chain().focus().deleteColumn().run(), close)">
          <DeleteColumnIcon :size="16" />
          <span>{{ $t('editor.deleteColumn') }}</span>
        </button>
        <button class="dropdown-item" :disabled="!editor.can().deleteRow()"
          @click="cmd(() => editor.chain().focus().deleteRow().run(), close)">
          <DeleteRowIcon :size="16" />
          <span>{{ $t('editor.deleteRow') }}</span>
        </button>
        <div class="dropdown-divider" />
        <!-- <button class="dropdown-item" @click="cmd(() => editor.chain().focus().toggleHeaderRow().run(), close)">
          <ToggleHeaderRowIcon :size="16" />
          <span>切换表头行</span>
        </button> -->
        <button class="dropdown-item danger" @click="cmd(() => editor.chain().focus().deleteTable().run(), close)">
          <DeleteTableIcon :size="16" />
          <span>{{ $t('editor.deleteTable') }}</span>
        </button>
      </template>
    </template>
  </ToolbarDropdown>
</template>

<script setup>
import { ref } from 'vue'
import { ToolbarButton, ToolbarDropdown } from './primitives'
import {
  TableIcon,
  AddColumnBeforeIcon,
  AddColumnAfterIcon,
  AddRowBeforeIcon,
  AddRowAfterIcon,
  DeleteColumnIcon,
  DeleteRowIcon,
  // ToggleHeaderRowIcon,
  DeleteTableIcon,
} from '../icons'

const props = defineProps({ editor: Object })

const gridRows = 6
const gridCols = 8
const hoverRow = ref(0)
const hoverCol = ref(0)

const cmd = (fn, close) => {
  fn()
  close()
}

const doInsertTable = (close, rows, cols) => {
  props.editor?.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()
  close()
}
</script>

<style scoped>
.table-grid-picker {
  padding: 8px;
}

.table-grid-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  text-align: center;
  margin-bottom: 6px;
  min-height: 18px;
}

.table-grid {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.table-grid-row {
  display: flex;
  gap: 2px;
}

.table-grid-cell {
  width: 14px;
  height: 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 2px;
  background: var(--el-fill-color-lighter);
  cursor: pointer;
  transition: all 0.1s;
}

.table-grid-cell.is-highlighted {
  background: var(--el-color-primary);
  border-color: var(--el-color-primary);
}
</style>

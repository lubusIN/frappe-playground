<template>
  <Dialog
    :open="modelValue"
    size="xl"
    :title="dialogTitle"
    :message="dialogMessage"
    @update:open="$emit('update:modelValue', $event)"
  >
    <template #actions>
      <form
        v-if="renaming"
        class="w-full space-y-4 text-left"
        @submit.prevent="confirmRename"
      >
        <TextInput
          v-model="renameValue"
          label="Playground name"
          maxlength="80"
          required
        />
        <div class="flex justify-end gap-2">
          <Button variant="subtle" type="button" @click="renaming = false">Cancel</Button>
          <Button variant="solid" type="submit" :disabled="!renameValue.trim()">Rename</Button>
        </div>
      </form>

      <div v-else-if="pendingAction" class="flex w-full justify-end gap-2">
        <Button variant="subtle" @click="pendingAction = ''">Cancel</Button>
        <Button theme="red" variant="solid" @click="confirmAction">
          {{ pendingAction === 'delete' ? 'Delete' : 'Reset' }}
        </Button>
      </div>

      <div v-else class="w-full space-y-4 text-left">
        <form class="flex items-end gap-2" @submit.prevent="createInstance">
          <TextInput
            v-model="newName"
            class="min-w-0 flex-1"
            label="New playground"
            placeholder="e.g. Accounting demo"
            maxlength="80"
            required
          />
          <Button variant="solid" type="submit" :disabled="!newName.trim()">
            Create
          </Button>
        </form>

        <ListView
          class="h-72"
          :columns="columns"
          :rows="instances"
          :options="listOptions"
          row-key="id"
        >
          <template #cell="{ item, row, column }">
            <div v-if="column.key === 'name'" class="min-w-0">
              <p class="truncate font-medium text-ink-gray-9">{{ item }}</p>
              <p class="truncate font-mono text-xs text-ink-gray-5">{{ row.id }}</p>
            </div>
            <Badge
              v-else-if="column.key === 'status'"
              :theme="row.id === activeInstanceId ? 'blue' : 'gray'"
              variant="subtle"
            >
              {{ row.id === activeInstanceId ? 'Active' : 'Saved' }}
            </Badge>
            <span v-else class="text-ink-gray-6">{{ formatDate(item) }}</span>
          </template>
        </ListView>

        <div class="flex items-center justify-between border-t border-outline-gray-1 pt-3">
          <p class="min-w-0 truncate text-sm text-ink-gray-6">
            {{ selectedInstance ? selectedInstance.name : 'Select a playground to manage it' }}
          </p>
          <div class="flex shrink-0 gap-2">
            <Button
              variant="subtle"
              :disabled="!selectedInstance || selectedInstance.id === activeInstanceId"
              @click="$emit('select', selectedInstance.id)"
            >
              Open
            </Button>
            <Button
              variant="subtle"
              :disabled="!selectedInstance"
              @click="startRename"
            >
              Rename
            </Button>
            <Button
              variant="subtle"
              :disabled="!selectedInstance"
              @click="askConfirmation('reset')"
            >
              Reset
            </Button>
            <Button
              theme="red"
              variant="subtle"
              :disabled="!selectedInstance"
              @click="askConfirmation('delete')"
            >
              Delete
            </Button>
          </div>
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import Badge from 'frappe-ui/components/Badge/Badge.vue'
import Button from 'frappe-ui/components/Button/Button.vue'
import Dialog from 'frappe-ui/components/Dialog/Dialog.vue'
import ListView from 'frappe-ui/components/ListView/ListView.vue'
import TextInput from 'frappe-ui/components/TextInput/TextInput.vue'

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  instances: { type: Array, default: () => [] },
  activeInstanceId: { type: String, default: '' },
})

const emit = defineEmits([
  'create',
  'delete',
  'rename',
  'reset',
  'select',
  'update:modelValue',
])
const newName = ref('')
const selectedId = ref('')
const pendingAction = ref('')
const renaming = ref(false)
const renameValue = ref('')

const columns = [
  { label: 'Playground', key: 'name', width: 3 },
  { label: 'Status', key: 'status', width: '100px' },
  { label: 'Last opened', key: 'lastOpenedAt', width: '150px' },
]

const listOptions = computed(() => ({
  selectable: false,
  enableActive: true,
  showTooltip: true,
  rowHeight: 56,
  onRowClick: row => { selectedId.value = row.id },
  emptyState: {
    title: 'No playgrounds',
    description: 'Create a playground to get started.',
  },
}))

const selectedInstance = computed(() => (
  props.instances.find(instance => instance.id === selectedId.value) || null
))

const confirmationMessage = computed(() => {
  if (!selectedInstance.value) return ''
  const action = pendingAction.value === 'delete' ? 'Delete' : 'Reset'
  return `${action} “${selectedInstance.value.name}”? All data in this playground will be permanently removed.`
})

const dialogTitle = computed(() => {
  if (renaming.value) return 'Rename playground'
  if (pendingAction.value) return pendingAction.value === 'delete'
    ? 'Delete playground?'
    : 'Reset playground?'
  return 'Playgrounds'
})

const dialogMessage = computed(() => {
  if (renaming.value) return 'Choose a name that helps you identify this playground.'
  if (pendingAction.value) return confirmationMessage.value
  return 'Create and manage isolated playgrounds stored in this browser.'
})

watch(() => props.modelValue, open => {
  if (open) selectedId.value = props.activeInstanceId
  else {
    renaming.value = false
    pendingAction.value = ''
  }
})

function createInstance() {
  const name = newName.value.trim()
  if (!name) return
  emit('create', name)
  newName.value = ''
}

function formatDate(timestamp) {
  return timestamp ? new Date(timestamp).toLocaleString([], { dateStyle: 'medium' }) : '—'
}

function askConfirmation(action) {
  if (selectedInstance.value) pendingAction.value = action
}

function startRename() {
  if (!selectedInstance.value) return
  renameValue.value = selectedInstance.value.name
  renaming.value = true
}

function confirmRename() {
  const name = renameValue.value.trim()
  if (!selectedInstance.value || !name) return
  emit('rename', { id: selectedInstance.value.id, name })
  renaming.value = false
}

function confirmAction() {
  if (!selectedInstance.value || !pendingAction.value) return
  emit(pendingAction.value, selectedInstance.value.id)
  pendingAction.value = ''
}
</script>

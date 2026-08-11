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
        v-if="creating"
        class="w-full space-y-4 text-left"
        @submit.prevent="createInstance"
      >
        <TextInput
          v-model="newName"
          label="Playground name"
          placeholder="e.g. Accounting demo"
          maxlength="80"
          required
        />
        <div class="flex justify-end gap-2">
          <Button variant="subtle" type="button" @click="creating = false">Cancel</Button>
          <Button variant="solid" type="submit" :disabled="!newName.trim()">Create</Button>
        </div>
      </form>

      <form
        v-else-if="renaming"
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

      <div v-else class="-mt-5 w-full space-y-3 text-left">
        <ListView
          class="h-64 w-full"
          :columns="columns"
          :rows="instances"
          :options="listOptions"
          row-key="id"
        >
          <template #cell="{ row, column }">
          <div v-if="column.key === 'info'" class="flex flex-col gap-0.5 overflow-hidden">
            <div class="flex items-center gap-2">
              <p class="truncate text-sm font-medium text-ink-gray-9">
                {{ row.name }}
              </p>
            </div>
            <span class="text-xs text-ink-gray-5">
              {{ row.lastOpenedAt ? `Last Accessed ${formatDate(row.lastOpenedAt)}` : 'Never opened' }}
            </span>
          </div>
          <div
            v-else-if="column.key === 'actions'"
            class="flex items-center justify-end gap-2"
            @click.stop
          >
            <Button
              v-if="row.id !== activeInstanceId"
              size="sm"
              variant="subtle"
              @click="$emit('select', row.id)"
            >
              Open
            </Button>
            <Badge
              v-if="row.id === activeInstanceId"
              theme="blue"
              variant="subtle"
              size="md"
            >
              Active
            </Badge>
            <Dropdown
              align="end"
              :button="{
                icon: 'lucide-ellipsis',
                variant: 'ghost',
                'aria-label': `Actions for ${row.name}`,
              }"
              :options="actionsFor(row)"
            />
          </div>
          </template>
        </ListView>

        <div class="flex items-center justify-between gap-3">
          <p class="text-sm text-ink-gray-6">
            {{ instances.length }} {{ instances.length === 1 ? 'playground' : 'playgrounds' }}
          </p>
          <Button variant="solid" @click="creating = true">New Playground</Button>
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
import Dropdown from 'frappe-ui/components/Dropdown/Dropdown.vue'
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
const creating = ref(false)
const renaming = ref(false)
const renameValue = ref('')

const columns = [
  { label: 'Saved Playground', key: 'info', width: 3 },
  { label: '', key: 'actions', width: '120px', align: 'right' },
]

const listOptions = computed(() => ({
  selectable: false,
  enableActive: false,
  showTooltip: true,
  rowHeight: 56,
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
  if (creating.value) return 'New playground'
  if (renaming.value) return 'Rename playground'
  if (pendingAction.value) return pendingAction.value === 'delete'
    ? 'Delete playground?'
    : 'Reset playground?'
  return 'Playgrounds'
})

const dialogMessage = computed(() => {
  if (creating.value) return 'Create a new isolated Frappe environment in this browser.'
  if (renaming.value) return 'Choose a name that helps you identify this playground.'
  if (pendingAction.value) return confirmationMessage.value
  return 'Create and manage isolated playgrounds stored in this browser.'
})

watch(() => props.modelValue, open => {
  if (open) selectedId.value = props.activeInstanceId
  else {
    creating.value = false
    renaming.value = false
    pendingAction.value = ''
  }
})

function createInstance() {
  const name = newName.value.trim()
  if (!name) return
  emit('create', name)
  newName.value = ''
  creating.value = false
}

function formatDate(timestamp) {
  return timestamp ? new Date(timestamp).toLocaleString([], { dateStyle: 'medium' }) : '—'
}

function askConfirmation(action) {
  if (selectedInstance.value) pendingAction.value = action
}

function actionsFor(instance) {
  return [
    {
      label: 'Rename',
      icon: 'lucide-pencil',
      onClick: () => {
        selectedId.value = instance.id
        startRename()
      },
    },
    {
      label: 'Reset',
      icon: 'lucide-rotate-ccw',
      onClick: () => {
        selectedId.value = instance.id
        askConfirmation('reset')
      },
    },
    {
      label: 'Delete',
      icon: 'lucide-trash-2',
      theme: 'red',
      onClick: () => {
        selectedId.value = instance.id
        askConfirmation('delete')
      },
    },
  ]
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

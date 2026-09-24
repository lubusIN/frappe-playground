<template>
  <Dialog
    :open="modelValue"
    size="lg"
    :title="dialogTitle"
    :message="dialogMessage"
    @update:open="!busy && $emit('update:modelValue', $event)"
  >
    <template #title>
      <div class="flex items-center gap-2">
        <h3 class="text-2xl-semibold leading-6 text-ink-gray-8">
          {{ dialogTitle }}
        </h3>
        <Badge
          v-if="!creating && !renaming && !pendingAction"
          theme="gray"
          size="sm"
        >
          {{ instances.length }}
        </Badge>
      </div>
    </template>
    <template #actions>
      <p v-if="error || busy" role="status" class="w-full text-sm text-ink-gray-7">{{ error || 'Removing playground data…' }}</p>
      <form
        v-if="creating && !busy"
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
          <Button variant="subtle" type="button" @click="handleCancelCreate">Cancel</Button>
          <Button variant="solid" type="submit" :disabled="!newName.trim()">Create</Button>
        </div>
      </form>

      <form
        v-else-if="renaming && !busy"
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

      <div v-else-if="pendingAction && !busy" class="flex w-full justify-end gap-2">
        <Button variant="subtle" @click="pendingAction = ''">Cancel</Button>
        <Button theme="red" variant="solid" @click="confirmAction">
          {{ pendingAction === 'delete' ? 'Delete' : 'Reset' }}
        </Button>
      </div>

      <div v-else-if="!busy" class="-mt-5 w-full space-y-3 text-left">
        <List class="h-64 overflow-y-auto" :columns="['minmax(0, 1fr)', '120px']" :row-height="56">
          <ListRow v-for="row in instances" :key="row.id" :value="row.id">
            <ListCell>
              <div class="flex flex-col gap-0.5 overflow-hidden text-left">
                <div class="flex items-center gap-2">
                  <p class="truncate text-sm font-medium text-ink-gray-9">
                    {{ row.name }}
                  </p>
                </div>
                <span class="text-xs text-ink-gray-5 text-left">
                  {{ row.lastOpenedAt ? `Last Accessed ${formatDate(row.lastOpenedAt)}` : 'Never opened' }}
                </span>
              </div>
            </ListCell>
            <ListCell class="justify-end">
              <div
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
            </ListCell>
          </ListRow>
        </List>
        <p v-if="!instances.length" class="text-sm text-ink-gray-5">No playgrounds. Create a playground to get started.</p>

        <div class="flex justify-end">
          <Button variant="solid" @click="creating = true">New Playground</Button>
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { Badge, Button, Dialog, Dropdown, TextInput } from 'frappe-ui'
import { computed, ref, watch } from 'vue'
import { List, ListRow, ListCell } from 'frappe-ui/list'

const props = defineProps({
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
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
const directCreate = ref(false)
const renaming = ref(false)
const renameValue = ref('')

defineExpose({
  startCreating: () => {
    creating.value = true
    directCreate.value = true
  }
})

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
    setTimeout(() => {
      creating.value = false
      directCreate.value = false
      renaming.value = false
      pendingAction.value = ''
    }, 300)
  }
})

function handleCancelCreate() {
  if (directCreate.value) {
    emit('update:modelValue', false)
  } else {
    creating.value = false
  }
}

function createInstance() {
  const name = newName.value.trim()
  if (!name) return
  emit('create', name)
  newName.value = ''
  creating.value = false
}

function formatDate(timestamp) {
  return timestamp ? new Date(timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—'
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

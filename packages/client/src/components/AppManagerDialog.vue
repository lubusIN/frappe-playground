<template>
  <Dialog
    :open="modelValue"
    size="lg"
    title="Apps"
    message="Add optional apps to this playground. Installed apps and their data stay isolated in this browser."
    @update:open="$emit('update:modelValue', $event)"
  >
    <template #actions>
      <div class="-mt-5 w-full text-left">
        <div
          v-if="loading"
          class="flex h-48 items-center justify-center gap-2 text-sm text-ink-gray-6"
        >
          <Spinner class="h-4 w-4" />
          Loading apps…
        </div>

        <div
          v-else-if="error"
          class="flex h-48 flex-col items-center justify-center gap-3 rounded-lg border border-outline-gray-2 bg-surface-gray-1 px-6 text-center"
        >
          <p class="m-0 text-sm text-ink-gray-7">{{ error }}</p>
          <Button variant="subtle" @click="$emit('retry')">Try again</Button>
        </div>

        <ListView
          v-else
          class="h-64 w-full"
          :columns="columns"
          :rows="apps"
          :options="listOptions"
          row-key="id"
        >
          <template #cell="{ item, row, column }">
            <div v-if="column.key === 'title'" class="min-w-0 py-1">
              <div class="flex items-center gap-2">
                <p class="m-0 truncate text-sm font-medium text-ink-gray-9">{{ item }}</p>
                <Badge v-if="row.experimental" size="sm" theme="orange" variant="subtle">
                  Experimental
                </Badge>
              </div>
              <p class="m-0 mt-0.5 truncate text-xs text-ink-gray-5">{{ row.description }}</p>
            </div>
            <span v-else-if="column.key === 'version'" class="text-sm text-ink-gray-6">
              {{ item }}
            </span>
            <Badge
              v-else-if="column.key === 'status'"
              :theme="isInstalled(row.id) ? 'green' : 'gray'"
              variant="subtle"
            >
              {{ isInstalled(row.id) ? 'Installed' : 'Available' }}
            </Badge>
            <div v-else-if="column.key === 'actions'" class="flex justify-end" @click.stop>
              <Button
                v-if="!isInstalled(row.id)"
                size="sm"
                variant="solid"
                :loading="installingAppId === row.id"
                :disabled="Boolean(installingAppId)"
                @click="$emit('install', row.id)"
              >
                Install
              </Button>
              <span v-else class="text-sm text-ink-gray-5">Ready</span>
            </div>
          </template>
        </ListView>

        <p
          v-if="installError"
          role="alert"
          class="m-0 mt-3 rounded-md bg-surface-red-2 px-3 py-2 text-sm text-ink-red-8"
        >
          {{ installError }}
        </p>
        <p v-else-if="installingAppId" class="m-0 mt-3 text-sm text-ink-gray-6">
          Installing the app and updating its DocTypes. Keep this tab open…
        </p>
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import Badge from 'frappe-ui/components/Badge/Badge.vue'
import Button from 'frappe-ui/components/Button/Button.vue'
import Dialog from 'frappe-ui/components/Dialog/Dialog.vue'
import ListView from 'frappe-ui/components/ListView/ListView.vue'
import Spinner from 'frappe-ui/components/Spinner/Spinner.vue'

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  apps: { type: Array, default: () => [] },
  installedApps: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  installError: { type: String, default: '' },
  installingAppId: { type: String, default: '' },
})

defineEmits(['install', 'retry', 'update:modelValue'])

const columns = [
  { label: 'App', key: 'title', width: 3 },
  { label: 'Version', key: 'version', width: '110px' },
  { label: 'Status', key: 'status', width: '100px' },
  { label: '', key: 'actions', width: '92px', align: 'right' },
]

const listOptions = {
  selectable: false,
  enableActive: false,
  showTooltip: true,
  rowHeight: 68,
  emptyState: {
    title: 'No apps available',
    description: 'This build does not include any optional apps.',
  },
}

function isInstalled(appId) {
  return props.installedApps.includes(appId)
}
</script>

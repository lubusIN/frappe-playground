<template>
  <Dialog
    :open="modelValue"
    size="lg"
    :title="dialogTitle"
    :message="dialogMessage"
    :icon="operationNotice?.type === 'success' ? 'lucide-check' : undefined"
    :theme="operationNotice?.type === 'success' ? 'green' : undefined"
    @update:open="$emit('update:modelValue', $event)"
  >
    <template #title>
      <div class="flex items-center gap-2">
        <h3 class="text-2xl-semibold leading-6 text-ink-gray-8">
          {{ dialogTitle }}
        </h3>
        <Badge
          v-if="!pendingRemoval && !pendingInstall"
          theme="gray"
          size="sm"
        >
          {{ apps.length }}
        </Badge>
      </div>
    </template>
    <template #actions>
      <div v-if="pendingRemoval || pendingInstall" class="w-full space-y-3 text-left">
        <p v-if="!operationNotice && (uninstallingAppId || installingAppId)" class="m-0 text-sm text-ink-gray-6">
          This can take several minutes; keep this tab open.
        </p>
        <p
          v-else-if="installError"
          role="alert"
          class="m-0 rounded-4 bg-surface-red-2 px-3 py-2 text-sm text-ink-red-8"
        >
          {{ installError }}
        </p>
        <div v-if="operationNotice?.type === 'success'" class="flex justify-end">
          <Button variant="solid" @click="$emit('update:modelValue', false)">Close</Button>
        </div>
        <div v-if="pendingRemoval && operationNotice?.type !== 'success'" class="flex justify-end gap-2">
          <Button variant="subtle" :disabled="Boolean(uninstallingAppId)" @click="pendingRemoval = null">
            Cancel
          </Button>
          <Button
            theme="red"
            variant="solid"
            :loading="uninstallingAppId === pendingRemoval.id"
            :disabled="Boolean(uninstallingAppId)"
            @click="$emit('uninstall', pendingRemoval.id)"
          >
            Uninstall
          </Button>
        </div>
        <div v-if="pendingInstall && operationNotice?.type !== 'success'" class="flex justify-end gap-2">
          <Button variant="subtle" :disabled="Boolean(installingAppId)" @click="pendingInstall = null">
            Cancel
          </Button>
          <Button
            variant="solid"
            :loading="installingAppId === pendingInstall.id"
            :disabled="Boolean(installingAppId)"
            @click="$emit('install', pendingInstall.id)"
          >
            Install
          </Button>
        </div>
      </div>

      <div v-else class="-mt-5 w-full text-left">
        <div
          v-if="loading"
          class="flex h-48 items-center justify-center gap-2 text-sm text-ink-gray-6"
        >
          <Spinner class="h-4 w-4" />
          Loading apps…
        </div>

        <div
          v-else-if="error"
          class="flex h-48 flex-col items-center justify-center gap-3 rounded-5 border border-outline-gray-2 bg-surface-gray-1 px-6 text-center"
        >
          <p class="m-0 text-sm text-ink-gray-7">{{ error }}</p>
          <Button variant="subtle" @click="$emit('retry')">Try again</Button>
        </div>

        <div v-else class="h-64 w-full overflow-y-auto">
          <p v-if="!apps.length" class="text-sm text-ink-gray-5">No apps available in this build.</p>
          <List v-else :columns="['minmax(0, 1fr)', '92px']" :row-height="80">
            <ListRow v-for="row in apps" :key="row.id" :value="row.id">
              <ListCell>
                <div class="flex items-start gap-3 min-w-0 py-1">
                  <Avatar
                    :image="row.logo || null"
                    :label="row.title"
                    shape="square"
                    size="2xl"
                    class="mt-0.5"
                  />
                  <div class="flex flex-col min-w-0 text-left">
                    <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                      <p class="m-0 truncate text-sm font-medium text-ink-gray-9">{{ row.title }}</p>
                      <Badge size="sm" theme="gray" variant="subtle">
                        v{{ row.version }}
                      </Badge>
                    </div>
                    <p class="m-0 mt-1 line-clamp-2 text-xs leading-4 text-ink-gray-5 text-left">
                      {{ row.description }}
                    </p>
                  </div>
                </div>
              </ListCell>
              <ListCell class="justify-end">
                <div class="flex justify-end" @click.stop>
                  <Button
                    v-if="!isInstalled(row.id)"
                    :data-testid="`install-app-${row.id}`"
                    size="sm"
                    variant="solid"
                    :disabled="Boolean(installingAppId || uninstallingAppId)"
                    @click="pendingInstall = row"
                  >
                    Install
                  </Button>
                  <Button
                    v-else
                    :data-testid="`uninstall-app-${row.id}`"
                    size="sm"
                    theme="red"
                    variant="ghost"
                    :disabled="Boolean(installingAppId || uninstallingAppId)"
                    @click="pendingRemoval = row"
                  >
                    Uninstall
                  </Button>
                </div>
              </ListCell>
            </ListRow>
          </List>
        </div>


      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { Avatar, Badge, Button, Dialog, Spinner } from 'frappe-ui'
import { List, ListRow, ListCell } from 'frappe-ui/list'
import { computed, ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  apps: { type: Array, default: () => [] },
  installedApps: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  installError: { type: String, default: '' },
  operationNotice: { type: Object, default: null },
  installingAppId: { type: String, default: '' },
  uninstallingAppId: { type: String, default: '' },
})

defineEmits(['install', 'retry', 'uninstall', 'update:modelValue'])

const pendingRemoval = ref(null)
const pendingInstall = ref(null)

const dialogTitle = computed(() => {
  if (props.operationNotice?.type === 'success') return pendingRemoval.value ? 'App Uninstalled' : 'App Installed'
  if (props.installError) return pendingRemoval.value ? 'Uninstall Failed' : 'Install Failed'
  if (pendingRemoval.value) return 'Uninstall App'
  if (pendingInstall.value) return 'Install App'
  return 'Apps'
})

const dialogMessage = computed(() => {
  if (props.operationNotice?.type === 'success') return props.operationNotice.message
  if (props.installError) return ''
  if (pendingRemoval.value) {
    return `Remove the “${pendingRemoval.value.title}” app and refresh the site?`
  }
  if (pendingInstall.value) {
    return `Add the “${pendingInstall.value.title}” app and refresh the site?`
  }
  return 'Add optional apps to this playground. Installed apps and their data stay isolated in this browser.'
})

// Keep the current view throughout the closing animation. Reset only when
// reopening the catalog, not when an in-flight operation reopens its result.
watch(() => props.modelValue, open => {
  if (open && !props.operationNotice && !props.uninstallingAppId && !props.installingAppId) {
    pendingRemoval.value = null
    pendingInstall.value = null
  }
})



function isInstalled(appId) {
  return props.installedApps.includes(appId)
}
</script>

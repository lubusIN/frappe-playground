<template>
  <div
    class="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] items-center gap-3.5 border-b border-gray-950 bg-gray-900 px-2.5 py-1.5 max-sm:grid-cols-1 max-sm:content-center max-sm:gap-1.5"
  >
    <div class="inline-flex min-w-0 items-center gap-2">
      <BrandIcon
        clip-id="frappe-topbar-brand-clip"
        mark-color="light"
        class="text-gray-900"
      />
      <Badge
        theme="gray"
        variant="outline"
        size="sm"
        class="max-w-40 truncate !border-gray-700 !text-gray-300"
      >
        {{ activeInstanceName }}
      </Badge>
    </div>

    <form
      class="grid min-w-0 grid-cols-[32px_minmax(0,1fr)_32px_32px_32px] items-center gap-1.5"
      @submit.prevent="$emit('navigate')"
    >
      <Button
        class="w-8 !text-gray-300 hover:!text-white hover:!bg-gray-800"
        type="button"
        variant="ghost"
        :disabled="!ready"
        title="Reload frame"
        aria-label="Reload frame"
        @click="$emit('reload')"
      >
        <template #icon>
          <RotateCw class="h-4 w-4" aria-hidden="true" />
        </template>
      </Button>
      <!--
        NOTE: Do not refactor this to use Frappe UI's <TextInput>.
        The native input is used intentionally here to allow full control over
        the backgrounds and borders (especially in dark mode). The TextInput wrapper
        enforces a white background natively even when using variant="ghost".
      -->
      <input
        type="text"
        :value="address"
        :disabled="!ready"
        placeholder="Current Frappe path"
        aria-label="Current Frappe path"
        class="w-full rounded-md border border-gray-700 bg-gray-800 px-2.5 py-0.5 font-mono text-[13px] text-gray-200 placeholder-gray-400 focus:border-gray-400 focus:outline-none focus:ring-0 disabled:opacity-50 transition-colors"
        @input="$emit('update:address', $event.target.value)"
      />
      <Button
        class="w-8 !text-gray-300 hover:!text-white hover:!bg-gray-800"
        type="button"
        variant="ghost"
        :disabled="!ready"
        title="Manage playgrounds"
        aria-label="Manage playgrounds"
        @click="$emit('manage-instances')"
      >
        <template #icon>
          <PanelsTopLeft class="h-4 w-4" aria-hidden="true" />
        </template>
      </Button>
      <Button
        class="w-8 !text-gray-300 hover:!text-white hover:!bg-gray-800"
        type="button"
        variant="ghost"
        :disabled="!ready"
        title="Manage apps"
        aria-label="Manage apps"
        @click="$emit('manage-apps')"
      >
        <template #icon>
          <Blocks class="h-4 w-4" aria-hidden="true" />
        </template>
      </Button>
      <Button
        class="w-8 !text-gray-300 hover:!text-white hover:!bg-gray-800"
        type="button"
        variant="ghost"
        :disabled="!ready"
        title="Playground info"
        aria-label="Playground info"
        @click="$emit('show-info')"
      >
        <template #icon>
          <HelpCircle class="h-4 w-4" aria-hidden="true" />
        </template>
      </Button>
    </form>
  </div>
</template>

<script setup>
import Button from 'frappe-ui/components/Button/Button.vue'
import Badge from 'frappe-ui/components/Badge/Badge.vue'
import { computed } from 'vue'
import { Blocks, PanelsTopLeft, RotateCw, HelpCircle } from '@lucide/vue'
import BrandIcon from './BrandIcon.vue'

const props = defineProps({
  address: {
    type: String,
    required: true,
  },
  ready: {
    type: Boolean,
    default: false,
  },
  instances: {
    type: Array,
    default: () => [],
  },
  activeInstanceId: {
    type: String,
    default: '',
  },
})

const activeInstanceName = computed(() => (
  props.instances.find(instance => instance.id === props.activeInstanceId)?.name || 'Playground'
))

defineEmits([
  'manage-instances',
  'manage-apps',
  'show-info',
  'navigate',
  'reload',
  'update:address',
])
</script>

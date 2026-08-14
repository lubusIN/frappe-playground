<template>
  <div 
    :class="[
      'fixed z-50 overflow-hidden border-gray-700/60 bg-gray-950 transition-all duration-200',
      isFullWidth || isMobile ? 'bottom-0 inset-x-0 w-full rounded-none border-t pb-safe' : 'bottom-6 left-1/2 w-fit -translate-x-1/2 rounded-6 border'
    ]"
  >
    <!-- Top row: Address bar and status -->
    <form
      class="flex items-center gap-2 px-2 py-1.5"
      :class="{ 'border-b border-gray-700/50': showActions }"
      @submit.prevent="$emit('navigate')"
    >
      <Button
        variant="ghost"
        class="!text-gray-400 hover:!bg-gray-700 hover:!text-white focus:outline-none !h-7 !w-7 shrink-0"
        :disabled="!ready"
        title="Reload frame"
        aria-label="Reload frame"
        @click="$emit('reload')"
      >
        <template #icon>
          <RotateCw class="h-3.5 w-3.5" aria-hidden="true" />
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
        readonly
        placeholder="Current Frappe path"
        aria-label="Current Frappe path"
        :class="[
          'rounded-4 border border-transparent bg-gray-800 px-2 py-0.5 font-mono text-[13px] text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-0 disabled:opacity-50 transition-colors cursor-default',
          isFullWidth || isMobile ? 'flex-1' : 'w-64'
        ]"
      />

      <div
        class="hidden sm:flex max-w-[140px] shrink-0 items-center justify-center rounded-4 border border-gray-800 px-3 py-1 text-[13px] font-medium text-gray-300"
        :title="activeInstanceName"
      >
        <span class="truncate block">{{ activeInstanceName }}</span>
      </div>
      
      <!-- Right Controls: Toggle Actions and Full-Width -->
      <div class="flex items-center gap-1 ml-1 shrink-0">
        <Button
          variant="ghost"
          class="!text-gray-400 hover:!bg-gray-700 hover:!text-white focus:outline-none !h-7 !w-7"
          title="Toggle actions"
          @click="showActions = !showActions"
        >
          <template #icon>
            <ChevronUp v-if="!showActions" class="h-3.5 w-3.5" aria-hidden="true" />
            <ChevronDown v-else class="h-3.5 w-3.5" aria-hidden="true" />
          </template>
        </Button>

        <Button
          v-if="!isMobile"
          variant="ghost"
          class="!text-gray-400 hover:!bg-gray-700 hover:!text-white focus:outline-none !h-7 !w-7"
          title="Toggle full width"
          @click="isFullWidth = !isFullWidth"
        >
          <template #icon>
            <Minimize v-if="isFullWidth" class="h-3.5 w-3.5" aria-hidden="true" />
            <Maximize v-else class="h-3.5 w-3.5" aria-hidden="true" />
          </template>
        </Button>
      </div>
    </form>

    <!-- Bottom row: Actions -->
    <div v-show="showActions" class="flex items-center justify-center gap-1 sm:gap-2 px-2 py-1.5 transition-all">
      <Button
        v-for="action in dockActions"
        :key="action.id"
        :variant="action.primary ? 'solid' : 'ghost'"
        class="group !flex !h-auto flex-1 sm:flex-none sm:!w-16 !flex-col !items-center !justify-center !gap-1 !px-2 !py-1.5 focus:outline-none !rounded-5"
        :class="action.primary ? '!bg-blue-600 !text-white hover:!bg-blue-700 border-transparent' : '!text-gray-400 hover:!bg-gray-800 hover:!text-white'"
        :disabled="!ready"
        :title="action.title"
        :aria-label="action.title"
        @click="$emit(action.event)"
      >
        <template #prefix>
          <component :is="action.icon" class="h-4 w-4 sm:h-4 sm:w-4 group-hover:text-white" aria-hidden="true" />
        </template>
        <span class="text-[10px] font-medium leading-none tracking-wide group-hover:text-white">{{ action.label }}</span>
      </Button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import Button from 'frappe-ui/components/Button/Button.vue'
import { RotateCw, PanelsTopLeft, Blocks, HelpCircle, ChevronDown, ChevronUp, Maximize, Minimize, Plus } from '@lucide/vue'

const dockActions = [
  { id: 'new', label: 'New', icon: Plus, event: 'create-instance', title: 'Create new playground' },
  { id: 'sites', label: 'Sites', icon: PanelsTopLeft, event: 'manage-instances', title: 'Manage playgrounds' },
  { id: 'apps', label: 'Apps', icon: Blocks, event: 'manage-apps', title: 'Manage apps' },
  { id: 'info', label: 'Info', icon: HelpCircle, event: 'show-info', title: 'Playground info' }
]

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

// Layout State
const showActions = ref(true)
const isFullWidth = ref(false)

// Mobile responsiveness
const windowWidth = ref(1024)
const isMobile = computed(() => windowWidth.value < 1024)

function onResize() {
  windowWidth.value = window.innerWidth
}

onMounted(() => {
  windowWidth.value = window.innerWidth
  window.addEventListener('resize', onResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
})

const activeInstanceName = computed(() => (
  props.instances.find(instance => instance.id === props.activeInstanceId)?.name || 'Playground'
))

defineEmits([
  'create-instance',
  'manage-instances',
  'manage-apps',
  'show-info',
  'navigate',
  'reload',
  'update:address',
])
</script>

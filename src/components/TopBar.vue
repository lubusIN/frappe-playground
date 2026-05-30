<template>
  <div
    class="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] items-center gap-3.5 border-b border-[#262626] bg-[#0a0a0a] px-2.5 py-1.5 max-sm:grid-cols-1 max-sm:content-center max-sm:gap-1.5"
  >
    <div class="inline-flex min-w-0 items-center gap-2">
      <BrandWordmark clip-id="frappe-topbar-wordmark-clip" />
    </div>

    <form
      class="grid min-w-0 grid-cols-[minmax(0,1fr)_32px] items-center gap-1.5"
      @submit.prevent="$emit('navigate')"
    >
      <input
        :value="address"
        class="h-[30px] min-w-0 appearance-none rounded-md border border-[#404040] bg-[#171717] px-2.5 font-mono text-[13px] leading-[30px] text-[#f5f5f5] outline-none placeholder:text-[#525252] focus:border-[#737373] focus:bg-[#171717] disabled:text-[#737373]"
        :disabled="!ready"
        aria-label="Current Frappe path"
        spellcheck="false"
        @input="$emit('update:address', $event.target.value)"
      />
      <Button
        class="h-[30px] w-8 rounded-md bg-transparent p-0 text-[#d4d4d4] hover:bg-[#262626] focus-visible:ring-0 disabled:text-[#525252]"
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
    </form>
  </div>
</template>

<script setup>
import { Button } from 'frappe-ui/components/Button'
import { RotateCw } from '@lucide/vue'
import BrandWordmark from './BrandWordmark.vue'

defineProps({
  address: {
    type: String,
    required: true,
  },
  ready: {
    type: Boolean,
    default: false,
  },
})

defineEmits(['navigate', 'reload', 'update:address'])
</script>

<template>
  <section id="loading-screen" class="relative flex min-h-screen flex-col items-center pt-10 sm:pt-16 bg-surface-gray-2 p-6">
    <div class="absolute right-4 top-4">
      <Button
        class="!text-gray-800 dark:!text-gray-300 hover:!bg-gray-200 dark:hover:!bg-gray-800"
        variant="ghost"
        title="Toggle Theme"
        aria-label="Toggle Theme"
        @click="$emit('toggleTheme')"
      >
        <template #icon>
          <Sun v-if="isDark" class="h-4 w-4" aria-hidden="true" />
          <Moon v-else class="h-4 w-4" aria-hidden="true" />
        </template>
      </Button>
    </div>
    
    <div class="grid w-full max-w-[420px] justify-items-center gap-2.5 text-center">
      <BrandIcon clip-id="frappe-loading-brand-clip" size="xl" class="mb-1.5 text-ink-gray-9" />
      <p class="m-0 text-lg font-bold text-ink-gray-9">Brewing Your Frappe</p>
      <div class="mt-4 flex w-full max-w-[320px] flex-col gap-3 rounded-xl bg-surface-base p-5 text-left shadow-sm">
        <div v-for="(step, idx) in steps" :key="idx" class="flex items-center gap-3 text-[13px]" :class="step.status === 'pending' ? 'text-ink-gray-4' : 'text-ink-gray-8'">
          <Rocket v-if="step.status === 'done' && idx === steps.length - 1" class="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <CheckCircle2 v-else-if="step.status === 'done'" class="h-4 w-4 shrink-0 text-green-600 dark:text-green-500" />
          <Loader2 v-else-if="step.status === 'active' && booting" class="h-4 w-4 shrink-0 animate-spin text-amber-500 dark:text-amber-400" />
          <Circle v-else class="h-4 w-4 shrink-0 text-ink-gray-3" />
          <span>{{ step.label }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { Button } from 'frappe-ui/components/Button'
import { Sun, Moon, CheckCircle2, Loader2, Circle, Rocket } from '@lucide/vue'
import BrandIcon from './BrandIcon.vue'

defineProps({
  steps: {
    type: Array,
    required: true,
  },
  booting: {
    type: Boolean,
    default: false,
  },
  isDark: {
    type: Boolean,
    default: false,
  },
})

defineEmits(['toggleTheme'])
</script>

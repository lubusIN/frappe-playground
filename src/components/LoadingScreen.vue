<template>
  <section id="loading-screen" class="relative flex min-h-screen flex-col items-center pt-10 sm:pt-16 bg-surface-gray-2 p-6">
    <div class="grid w-full max-w-[420px] justify-items-center gap-2.5 text-center">
      <BrandIcon clip-id="frappe-loading-brand-clip" size="xl" class="mb-1.5 text-ink-gray-9" />
      <p class="m-0 text-lg font-bold text-ink-gray-9">Brewing Your Frappe</p>
      <div class="mt-4 flex w-full max-w-[320px] flex-col gap-3 rounded-xl bg-surface-base p-5 text-left shadow-sm">
        <div v-for="(step, idx) in steps" :key="idx" class="flex items-center justify-between gap-3 text-[13px]" :class="step.status === 'pending' ? 'text-ink-gray-4' : 'text-ink-gray-8'">
          <div class="flex items-center gap-3">
            <Rocket v-if="step.status === 'done' && idx === steps.length - 1" class="h-4 w-4 shrink-0 text-blue-600" />
            <CheckCircle2 v-else-if="step.status === 'done'" class="h-4 w-4 shrink-0 text-green-600" />
            <Loader2 v-else-if="step.status === 'active' && booting" class="h-4 w-4 shrink-0 animate-spin text-amber-500" />
            <Circle v-else class="h-4 w-4 shrink-0 text-ink-gray-3" />
            <span>{{ step.label }}</span>
          </div>
          <span v-if="step.elapsed !== null" class="text-xs text-ink-gray-5 tabular-nums font-mono opacity-70">
            {{ formatElapsed(step.elapsed) }}
          </span>
        </div>
      </div>
    </div>

    <div class="mt-auto pt-8 text-[13px] text-ink-gray-5">
      \ Made by
      <a
        href="https://lubus.in"
        target="_blank"
        rel="noopener noreferrer"
        class="text-ink-gray-8 hover:text-ink-gray-9 hover:underline transition-colors"
      >
        lubus
      </a>
      /
    </div>
  </section>
</template>

<script setup>
import { CheckCircle2, Loader2, Circle, Rocket } from '@lucide/vue'
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
})

function formatElapsed(ms) {
  if (ms == null) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
</script>

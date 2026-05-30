<template>
  <section id="loading-screen" class="grid min-h-0 place-items-center bg-[#0a0a0a] p-6">
    <div class="grid w-full max-w-[420px] justify-items-center gap-2.5 text-center">
      <BrandIcon clip-id="frappe-loading-brand-clip" size="lg" class="mb-1.5" />
      <p class="m-0 text-lg font-bold text-[#f5f5f5]">Brewing Your Frappe</p>
      <p class="m-0 min-h-5 text-[13px] text-[#a3a3a3]">{{ message }}</p>
      <div class="relative h-1 w-full max-w-[280px] overflow-hidden rounded-full bg-[#262626]">
        <span
          class="absolute inset-y-0 left-0 w-5/12 -translate-x-[120%] rounded-full bg-[#d4d4d4]"
          :class="{ 'animate-progress-sweep': booting }"
        />
      </div>
    </div>
  </section>
</template>

<script setup>
import BrandIcon from './BrandIcon.vue'

defineProps({
  message: {
    type: String,
    required: true,
  },
  booting: {
    type: Boolean,
    default: false,
  },
})
</script>

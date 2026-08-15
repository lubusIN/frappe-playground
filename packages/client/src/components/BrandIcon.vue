<template>
  <svg
    class="block"
    fill="none"
    viewBox="0 0 375 375"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <rect v-if="!bare" width="375" height="375" rx="80" fill="#171717" />
    <defs>
      <clipPath :id="`${clipId}-mark`">
        <path d="M77.7 79.695H297V292H77.7Zm0 0"/>
      </clipPath>
    </defs>
    <g :clip-path="`url(#${clipId}-mark)`">
      <path
        :class="markClass"
        d="M226.27 291.34c-12.793-74.207-34.184-113.746-86.356-141.942l22.492-4.601c12.254 8.043 22.906 17.086 32.137 27.527 15.367 17.39 26.168 37.95 34.227 62.613l44.96-134.726-140.246 28.68.024.011-26.836 5.489c-8.914-3.41-18.496-6.696-28.8-9.903l219.03-44.793Zm0 0"
      />
    </g>
  </svg>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  bare: {
    type: Boolean,
    default: false,
  },
  clipId: {
    type: String,
    default: 'frappe-brand-clip',
  },
  markColor: {
    type: String,
    default: 'adaptive',
    validator: value => ['adaptive', 'light'].includes(value),
  },
})

const markClass = computed(() => 'fill-white')
</script>

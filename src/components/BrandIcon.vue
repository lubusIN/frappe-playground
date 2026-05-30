<template>
  <svg
    class="block"
    :class="sizeClass"
    fill="none"
    viewBox="0 0 25 25"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <g :clip-path="`url(#${clipId})`">
      <path
        d="M19.9624 0.763672H5.83963C3.31294 0.763672 1.26465 2.81189 1.26465 5.33849V19.4608C1.26465 21.9874 3.31294 24.0356 5.83963 24.0356H19.9624C22.4891 24.0356 24.5374 21.9874 24.5374 19.4608V5.33849C24.5374 2.81189 22.4891 0.763672 19.9624 0.763672Z"
        fill="#383838"
      />
      <path d="M9.17773 7.97852H16.625" stroke="white" stroke-width="2.10048" />
      <path
        d="M10.2246 17.8705V12.9834H16.0428"
        stroke="white"
        stroke-width="2.10048"
      />
    </g>
    <defs>
      <clipPath :id="clipId">
        <rect
          fill="white"
          height="23.9992"
          transform="translate(0.901367 0.400391)"
          width="24"
        />
      </clipPath>
    </defs>
  </svg>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  size: {
    type: String,
    default: 'md',
    validator: value => ['md', 'lg'].includes(value),
  },
  clipId: {
    type: String,
    default: 'frappe-brand-clip',
  },
})

const sizeClass = computed(() => (props.size === 'lg' ? 'h-10 w-10' : 'h-6 w-6'))
</script>

<template>
  <Dialog
    :model-value="modelValue"
    :options="{ size: 'md', title: dialogTitle }"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <template #body>
      <div class="bg-[#171717] p-5 text-left text-[#e5e5e5]">
        <h2 class="m-0 text-lg font-bold text-[#f5f5f5]">{{ dialogTitle }}</h2>
        <p class="m-0 mt-2 text-sm leading-6 text-[#a3a3a3]">
          This playground is highly experimental and runs entirely in your
          browser. Changes made here are temporary and will be lost when this tab
          is closed or reloaded.
        </p>
        <div v-if="SITE_CONFIG.prefill_login_credentials" class="mt-4 rounded-md border border-[#333333] bg-[#212121] p-3 text-sm leading-5 text-[#a3a3a3]">
          <span class="font-medium text-[#e5e5e5]">Default Credentials:</span> <br/>
          The login form is automatically prefilled with username
          <code class="rounded bg-[#2e2e2e] px-1.5 py-0.5 text-xs font-mono text-[#f5f5f5]">{{ SITE_CONFIG.prefill_login_user }}</code>
          and password
          <code class="rounded bg-[#2e2e2e] px-1.5 py-0.5 text-xs font-mono text-[#f5f5f5]">{{ SITE_CONFIG.prefill_login_pwd }}</code>.
        </div>
        <Button
          class="mt-5 h-[34px] w-full rounded-md border border-[#404040] bg-[#262626] text-[13px] font-semibold text-[#f5f5f5] hover:bg-[#404040] focus-visible:ring-0"
          @click="$emit('update:modelValue', false)"
        >
          I understand
        </Button>
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { Button } from 'frappe-ui/components/Button'
import { Dialog } from 'frappe-ui/components/Dialog'
import { SITE_CONFIG } from '../../public/config.js'

const dialogTitle = 'Experimental Playground'

defineProps({
  modelValue: {
    type: Boolean,
    required: true,
  },
})

defineEmits(['update:modelValue'])
</script>

<style scoped>
:global(.dialog-overlay[data-dialog='Experimental Playground']) {
  background: rgb(10 10 10 / 0.72);
}

:global(.dialog-overlay[data-dialog='Experimental Playground'] .dialog-content) {
  overflow: hidden;
  border-radius: 8px;
  background: #171717;
  box-shadow: none;
}

:global(.dialog-overlay[data-dialog='Experimental Playground'] .bg-surface-modal) {
  background: #171717;
}
</style>

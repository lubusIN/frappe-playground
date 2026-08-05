<template>
  <Dialog
    :model-value="modelValue"
    :options="{ size: 'md', title: dialogTitle }"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <template #body>
      <div class="p-5 text-left text-gray-900 dark:text-gray-100">
        <h2 class="m-0 text-lg font-bold text-gray-900 dark:text-gray-100">{{ dialogTitle }}</h2>
        <p class="m-0 mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">
          This playground runs entirely in your browser. Changes made here are temporary and will be lost when this tab
          is closed or reloaded.
        </p>
        <div v-if="SITE_CONFIG.prefill_login_credentials" class="mt-4 rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 p-3 text-sm leading-5 text-gray-600 dark:text-gray-400">
          <span class="font-medium text-gray-900 dark:text-gray-100">Default Credentials:</span>
          <div class="mt-2 flex flex-col items-start gap-2">
            <Badge variant="subtle" theme="blue" size="lg" class="font-mono">
              <template #prefix><User class="h-3 w-3" /></template>
              {{ SITE_CONFIG.prefill_login_user }}
            </Badge>
            <Badge variant="subtle" theme="blue" size="lg" class="font-mono">
              <template #prefix><Key class="h-3 w-3" /></template>
              {{ SITE_CONFIG.prefill_login_pwd }}
            </Badge>
          </div>
        </div>
        <p v-if="SITE_CONFIG.prefill_login_credentials" class="m-0 mt-3 text-sm text-gray-600 dark:text-gray-400">
          The login form is automatically prefilled with these credentials.
        </p>
        <Button
          variant="solid"
          class="mt-5 w-full"
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
import { Badge } from 'frappe-ui/components/Badge'
import { User, Key } from '@lucide/vue'
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

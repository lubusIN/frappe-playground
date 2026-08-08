<template>
  <Dialog
    :open="modelValue"
    size="md"
    :title="dialogTitle"
    :message="dialogDescription"
    @update:open="$emit('update:modelValue', $event)"
  >
    <template #actions>
      <div class="w-full text-left text-gray-900 dark:text-gray-100">
        <div v-if="LOGIN_DEMO.prefill" class="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm leading-5 text-gray-600">
          <span class="font-medium text-gray-900 dark:text-gray-100">Default Credentials:</span>
          <div class="mt-2 flex items-start gap-2">
            <Badge variant="outline" theme="blue" size="lg" class="font-mono">
              <template #prefix><User class="h-3 w-3" /></template>
              {{ LOGIN_DEMO.username }}
            </Badge>
            <Badge variant="outline" theme="blue" size="lg" class="font-mono">
              <template #prefix><Key class="h-3 w-3" /></template>
              {{ LOGIN_DEMO.password }}
            </Badge>
          </div>
        </div>
        <p v-if="LOGIN_DEMO.prefill" class="m-0 mt-3 text-sm text-gray-600 dark:text-gray-400">
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
import { Button, Dialog, Badge } from 'frappe-ui'
import { User, Key } from '@lucide/vue'
import { LOGIN_DEMO } from '../playground/config.js'

const dialogTitle = 'Experimental Playground'
const dialogDescription =
  'This playground runs entirely in your browser. Changes made here are temporary and will be lost when this tab is closed or reloaded.'

defineProps({
  modelValue: {
    type: Boolean,
    required: true,
  },
})

defineEmits(['update:modelValue'])
</script>

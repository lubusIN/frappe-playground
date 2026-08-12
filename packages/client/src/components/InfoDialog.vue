<template>
  <Dialog
    :open="modelValue"
    bare
    size="sm"
    @update:open="$emit('update:modelValue', $event)"
  >
    <VisuallyHidden>
      <DialogTitle>About Frappe Playground</DialogTitle>
      <DialogDescription>Information about the playground, including installed apps and documentation.</DialogDescription>
    </VisuallyHidden>
    <div class="bg-surface-elevation-1 rounded-xl shadow-xl overflow-hidden flex flex-col relative text-left">
      <Button
        variant="ghost"
        class="absolute top-2 right-2 z-10 w-8"
        @click="$emit('update:modelValue', false)"
      >
        <template #icon>
          <X class="h-4 w-4 text-ink-gray-9" />
        </template>
      </Button>

      <div class="flex flex-col items-center justify-center pt-8 pb-4">
        <div class="w-12 h-14 overflow-hidden mb-3 rounded-lg flex items-center justify-start">
          <img :src="logoUrl" alt="Frappe Vault" class="h-12 max-w-none" />
        </div>
        <div class="flex items-center gap-2">
          <span class="text-lg font-semibold text-ink-gray-9">Frappe Playground</span>
          <Badge theme="gray" variant="subtle" size="sm" class="font-mono font-medium">v{{ pkg.version }}</Badge>
        </div>
      </div>

      <Tabs :tabs="[{ label: 'About' }, { label: 'Credentials' }, { label: 'Insights' }]" v-model="activeTab" class="w-full">
        <template #tab-panel="{ tab }">
          <div v-if="tab.label === 'About'" class="p-5 pt-4 min-h-[220px] flex flex-col gap-1">
            <a
              v-for="link in aboutLinks"
              :key="link.label"
              :href="link.url"
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center justify-between p-2 -mx-2 rounded-md hover:bg-surface-gray-2 transition-colors text-ink-gray-9 text-sm"
            >
              <div class="flex items-center gap-3">
                <component :is="link.icon" class="w-4 h-4 text-ink-gray-6 stroke-[1.5]" />
                <span class="font-medium">{{ link.label }}</span>
              </div>
              <ArrowRight class="w-4 h-4 text-ink-gray-5 stroke-[1.5]" />
            </a>
          </div>
          <div v-if="tab.label === 'Credentials'" class="p-5 pt-4 min-h-[220px] flex flex-col gap-4">
            <p class="text-[13px] text-ink-gray-5 leading-relaxed">
              Use these default credentials to log in to the Admin Desk.
            </p>
            <div class="flex flex-col gap-3">
              <FormControl
                type="text"
                label="Username"
                :modelValue="LOGIN_DEMO.username"
                disabled
              >
                <template #prefix>
                  <User class="w-4 h-4 text-ink-gray-5" />
                </template>
                <template #suffix>
                  <Button variant="ghost" @click="copyUsername(LOGIN_DEMO.username)">
                    <template #icon>
                      <Check v-if="copiedUsername" class="w-4 h-4 text-green-600" />
                      <Copy v-else class="w-4 h-4 text-ink-gray-5" />
                    </template>
                  </Button>
                </template>
              </FormControl>
              <FormControl
                type="text"
                label="Password"
                :modelValue="LOGIN_DEMO.password"
                disabled
              >
                <template #prefix>
                  <Key class="w-4 h-4 text-ink-gray-5" />
                </template>
                <template #suffix>
                  <Button variant="ghost" @click="copyPassword(LOGIN_DEMO.password)">
                    <template #icon>
                      <Check v-if="copiedPassword" class="w-4 h-4 text-green-600" />
                      <Copy v-else class="w-4 h-4 text-ink-gray-5" />
                    </template>
                  </Button>
                </template>
              </FormControl>
            </div>
          </div>
          <div v-if="tab.label === 'Insights'" class="p-5 pt-4 min-h-[220px] flex flex-col gap-3 text-left">
            <div v-for="(step, idx) in bootSteps" :key="idx" class="flex items-center justify-between gap-3 text-[13px] text-ink-gray-8">
              <div class="flex items-center gap-3">
                <Rocket v-if="idx === bootSteps.length - 1" class="h-4 w-4 shrink-0 text-blue-600" />
                <CheckCircle2 v-else class="h-4 w-4 shrink-0 text-green-600" />
                <span>{{ step.label }}</span>
              </div>
              <span v-if="step.elapsed !== null" class="text-xs text-ink-gray-5 tabular-nums font-mono opacity-70">
                {{ formatElapsed(step.elapsed) }}
              </span>
            </div>
            <div class="flex items-center justify-between text-[13px] font-medium text-ink-gray-9">
              <div class="flex items-center gap-3">
                <Coffee class="h-4 w-4 shrink-0 text-amber-700" />
                <span>Brewed in</span>
              </div>
              <span class="tabular-nums font-mono opacity-80">{{ formatElapsed(totalElapsedMs) }}</span>
            </div>
          </div>
        </template>
      </Tabs>

      <div class="px-5 py-3 border-t border-surface-gray-2 bg-surface-gray-50 text-center text-[13px] text-ink-gray-5">
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
    </div>
  </Dialog>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useClipboard } from '@vueuse/core'
import { DialogTitle, DialogDescription, VisuallyHidden } from 'reka-ui'
import Badge from 'frappe-ui/components/Badge/Badge.vue'
import Button from 'frappe-ui/components/Button/Button.vue'
import Dialog from 'frappe-ui/components/Dialog/Dialog.vue'
import Tabs from 'frappe-ui/components/Tabs/Tabs.vue'
import FormControl from 'frappe-ui/components/FormControl/FormControl.vue'
import { User, Key, CheckCircle2, Rocket, Coffee, X, HelpCircle, Bug, Heart, Headphones, ArrowRight, Copy, Check } from '@lucide/vue'
import GithubIcon from './GithubIcon.vue'
import { LOGIN_DEMO } from '../playground/config.js'
import pkg from '../../../../package.json'
import logoUrl from '../../../../.github/logo.svg'

const props = defineProps({
  modelValue: {
    type: Boolean,
    required: true,
  },
  bootSteps: {
    type: Array,
    default: () => [],
  }
})

defineEmits(['update:modelValue'])

const activeTab = ref(0)

const { copy: copyUsername, copied: copiedUsername } = useClipboard()
const { copy: copyPassword, copied: copiedPassword } = useClipboard()

const aboutLinks = [
  { label: 'GitHub', icon: GithubIcon, url: 'https://github.com/lubusIN/frappe-playground' },
  { label: 'Submit Feedback', icon: Bug, url: 'https://github.com/lubusIN/frappe-playground/issues' },
  { label: 'Buy us a coffee', icon: Heart, url: 'https://github.com/sponsors/lubusIN' },
  { label: 'Get in touch', icon: Headphones, url: 'https://lubus.in' },
]

const totalElapsedMs = computed(() => {
  return props.bootSteps.reduce((total, step) => total + (step.elapsed || 0), 0)
})

function formatElapsed(ms) {
  if (ms == null) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
</script>

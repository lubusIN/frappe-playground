<script setup>
import { ref } from 'vue'
import IntroDialog from './components/IntroDialog.vue'
import InfoDialog from './components/InfoDialog.vue'
import AppManagerDialog from './components/AppManagerDialog.vue'
import InstanceManagerDialog from './components/InstanceManagerDialog.vue'
import LoadingScreen from './components/LoadingScreen.vue'
import Dock from './components/Dock.vue'
import { usePlaygroundLifecycle } from './composables/use-playground-lifecycle.js'
import { useInstanceManager } from './composables/use-instance-manager.js'

const {
  ready, booting, bootError, bootSteps, instanceId, instances, showIntroDialog,
  address, frameSrc, iframeRef, syncAddressFromFrame, navigateFrame, reloadFrame,
  showAppManager, availableApps, installedApps, appCatalogLoading, appCatalogError,
  appOperationNotice, appInstallError, installingAppId, uninstallingAppId, openAppManager, retryAppCatalog,
  installApp, uninstallApp, initPlayground, stopPlayground, failPlayground,
} = usePlaygroundLifecycle()
const showInfoDialog = ref(false)
const { instanceManagerRef, showInstanceManager, instanceBusy, instanceError,
  createInstance, selectInstance, renameInstance, resetInstance, deleteInstance,
} = useInstanceManager({ instanceId, instances, initPlayground, stopPlayground, failPlayground })
function reloadPage() { window.location.reload() }

</script>

<template>
  <main class="relative flex h-screen w-screen flex-col overflow-hidden bg-gray-50 dark:bg-gray-900 supports-[height:100dvh]:h-dvh">

    <LoadingScreen
      v-show="!ready"
      :booting="booting"
      :error="bootError"
      :steps="bootSteps"
      @retry="reloadPage"
    />

    <iframe
      v-if="ready"
      id="frappe-desk"
      ref="iframeRef"
      :src="frameSrc"
      class="flex-1 min-h-0 w-full border-0 bg-transparent dark:bg-gray-900"
      title="Frappe Desk"
      @load="syncAddressFromFrame"
    />

    <Dock
      v-show="ready"
      v-model:address="address"
      :active-instance-id="instanceId"
      :instances="instances"
      :ready="ready"
      @create-instance="showInstanceManager = true; instanceManagerRef?.startCreating()"
      @manage-instances="showInstanceManager = true"
      @manage-apps="openAppManager"
      @show-info="showInfoDialog = true"
      @navigate="navigateFrame"
      @reload="reloadFrame"
    />

    <IntroDialog v-if="ready" v-model="showIntroDialog" />
    <InfoDialog v-if="ready" v-model="showInfoDialog" :boot-steps="bootSteps" />
    <AppManagerDialog
      v-if="ready"
      v-model="showAppManager"
      :apps="availableApps"
      :installed-apps="installedApps"
      :loading="appCatalogLoading"
      :error="appCatalogError"
      :install-error="appInstallError"
      :operation-notice="appOperationNotice"
      :installing-app-id="installingAppId"
      :uninstalling-app-id="uninstallingAppId"
      @install="installApp"
      @retry="retryAppCatalog"
      @uninstall="uninstallApp"
    />
    <InstanceManagerDialog
      ref="instanceManagerRef"
      :busy="instanceBusy"
      :error="instanceError"
      v-model="showInstanceManager"
      :active-instance-id="instanceId"
      :instances="instances"
      @create="createInstance"
      @delete="deleteInstance"
      @reset="resetInstance"
      @rename="renameInstance"
      @select="selectInstance"
    />
  </main>
</template>

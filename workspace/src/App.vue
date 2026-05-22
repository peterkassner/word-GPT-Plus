<template>
  <div id="app">
    <router-view v-slot="{ Component }">
      <keep-alive include="Home">
        <component :is="Component" />
      </keep-alive>
    </router-view>
  </div>
</template>

<script lang="ts" setup>
import { onMounted } from 'vue'

import { hydrateTelemetryQueueFromIndexedDb } from '@/utils/generalTools'

onMounted(() => {
  void hydrateTelemetryQueueFromIndexedDb()
})
</script>

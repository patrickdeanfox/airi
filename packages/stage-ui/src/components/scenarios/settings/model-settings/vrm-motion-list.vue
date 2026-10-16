<script setup lang="ts">
import type { Emotion } from '../../../../constants/emotions'

import { errorMessageFrom } from '@moeru/std'
import { Button, IconButton, Select } from '@proj-airi/ui'
import { useFileDialog } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { EMOTION_VALUES } from '../../../../constants/emotions'
import { useSettings } from '../../../../stores/settings'
import { useVrmAnimationsStore } from '../../../../stores/vrm-animations'

/** The select value for "no linked emotion". Reka select items cannot use an empty string. */
const noEmotion = 'none'

const { t } = useI18n()
const vrmAnimationsStore = useVrmAnimationsStore()
const { animations } = storeToRefs(vrmAnimationsStore)
const { stageModelSelected } = storeToRefs(useSettings())

const importError = ref('')
const motions = computed(() => animations.value
  .filter(animation => animation.modelId === stageModelSelected.value)
  .sort((a, b) => a.name.localeCompare(b.name)))
const emotionOptions = computed(() => [
  { label: t('settings.vrm.motions.emotion-none'), value: noEmotion },
  ...EMOTION_VALUES.map(emotion => ({ label: emotion, value: emotion })),
])

const vrmaDialog = useFileDialog({ accept: '.vrma', multiple: true, reset: true })
vrmaDialog.onChange(async (files) => {
  if (!files)
    return

  importError.value = ''
  try {
    for (const file of Array.from(files))
      await vrmAnimationsStore.add(stageModelSelected.value, file)
  }
  catch (error) {
    importError.value = errorMessageFrom(error) ?? t('settings.vrm.motions.import-failed')
  }
})

function setEmotion(id: string, value: unknown) {
  void vrmAnimationsStore.setEmotion(id, value === noEmotion ? undefined : value as Emotion)
}

onMounted(() => {
  vrmAnimationsStore.load().catch(error => console.warn('[VRM motions] Failed to load motions:', error))
})
</script>

<template>
  <div :class="['flex flex-col gap-3']">
    <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
      {{ t('settings.vrm.motions.description') }}
    </p>

    <div :class="['flex items-center gap-3']">
      <Button @click="vrmaDialog.open()">
        {{ t('settings.vrm.motions.import') }}
      </Button>
      <span v-if="importError" :class="['text-sm text-red-500']">{{ importError }}</span>
    </div>

    <p v-if="motions.length === 0" :class="['text-sm opacity-60']">
      {{ t('settings.vrm.motions.empty') }}
    </p>

    <div
      v-for="motion in motions"
      :key="motion.id"
      :class="[
        'flex flex-col gap-2 rounded-xl px-3 py-3',
        'bg-neutral-100/70 dark:bg-neutral-800/60',
      ]"
    >
      <div :class="['flex items-center justify-between gap-3']">
        <code :class="['min-w-0 truncate text-sm font-medium']">{{ motion.name }}</code>
        <div :class="['flex items-center gap-1']">
          <IconButton
            icon="i-mingcute:play-fill"
            :aria-label="t('settings.vrm.motions.play')"
            :class="['size-8 rounded-lg text-lg opacity-60 hover:opacity-100']"
            @click="vrmAnimationsStore.requestPlay(motion.id)"
          />
          <IconButton
            icon="i-solar:trash-bin-trash-bold-duotone"
            :aria-label="t('settings.vrm.motions.remove')"
            :class="['size-8 rounded-lg text-lg opacity-60 hover:opacity-100']"
            @click="vrmAnimationsStore.remove(motion.id)"
          />
        </div>
      </div>
      <div :class="['flex items-center gap-3 text-xs']">
        <span :class="['shrink-0 opacity-60']">{{ t('settings.vrm.motions.emotion') }}</span>
        <Select
          :model-value="motion.emotion ?? noEmotion"
          :options="emotionOptions"
          @update:model-value="setEmotion(motion.id, $event)"
        />
      </div>
    </div>
  </div>
</template>

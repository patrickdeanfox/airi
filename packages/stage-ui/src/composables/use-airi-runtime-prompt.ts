import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { EMOTION_EmotionMotionName_value, EMOTION_VALUES } from '../constants/emotions'
import { useSettings } from '../stores/settings'
import { useVrmAnimationsStore } from '../stores/vrm-animations'

const RUNTIME_PROMPT_KEYS = [
  'base.prompt.emotion',
  'base.prompt.emoji',
  'base.prompt.suffix',
]

/** Returns the localized emotion, action, and emoji prompt for each model request. */
export function useAiriRuntimePrompt() {
  const { locale, t, te } = useI18n()
  const { stageModelRenderer, stageModelSelected } = storeToRefs(useSettings())
  const { animations } = storeToRefs(useVrmAnimationsStore())

  /** The VRM motions of the shown model. The character plays one with the ACT `motion` field. */
  const motionList = computed(() => stageModelRenderer.value === 'vrm'
    ? animations.value
        .filter(animation => animation.modelId === stageModelSelected.value)
        .map(animation => `- ${animation.name}`)
        .join('\n')
    : '')

  return computed(() => {
    if (!RUNTIME_PROMPT_KEYS.every(key => te(key, locale.value)))
      return ''

    return [
      t('base.prompt.emotion'),
      EMOTION_VALUES
        .map(emotion => `- ${emotion} (Emotion for feeling ${EMOTION_EmotionMotionName_value[emotion]})`)
        .join('\n'),
      t('base.prompt.suffix'),
      ...(motionList.value ? [motionList.value] : []),
      t('base.prompt.emoji'),
    ].join('\n\n')
  })
}

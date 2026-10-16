<script setup lang="ts">
import type { WeatherLocation } from '@proj-airi/stage-ui/stores/modules/weather'

import { errorMessageFrom } from '@moeru/std'
import { useWeatherStore } from '@proj-airi/stage-ui/stores/modules/weather'
import { Button, Callout, FieldCheckbox, FieldInput, GhostButton, SettingsCard } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { searchLocations } from '../../../stores/tools/builtin/weather-api'

const { t } = useI18n()
const { homeLocation, reactionsEnabled } = storeToRefs(useWeatherStore())

const query = ref('')
const results = ref<WeatherLocation[]>()
const searching = ref(false)
const error = ref('')

function tn(key: string) {
  return t(`settings.pages.modules.weather.${key}`)
}

function describe(location: WeatherLocation) {
  return [location.name, location.region, location.country].filter(Boolean).join(', ')
}

async function onSearch() {
  searching.value = true
  error.value = ''
  try {
    results.value = await searchLocations(query.value.trim())
  }
  catch (searchError) {
    error.value = errorMessageFrom(searchError) ?? tn('search-failed')
  }
  finally {
    searching.value = false
  }
}

function onPick(location: WeatherLocation) {
  homeLocation.value = location
  results.value = undefined
  query.value = ''
}
</script>

<template>
  <SettingsCard>
    <Callout
      v-if="homeLocation"
      theme="lime"
      :label="`${tn('home')}: ${describe(homeLocation)}`"
    />

    <FieldInput
      v-model="query"
      :label="tn('search.label')"
      :description="tn('search.description')"
      :placeholder="tn('search.placeholder')"
      autocomplete="off"
    />

    <div :class="['flex flex-row items-center gap-3']">
      <Button :disabled="searching || query.trim().length < 2" @click="onSearch">
        {{ tn('search.action') }}
      </Button>
      <span v-if="error" :class="['text-sm text-red-500']">{{ error }}</span>
      <span v-else-if="results?.length === 0" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('search.empty') }}
      </span>
    </div>

    <div v-if="results?.length" :class="['flex flex-col items-start gap-1']">
      <GhostButton
        v-for="location in results"
        :key="`${location.latitude},${location.longitude}`"
        @click="onPick(location)"
      >
        {{ describe(location) }}
      </GhostButton>
    </div>

    <FieldCheckbox
      v-model="reactionsEnabled"
      :label="tn('reactions.label')"
      :description="tn('reactions.description')"
    />
  </SettingsCard>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.weather.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>

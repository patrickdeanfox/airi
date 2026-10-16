import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { StorageSerializers } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed } from 'vue'

/** A place on the map, as the geocoding search returns it. */
export interface WeatherLocation {
  name: string
  /** State or province, for example `Colorado`. */
  region?: string
  country: string
  latitude: number
  longitude: number
}

/**
 * Settings for the weather module.
 *
 * The desktop app owns the weather tool and the reaction watcher. This store holds only what the user chooses, so the
 * modules list can show the module as configured.
 */
export const useWeatherStore = defineStore('weather', () => {
  const homeLocation = useLocalStorageManualReset<WeatherLocation | null>('settings/weather/home-location', null, { serializer: StorageSerializers.object })
  const reactionsEnabled = useLocalStorageManualReset<boolean>('settings/weather/reactions-enabled', false)

  const configured = computed(() => homeLocation.value != null)

  return { homeLocation, reactionsEnabled, configured }
})

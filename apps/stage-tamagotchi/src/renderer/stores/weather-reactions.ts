import { errorMessageFrom } from '@moeru/std'
import { useCharacterOrchestratorStore } from '@proj-airi/stage-ui/stores/character'
import { useWeatherStore } from '@proj-airi/stage-ui/stores/modules/weather'
import { nanoid } from 'nanoid'

import { fetchWeather } from './tools/builtin/weather-api'

const checkIntervalMs = 15 * 60_000

/**
 * Tells the character when the weather at home changes, so she can react to it, for example with a sad face when
 * rain starts. The character picks the emotion herself, through the same reply path as a task reminder.
 *
 * The first reading after start only sets the baseline, so a restart does not make her comment on the weather.
 * Only the leader window checks, so one change makes one reaction.
 *
 * Returns a function that stops the checks.
 */
export function startWeatherReactions(isLeader: () => boolean): () => void {
  const weather = useWeatherStore()
  const orchestrator = useCharacterOrchestratorStore()
  let lastConditionCode: string | undefined

  async function check() {
    const home = weather.homeLocation
    if (!weather.reactionsEnabled || !home || !isLeader())
      return

    try {
      const { current } = await fetchWeather(home, 1)
      const changed = lastConditionCode !== undefined && lastConditionCode !== current.conditionCode
      lastConditionCode = current.conditionCode
      if (!changed)
        return

      const id = nanoid()
      await orchestrator.handleSparkNotify({
        type: 'spark:notify',
        source: 'weather',
        data: {
          id,
          eventId: id,
          kind: 'ping',
          urgency: 'soon',
          headline: `The weather at home changed: ${current.condition}, ${current.temperature}.`,
          note: 'React in one short sentence, in character, and show how this weather makes you feel.',
          destinations: ['character'],
        },
      })
    }
    catch (error) {
      console.warn('[weather] Failed to check the weather at home:', errorMessageFrom(error) ?? 'Unknown error')
    }
  }

  void check()
  const timer = setInterval(check, checkIntervalMs)
  return () => clearInterval(timer)
}

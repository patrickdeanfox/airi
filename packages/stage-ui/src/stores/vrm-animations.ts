import type {} from 'pinia-plugin-synced'

import type { Emotion } from '../constants/emotions'

import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { ref } from 'vue'

import { vrmAnimationsRepo } from '../database/repos/vrm-animations.repo'

/** One `.vrma` animation that the user imported for a VRM model. The file stays in device storage. */
export interface VrmAnimation {
  id: string
  /** The display model that the animation belongs to. */
  modelId: string
  /** The name that the character writes in the ACT `motion` field. It comes from the file name. */
  name: string
  /** When set, the animation also plays when the character shows this emotion. */
  emotion?: Emotion
}

/** A request to play an animation on every stage that shows its model. */
export interface VrmAnimationPlayRequest {
  id: string
  requestedAt: number
}

/** Turns `Drink Water.vrma` into `drink_water`, a name that the model can write in an ACT token. */
export function vrmAnimationNameOf(fileName: string) {
  return fileName.replace(/\.vrma$/i, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/**
 * The `.vrma` animations of each VRM model.
 *
 * Device storage is the source of truth. Every change writes storage first and then calls {@link load}, which the
 * leader window runs, so all windows receive the same list. The files never enter the synchronized state.
 */
export const useVrmAnimationsStore = defineStore('vrm-animations', () => {
  const animations = ref<VrmAnimation[]>([])
  const playRequest = ref<VrmAnimationPlayRequest | null>(null)

  async function load() {
    animations.value = await vrmAnimationsRepo.list()
  }

  /** Imports a `.vrma` file. A file with the name of an existing animation of the model replaces it. */
  async function add(modelId: string, file: File) {
    const name = vrmAnimationNameOf(file.name)
    const existing = animations.value.find(animation => animation.modelId === modelId && animation.name === name)
    await vrmAnimationsRepo.save({ id: existing?.id ?? nanoid(), modelId, name, emotion: existing?.emotion }, file)
    await load()
  }

  async function setEmotion(id: string, emotion: Emotion | undefined) {
    const animation = animations.value.find(item => item.id === id)
    if (!animation)
      return

    await vrmAnimationsRepo.save({ ...animation, emotion })
    await load()
  }

  async function remove(id: string) {
    await vrmAnimationsRepo.remove(id)
    await load()
  }

  /** Asks every stage that shows the model of the animation to play it once. */
  async function requestPlay(id: string) {
    playRequest.value = { id, requestedAt: Date.now() }
  }

  async function getFile(id: string) {
    return await vrmAnimationsRepo.getFile(id)
  }

  return { animations, playRequest, load, add, setEmotion, remove, requestPlay, getFile }
}, {
  synced: {
    actions: ['load', 'requestPlay'],
    state: true,
  },
})

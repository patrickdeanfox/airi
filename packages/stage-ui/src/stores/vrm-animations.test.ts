import type { VrmAnimation } from './vrm-animations'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Emotion } from '../constants/emotions'
import { useVrmAnimationsStore, vrmAnimationNameOf } from './vrm-animations'

const stored = vi.hoisted(() => new Map<string, { animation: VrmAnimation, file?: Blob }>())

vi.mock('../database/repos/vrm-animations.repo', () => ({
  vrmAnimationsRepo: {
    list: async () => [...stored.values()].map(entry => entry.animation),
    getFile: async (id: string) => stored.get(id)?.file,
    save: async (animation: VrmAnimation, file?: Blob) => {
      stored.set(animation.id, { animation, file: file ?? stored.get(animation.id)?.file })
    },
    remove: async (id: string) => {
      stored.delete(id)
    },
  },
}))

beforeEach(() => {
  stored.clear()
  setActivePinia(createPinia())
})

describe('vrmAnimationNameOf', () => {
  it('turns a file name into a name for the ACT motion field', () => {
    expect(vrmAnimationNameOf('Drink Water.vrma')).toBe('drink_water')
    expect(vrmAnimationNameOf('wave-hello.VRMA')).toBe('wave_hello')
  })
})

describe('useVrmAnimationsStore', () => {
  it('imports a file for a model and keeps the file in storage', async () => {
    const store = useVrmAnimationsStore()
    const file = new File(['vrma'], 'drink_water.vrma')

    await store.add('model-a', file)

    expect(store.animations).toEqual([{ id: expect.any(String), modelId: 'model-a', name: 'drink_water', emotion: undefined }])
    expect(await store.getFile(store.animations[0].id)).toBe(file)
  })

  it('replaces the file of an animation with the same name and keeps its emotion', async () => {
    const store = useVrmAnimationsStore()
    await store.add('model-a', new File(['old'], 'cry.vrma'))
    const [first] = store.animations
    await store.setEmotion(first.id, Emotion.Sad)
    const replacement = new File(['new'], 'cry.vrma')

    await store.add('model-a', replacement)

    expect(store.animations).toEqual([{ id: first.id, modelId: 'model-a', name: 'cry', emotion: Emotion.Sad }])
    expect(await store.getFile(first.id)).toBe(replacement)
  })

  it('keeps animations with the same name on different models apart', async () => {
    const store = useVrmAnimationsStore()

    await store.add('model-a', new File(['a'], 'wave.vrma'))
    await store.add('model-b', new File(['b'], 'wave.vrma'))

    expect(store.animations.map(animation => animation.modelId).sort()).toEqual(['model-a', 'model-b'])
  })

  it('removes an animation and its file', async () => {
    const store = useVrmAnimationsStore()
    await store.add('model-a', new File(['a'], 'wave.vrma'))
    const [animation] = store.animations

    await store.remove(animation.id)

    expect(store.animations).toEqual([])
    expect(await store.getFile(animation.id)).toBeUndefined()
  })
})

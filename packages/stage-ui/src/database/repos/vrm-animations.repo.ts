import type { VrmAnimation } from '../../stores/vrm-animations'

import localforage from 'localforage'

const entries = localforage.createInstance({ name: 'airi-vrm-animations', storeName: 'entries' })
const files = localforage.createInstance({ name: 'airi-vrm-animations', storeName: 'files' })

/** Device storage for the `.vrma` animations that the user imports for VRM models. */
export const vrmAnimationsRepo = {
  async list() {
    const animations: VrmAnimation[] = []
    await entries.iterate<VrmAnimation, void>((animation) => {
      animations.push(animation)
    })
    return animations
  },
  async getFile(id: string) {
    return await files.getItem<Blob>(id) ?? undefined
  },
  async save(animation: VrmAnimation, file?: Blob) {
    if (file)
      await files.setItem(animation.id, file)
    await entries.setItem(animation.id, animation)
  },
  async remove(id: string) {
    await entries.removeItem(id)
    await files.removeItem(id)
  },
}

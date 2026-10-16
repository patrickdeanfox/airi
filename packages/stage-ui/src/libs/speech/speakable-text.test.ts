import { describe, expect, it } from 'vitest'

import { toSpeakableText } from './speakable-text'

describe('toSpeakableText', () => {
  it('removes bold and italic asterisks', () => {
    expect(toSpeakableText('**Shop Lights** are *on*.')).toBe('Shop Lights are on.')
  })

  it('removes narration markers and keeps their words', () => {
    expect(toSpeakableText('*smiles* Done, Master.')).toBe('smiles Done, Master.')
  })

  it('keeps the visible text of links and images', () => {
    expect(toSpeakableText('Read [the guide](https://example.com) and ![a cat](cat.png).')).toBe('Read the guide and a cat.')
  })

  it('removes headings, quotes and bullets at a line start', () => {
    expect(toSpeakableText('# Lights\n- Kitchen\n* Hall\n> note')).toBe('Lights\nKitchen\nHall\nnote')
  })

  it('removes underscore emphasis but keeps identifiers', () => {
    expect(toSpeakableText('_really_ check light.shop_lights')).toBe('really check light.shop_lights')
  })

  it('removes backticks and keeps the code text', () => {
    expect(toSpeakableText('Run `lab brief` now.')).toBe('Run lab brief now.')
  })

  it('keeps plain text unchanged', () => {
    expect(toSpeakableText('Yes, Master.')).toBe('Yes, Master.')
  })
})

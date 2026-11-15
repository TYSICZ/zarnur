import { describe, expect, it } from 'vitest'
import { choosePreferredZarnurModel, type ZarnurChatModel } from './zarnur-chat-model.js'

function model(platform: string, access: ZarnurChatModel['access'], modelId = `${platform}-model`): ZarnurChatModel {
  return {
    platform,
    provider: platform,
    modelId,
    displayName: modelId,
    access,
    ...(access === 'member' ? { modelDbId: 1 } : {}),
  }
}

describe('choosePreferredZarnurModel', () => {
  it('uses automatic routing when administrator-shared models are available', () => {
    const groq = model('groq', 'member')
    const guest = model('kilo', 'guest')
    const google = model('google', 'member')

    expect(choosePreferredZarnurModel([groq, guest, google])).toMatchObject({
      access: 'automatic',
      platform: 'automatic',
    })
  })

  it('uses the recommended guest model when no shared models are available', () => {
    const fallback = model('kilo', 'guest')
    const recommended = model('kilo', 'guest', 'nvidia/nemotron-3.5-lightning:free')

    expect(choosePreferredZarnurModel([fallback, recommended])).toBe(recommended)
    expect(choosePreferredZarnurModel([])).toBeUndefined()
  })
})

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
  it('prefers an administrator-shared Google model, then Groq, before guest models', () => {
    const groq = model('groq', 'member')
    const guest = model('kilo', 'guest')
    const google = model('google', 'member')

    expect(choosePreferredZarnurModel([groq, guest, google])).toBe(google)
  })

  it('uses shared Groq when Google is not shared', () => {
    const groq = model('groq', 'member')
    const guest = model('kilo', 'guest')

    expect(choosePreferredZarnurModel([guest, groq])).toBe(groq)
  })

  it('keeps the recommended guest model as the fallback when no member model is shared', () => {
    const fallback = model('kilo', 'guest')
    const recommended = model('kilo', 'guest', 'nvidia/nemotron-3.5-lightning:free')

    expect(choosePreferredZarnurModel([fallback, recommended])).toBe(recommended)
    expect(choosePreferredZarnurModel([])).toBeUndefined()
  })
})

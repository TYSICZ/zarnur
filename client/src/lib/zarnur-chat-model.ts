export interface ZarnurChatModel {
  platform: string
  provider: string
  modelId: string
  displayName: string
  access: 'guest' | 'member'
  modelDbId?: number
}

const DEFAULT_GUEST_MODEL = 'nvidia/nemotron-3.5-lightning:free'

export function choosePreferredZarnurModel(models: readonly ZarnurChatModel[]): ZarnurChatModel | undefined {
  const memberModels = models.filter(model => model.access === 'member')
  const preferredMemberModel = memberModels.find(model => model.platform === 'google')
    ?? memberModels.find(model => model.platform === 'groq')
    ?? memberModels[0]
  if (preferredMemberModel) return preferredMemberModel

  const guestModels = models.filter(model => model.access === 'guest')
  return guestModels.find(model => model.modelId === DEFAULT_GUEST_MODEL) ?? guestModels[0]
}

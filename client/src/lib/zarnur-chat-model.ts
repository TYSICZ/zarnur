export interface ZarnurChatModel {
  platform: string
  provider: string
  modelId: string
  displayName: string
  access: 'guest' | 'member' | 'automatic'
  modelDbId?: number
}

const DEFAULT_GUEST_MODEL = 'nvidia/nemotron-3.5-lightning:free'
const AUTOMATIC_MODEL: ZarnurChatModel = {
  platform: 'automatic',
  provider: 'Zarnur',
  modelId: 'automatic',
  displayName: 'Avtomatik yo‘naltirish',
  access: 'automatic',
}

export function choosePreferredZarnurModel(models: readonly ZarnurChatModel[]): ZarnurChatModel | undefined {
  const memberModels = models.filter(model => model.access === 'member')
  if (memberModels.length > 0) return AUTOMATIC_MODEL

  const guestModels = models.filter(model => model.access === 'guest')
  return guestModels.find(model => model.modelId === DEFAULT_GUEST_MODEL) ?? guestModels[0]
}

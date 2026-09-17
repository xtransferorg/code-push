import { UpdateCheckResponse } from '../../../nativeCodePush/http/entity/UpdateCheckResponse'

export type BatchUpdateCheckResponse = {
  updateInfos: UpdateInfo[];
}

export type UpdateInfo = {
  deploymentKey: string
  updateInfo: UpdateCheckResponse
}
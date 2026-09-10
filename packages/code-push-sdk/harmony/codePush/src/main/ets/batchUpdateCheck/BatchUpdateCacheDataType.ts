import { UpdateCheckResponse } from '../nativeCodePush/http/entity/UpdateCheckResponse'

export interface BatchUpdateCacheItem {
	updateInfo: UpdateCheckResponse
	cachedAt: number
}

export type BatchUpdateCacheDataType = Record<string, BatchUpdateCacheItem>
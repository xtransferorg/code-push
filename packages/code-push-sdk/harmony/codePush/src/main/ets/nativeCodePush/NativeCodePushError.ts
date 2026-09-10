import { NativeCodePushStage } from "./NativeCodePushStage";

export class NativeCodePushError extends Error {
  stage: NativeCodePushStage = null
  code: number
  message: string
  err: any

  constructor(stage: NativeCodePushStage, code: number, message: string, err?: any) {
    super();
    this.stage = stage
    this.code = code
    this.message = message
    this.err = err
  }
}

export const NativeCodePushCommonCode = {
  UNKNOWN_ERROR: 1001,
  HTTP_ERROR: 1002,
}

export const NativeCodeSyncHttpCode = {
  NULL_RESPONSE: 2001,
}
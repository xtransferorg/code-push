/*
 * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
 * Use of this source code is governed by a MIT license that can be
 * found in the LICENSE file.
 */

export class CodePushInvalidPublicKeyException extends Error {
  cause: Error

  constructor(message: string, cause?: Error) {
    super(message)
    this.name = 'CodePushInvalidPublicKeyException'
    this.cause = cause
    if (cause) {
      this.stack = cause.stack
    }
  }
}

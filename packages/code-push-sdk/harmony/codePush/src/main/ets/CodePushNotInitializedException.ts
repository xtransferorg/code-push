/*
 * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
 * Use of this source code is governed by a MIT license that can be
 * found in the LICENSE file.
 */

export class CodePushNotInitializedException extends Error {
  cause: Error

  constructor(message: string, cause?: Error) {
    super(message)

    // 设置异常堆栈跟踪，如果提供了原因（cause）。
    if (cause) {
      this.cause = cause
      this.stack = cause.stack
    }

    // 设置异常名称，用于识别异常类型。
    this.name = 'CodePushNotInitializedException'
  }
}

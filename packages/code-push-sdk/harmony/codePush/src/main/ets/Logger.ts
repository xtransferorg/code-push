/*
 * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
 * Use of this source code is governed by a MIT license that can be
 * found in the LICENSE file.
 */

import hilog from '@ohos.hilog'

class Logger {
  private domain: number
  private prefix: string
  private format: string = '%{public}s, %{public}s'
  private isDebug: boolean

  /**
   * constructor.
   *
   * @param Prefix Identifies the log tag.
   * @param domain Domain Indicates the service domain, which is a hexadecimal integer ranging from 0x0 to 0xFFFFF.
   */
  constructor(
    prefix: string = 'CodePushHarmony',
    domain: number = 0xff0a,
    isDebug = false,
  ) {
    this.prefix = prefix
    this.domain = domain
    this.isDebug = isDebug
  }

  debug(...args: string[]): void {
    if (this.isDebug) {
      hilog.debug(this.domain, this.prefix, this.format, args)
    }
  }

  info(...args: string[]): void {
    hilog.info(this.domain, this.prefix, this.format, args)
  }

  warn(...args: string[]): void {
    hilog.warn(this.domain, this.prefix, this.format, args)
  }

  error(...args: string[]): void {
    hilog.error(this.domain, this.prefix, this.format, args)
  }
}

export default new Logger('CodePushHarmony', 0xff0a, false)

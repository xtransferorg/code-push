/*
 * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
 * Use of this source code is governed by a MIT license that can be
 * found in the LICENSE file.
 */

import fs from '@ohos.file.fs'
import { cryptoFramework } from '@kit.CryptoArchitectureKit'
import { util } from '@kit.ArkTS'
import Logger from './Logger'

const TAG = 'CodePushNativeModule-CodePushUpdateVerifyHash: '

/**
 * 校验 hash 时遍历目录得到的清单条目格式：`<relativePath>:<sha256Hex>`
 */
type ManifestEntry = string

/**
 * 校验失败时附带的原因，便于上层根据原因决定回滚 / 重试策略
 */
export enum VerifyFailReason {
  INVALID_ARGS = 'INVALID_ARGS',           // 入参不合法
  FOLDER_NOT_EXIST = 'FOLDER_NOT_EXIST',   // 目录不存在或不是目录
  EMPTY_MANIFEST = 'EMPTY_MANIFEST',       // 目录为空（被忽略列表过滤干净也算）
  HASH_MISMATCH = 'HASH_MISMATCH',         // hash 算出来了但跟期望不一致
  INTERNAL_ERROR = 'INTERNAL_ERROR',       // 算法过程中抛异常
}

export interface VerifyResult {
  ok: boolean
  reason?: VerifyFailReason
  expectedHash?: string
  actualHash?: string
  fileCount?: number
  error?: string
}

/**
 * CodePush 包目录 hash 校验
 *
 * 算法严格对齐 iOS `CodePushUpdateUtils.verifyFolderHash` / Android 实现 / 服务端 CLI：
 *   1. 递归遍历目录，对每个文件构造 `<relativePath>:<sha256(content)>` 条目；
 *      ".DS_Store" / "__MACOSX/" / ".codepushrelease" 这些路径会被忽略。
 *   2. manifest 数组按字典序升序排序；
 *   3. JSON.stringify(sortedManifest) 得到 manifest 字符串；
 *   4. SHA-256(hex, lowercase) manifest 字符串 → 即为最终 hash；
 *   5. 与 expectedHash 比对。
 *
 * 关键约束（任何一条不对，hash 全错）：
 *   - 路径分隔符必须用 '/'，relativePath 不带前导 '/'
 *   - JSON.stringify 用标准实现，不能借助会改变 '/' 转义的库
 *   - SHA-256 输出必须 lowercase hex
 *   - manifest 排序按 NSString compare: 等价的字典序
 *
 * 设计原则：
 *   - 大文件流式 hash，避免一次性把整份 bundle 读到内存
 *   - 失败不抛异常，统一通过 VerifyResult.reason 表达
 *   - 全程日志可观测，便于定位 hash 不一致的根因
 */
export class CodePushUpdateVerifyHash {
  /** 忽略列表：跟 iOS / Android / CLI 严格一致 */
  private static readonly IGNORE_MACOSX_PREFIX = '__MACOSX/'
  private static readonly IGNORE_DS_STORE = '.DS_Store'
  private static readonly IGNORE_CODEPUSH_METADATA = '.codepushrelease'

  /** 文件流式读 hash 时每次读取的字节数 */
  private static readonly FILE_CHUNK_SIZE = 64 * 1024

  /**
   * 校验 folderPath 的 hash 是否跟 expectedHash 一致
   *
   * @param folderPath    待校验目录（解压 / patch 完成后的包目录）
   * @param expectedHash  服务端下发的期望 hash（lowercase hex）
   * @returns VerifyResult，调用方根据 ok / reason 判断后续处理
   */
  public static async verify(
    folderPath: string,
    expectedHash: string,
  ): Promise<VerifyResult> {
    if (!folderPath || !expectedHash) {
      Logger.error(
        TAG,
        `verify invalid args: folderPath=${folderPath}, expectedHash=${expectedHash}`,
      )
      return {
        ok: false,
        reason: VerifyFailReason.INVALID_ARGS,
        expectedHash,
      }
    }

    Logger.info(TAG, `verify start, folderPath=${folderPath}`)

    try {
      if (!fs.accessSync(folderPath)) {
        Logger.error(TAG, `verify folder not exist: ${folderPath}`)
        return {
          ok: false,
          reason: VerifyFailReason.FOLDER_NOT_EXIST,
          expectedHash,
        }
      }
      if (!fs.statSync(folderPath).isDirectory()) {
        Logger.error(TAG, `verify path is not a directory: ${folderPath}`)
        return {
          ok: false,
          reason: VerifyFailReason.FOLDER_NOT_EXIST,
          expectedHash,
        }
      }

      const manifest: ManifestEntry[] = []
      await CodePushUpdateVerifyHash.addContentsOfFolderToManifest(
        folderPath,
        '',
        manifest,
      )

      if (manifest.length === 0) {
        Logger.error(
          TAG,
          `verify empty manifest after walk, folder=${folderPath}`,
        )
        return {
          ok: false,
          reason: VerifyFailReason.EMPTY_MANIFEST,
          expectedHash,
          fileCount: 0,
        }
      }

      const actualHash =
        await CodePushUpdateVerifyHash.computeFinalHashFromManifest(manifest)

      const matched = actualHash === expectedHash
      Logger.info(
        TAG,
        `verify done: matched=${matched}, files=${manifest.length}, expected=${expectedHash}, actual=${actualHash}`,
      )

      return {
        ok: matched,
        reason: matched ? undefined : VerifyFailReason.HASH_MISMATCH,
        expectedHash,
        actualHash,
        fileCount: manifest.length,
      }
    } catch (e) {
      const errStr = JSON.stringify(e) ?? String(e)
      Logger.error(TAG, `verify internal error: ${errStr}`)
      return {
        ok: false,
        reason: VerifyFailReason.INTERNAL_ERROR,
        expectedHash,
        error: errStr,
      }
    }
  }

  /**
   * 简化签名：直接返回 boolean。失败原因只能从日志查。
   *
   * 一般业务推荐用 verify(...) 拿到 reason 后差异化处理。
   */
  public static async verifyFolderHash(
    folderPath: string,
    expectedHash: string,
  ): Promise<boolean> {
    const r = await CodePushUpdateVerifyHash.verify(folderPath, expectedHash)
    return r.ok
  }

  /** 路径是否落在忽略列表（不参与 hash 计算） */
  private static isHashIgnored(relativePath: string): boolean {
    return (
      relativePath.startsWith(CodePushUpdateVerifyHash.IGNORE_MACOSX_PREFIX) ||
        relativePath === CodePushUpdateVerifyHash.IGNORE_DS_STORE ||
        relativePath.endsWith('/' + CodePushUpdateVerifyHash.IGNORE_DS_STORE) ||
        relativePath === CodePushUpdateVerifyHash.IGNORE_CODEPUSH_METADATA ||
        relativePath.endsWith(
          '/' + CodePushUpdateVerifyHash.IGNORE_CODEPUSH_METADATA,
        )
    )
  }

  /**
   * 递归遍历 folderPath，把每个文件按 `<relativePath>:<sha256>` 加入 manifest
   *
   * @param folderPath  当前递归目录的绝对路径
   * @param pathPrefix  相对最初目录的前缀（顶层为空串）
   * @param manifest    输出参数：清单条目数组
   */
  private static async addContentsOfFolderToManifest(
    folderPath: string,
    pathPrefix: string,
    manifest: ManifestEntry[],
  ): Promise<void> {
    if (!fs.accessSync(folderPath)) {
      throw new Error(`folder not exist: ${folderPath}`)
    }
    if (!fs.statSync(folderPath).isDirectory()) {
      throw new Error(`not a directory: ${folderPath}`)
    }

    const entries = fs.listFileSync(folderPath, { recursion: false })

    for (const name of entries) {
      const fullFilePath = `${folderPath}/${name}`
      const relativePath =
        pathPrefix.length === 0 ? name : `${pathPrefix}/${name}`

      if (CodePushUpdateVerifyHash.isHashIgnored(relativePath)) {
        Logger.info(TAG, `skip ignored entry: ${relativePath}`)
        continue
      }

      let st: fs.Stat
      try {
        st = fs.statSync(fullFilePath)
      } catch (e) {
        throw new Error(
          `stat failed: ${fullFilePath}, err=${JSON.stringify(e)}`,
        )
      }

      if (st.isDirectory()) {
        await CodePushUpdateVerifyHash.addContentsOfFolderToManifest(
          fullFilePath,
          relativePath,
          manifest,
        )
      } else if (st.isFile()) {
        const fileHash = await CodePushUpdateVerifyHash.sha256OfFile(
          fullFilePath,
        )
        manifest.push(`${relativePath}:${fileHash}`)
      } else {
        Logger.info(TAG, `skip non-regular entry: ${fullFilePath}`)
      }
    }
  }

  /** 按 manifest 数组算出最终 hash */
  private static async computeFinalHashFromManifest(
    manifest: ManifestEntry[],
  ): Promise<string> {
    const sorted = manifest.slice().sort()
    const json = JSON.stringify(sorted)
    return await CodePushUpdateVerifyHash.sha256OfString(json)
  }

  /**
   * SHA-256 哈希一个文件，**流式**读取每 64KB 喂给 md.update，避免大文件 OOM
   *
   * @returns lowercase hex
   */
  private static async sha256OfFile(filePath: string): Promise<string> {
    const md = cryptoFramework.createMd('SHA256')
    const file = fs.openSync(filePath, fs.OpenMode.READ_ONLY)
    try {
      const buf = new ArrayBuffer(CodePushUpdateVerifyHash.FILE_CHUNK_SIZE)
      while (true) {
        const readLen = fs.readSync(file.fd, buf, {
          length: CodePushUpdateVerifyHash.FILE_CHUNK_SIZE,
        })
        if (readLen <= 0) {
          break
        }
        const chunk = new Uint8Array(buf, 0, readLen)
        await md.update({ data: chunk })
        if (readLen < CodePushUpdateVerifyHash.FILE_CHUNK_SIZE) {
          break
        }
      }
    } finally {
      try {
        fs.closeSync(file)
      } catch (_) {
        // 关闭失败忽略
      }
    }
    const digest = await md.digest()
    return CodePushUpdateVerifyHash.bytesToHex(digest.data)
  }

  /**
   * SHA-256 哈希一段 UTF-8 字符串
   *
   * @returns lowercase hex
   */
  private static async sha256OfString(s: string): Promise<string> {
    const md = cryptoFramework.createMd('SHA256')
    const bytes = new util.TextEncoder('utf-8').encodeInto(s)
    await md.update({ data: bytes })
    const digest = await md.digest()
    return CodePushUpdateVerifyHash.bytesToHex(digest.data)
  }

  /** Uint8Array → lowercase hex string，必须 lowercase 以对齐其他端实现 */
  private static bytesToHex(bytes: Uint8Array): string {
    let s = ''
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]
      if (b < 0x10) {
        s += '0'
      }
      s += b.toString(16)
    }
    return s
  }
}

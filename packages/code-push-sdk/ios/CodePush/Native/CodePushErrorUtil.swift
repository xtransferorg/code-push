//
//  CodePushErrorUtils.swift
//  xtapp
//
//  Created by  xtgq on 2025/7/28.
//  Copyright © 2025 Facebook. All rights reserved.
//

import Foundation

@objcMembers
public class CodePushErrorUtil: NSObject {
  
  private static let defaultDomain = "CodePushError"
  private static let networkDomain = "CodepushNetworkError"
  private static let parseDomain = "CodepushParseError"
  private static let urlDomain = "CodepushUrlError"
  
  // 创建 NSError，默认codepushError 对应的错误码：-1
  @objc public static func generateNSError(_ errorMessage: String, code: Int = -1, domain: String = "CodePushError") -> NSError {
    return generateError(errorMessage, code: code, domain: domain)
  }
  
  /// 生成通用错误
  @objc public static func generateError(_ errorMessage: String) -> NSError {
    return generateError(errorMessage, code: -1, domain: defaultDomain)
  }
  
  /// 生成带自定义错误码的错误
  @objc public static func generateError(_ errorMessage: String, code: Int) -> NSError {
    return generateError(errorMessage, code: code, domain: defaultDomain)
  }
  
  /// 生成网络错误
  @objc public static func generateNetworkError(_ errorMessage: String) -> NSError {
    return generateError(errorMessage, code: -101, domain: networkDomain)
  }
  
  /// 生成解析错误
  @objc public static func generateParseError(_ errorMessage: String) -> NSError {
    return generateError(errorMessage, code: -102, domain: parseDomain)
  }
  
  /// 生成url错误
  @objc public static func generateFileError(_ errorMessage: String) -> NSError {
    return generateError(errorMessage, code: -103, domain: urlDomain)
  }
  
  /// 生成带自定义域和错误码的错误
  @objc public static func generateError(_ errorMessage: String,
                                         code: Int,
                                         domain: String) -> NSError {
    let error = NSError(domain: domain, code: code, userInfo: [NSLocalizedDescriptionKey: errorMessage])
    return error
  }
  
}

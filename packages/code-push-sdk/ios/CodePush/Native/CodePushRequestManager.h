//
//  CodePushRequestManager.h
//  xtapp
//
//  Created by  xtgq on 2025/7/11.
//  Copyright © 2025 Facebook. All rights reserved.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void(^RequestCallback)(NSDictionary * _Nullable package, NSError * _Nullable error);


@interface CodePushRequestManager : NSObject


/// 初始化CodePushRequestManager
/// - Parameter configuration: 基础配置信息
- (instancetype)initWithConfiguration:(NSDictionary *)configuration;


/// 调用`updateCheck`检查更新
/// - Parameter currentPackage: 当前的Packgae信息
- (void)queryUpdateWithCurrentPackage:(NSDictionary *)currentPackage staleTime:(nullable NSNumber *)staleTime isPreDownload:(BOOL)isPreDownload callback:(RequestCallback)callback;


/// 上报部署状态
/// - Parameters:
///   - deployedPackage: deployedPackage description
///   - status: status description
///   - previousLabelOrAppVersion: previousLabelOrAppVersion description
///   - previousDeploymentKey: previousDeploymentKey description
///   - callback: callback description
- (void)reportStatusDeploy:(nullable NSDictionary *)deployedPackage status:(nullable NSString *)status previousLabelOrAppVersion:(nullable NSString *)previousLabelOrAppVersion previousDeploymentKey:(nullable NSString *)previousDeploymentKey callback:(RequestCallback)callback;


/// 上报下载状态
/// - Parameters:
///   - downloadedPackage: downloadedPackage description
///   - callback: callback description
- (void)reportStatusDownload:(NSDictionary *)downloadedPackage callback:(RequestCallback)callback;

@end

NS_ASSUME_NONNULL_END

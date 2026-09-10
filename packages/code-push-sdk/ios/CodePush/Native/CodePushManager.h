//
//  CodePushManager.h
//  xtapp
//
//  Created by  xtgq on 2025/7/11.
//  Copyright © 2025 Facebook. All rights reserved.
//

#import <Foundation/Foundation.h>
#import "CodePush.h"
#import <React/RCTBridgeModule.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, CodePushSyncStatus) {
  CodePushSyncStatusUpToDate = 0,
  CodePushSyncStatusUpdateInstalled = 1,
  CodePushSyncStatusUpdateIgnored = 2,
  CodePushSyncStatusUnknownError = 3,
  CodePushSyncStatusSyncInProgress = 4,
  CodePushSyncStatusCheckingForUpdate = 5,
  CodePushSyncStatusAwaitingUserAction = 6,
  CodePushSyncStatusDownloadingPackage = 7,
  CodePushSyncStatusInstallingUpdate = 8,
  CodePushSyncStatusCheckingDone = 9,
  CodePushSyncStatusPatchStart = 10,
  CodePushSyncStatusPatchDone = 11,
  CodePushSyncStatusPatchError = 12,
  CodePushSyncStatusDownloadError = 13,
};

typedef NS_ENUM(NSInteger, CodePushCheckFrequency) {
  CodePushCheckFrequencyNoAppStart = 0,
  CodePushCheckFrequencyNoAppResume = 1,
  CodePushCheckFrequencyManual = 2,
};

typedef void(^CheckForUpdateCompletion)(NSDictionary * _Nullable update, NSError * _Nullable error);

typedef void (^CodePushSyncStatusChangedBlock)(CodePushSyncStatus syncStatus, NSDictionary * _Nullable package, NSError * _Nullable error);

typedef void (^CodePushDownloadProgressBlock)(NSUInteger receivedBytes, NSUInteger totalBytes, NSString *progress, NSDictionary * _Nullable package);

typedef void (^CodePushBinaryVersionMismatchBlock)(NSDictionary * _Nullable updateInfo);

typedef void(^CodePushSyncCompletion)(CodePushSyncStatus syncStatus, NSError * _Nullable error);

@interface CodePushManager : NSObject <RCTBridgeModule>


/// 初始化CodePushManager实例
/// - Parameter codePush: codePush description
- (instancetype)initWithCodePush:(CodePush *)codePush;


/// 获取CodePush基础配置信息
- (NSDictionary *)getConfiguration;


/// 检测更新
/// - Parameters:
///   - deploymentKey: deploymentKey description
///   - binaryVersionMismatch: callback description
- (void)checkForUpdate:(NSString *)deploymentKey
				 isPreDownload:(BOOL)isPreDownload
          staleTime:(nullable NSNumber *)staleTime
 binaryVersionMismatch:(CodePushBinaryVersionMismatchBlock)binaryVersionMismatch
            completion:(CheckForUpdateCompletion)completion;


/// 获取当前的Package信息
- (void)getCurrentPackage:(CheckForUpdateCompletion)completion;


/// 获取更新元数据信息
/// - Parameter updateState: updateState description
- (void)getUpdateMetadata:(CodePushUpdateState)updateState completion:(CheckForUpdateCompletion)completion;


/// bunlde应用加载成功事件
- (nullable NSDictionary *)notifyApplicationReady;


/// 上报状态
- (void)tryReportStatus:(NSDictionary *)statusReport;


/// 检查，下载，更新
- (void)sync:(NSDictionary *)options
      statusChanged:(CodePushSyncStatusChangedBlock _Nullable)statusChanged
    downloadProgress:(CodePushDownloadProgressBlock _Nullable)downloadProgress
binaryVersionMismatch:(CodePushBinaryVersionMismatchBlock _Nullable)binaryMismatch
      syncCompletion:(CodePushSyncCompletion _Nullable)syncCompletion;


- (NSString *)syncStatusToString:(CodePushSyncStatus)syncStatus;


/// codepush 检查更新&下载
/// - Parameters:
///   - options: options description
///   - isPreDownload: 是否是预下载
///   - statusChanged: statusChanged description
///   - downloadProgress: downloadProgress description
///   - binaryMismatch: binaryMismatch description
///   - syncCompletion: syncCompletion description
- (void)checkAndDownload:(NSDictionary *)options
					 isPreDownload:(BOOL)isPreDownload
					 statusChanged:(CodePushSyncStatusChangedBlock)statusChanged
				downloadProgress:(CodePushDownloadProgressBlock)downloadProgress
	 binaryVersionMismatch:(CodePushBinaryVersionMismatchBlock)binaryMismatch
					syncCompletion:(CodePushSyncCompletion)syncCompletion;

@end

NS_ASSUME_NONNULL_END

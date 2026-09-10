//
//  CodePushManager.m
//  xtapp
//
//  Created by  xtgq on 2025/7/11.
//  Copyright © 2025 Facebook. All rights reserved.
//

#import "CodePushManager.h"
#import "CodePush.h"
#import <React/RCTBridge.h>
#import "CodePushRequestManager.h"
#import "CodePushDownloadManager.h"
#import "CodePush-Swift.h"

@interface CodePushManager ()

@property (nonatomic, strong) id resumeObserver;
@property (nonatomic, assign) BOOL syncInProgress;
@property (nonatomic, strong) CodePushRequestManager *sdk;

@property (nonatomic, strong) CodePush *codePush;
@property (nonatomic, strong) CodePushDownloadManager *downloadManager;
@end


@implementation CodePushManager

RCT_EXPORT_MODULE(CodePushManager);

- (instancetype)initWithCodePush:(CodePush *)codePush {
  if (self = [super init]) {
    _codePush = codePush;
  }
  return self;
}

- (NSDictionary *)getConfiguration {
  NSDictionary *codePushConfig = [self.codePush getConfigurationSync];
  return codePushConfig;
}

- (void)checkForUpdate:(NSString *)deploymentKey
				 isPreDownload:(BOOL)isPreDownload
          staleTime:(nullable NSNumber *)staleTime
 binaryVersionMismatch:(CodePushBinaryVersionMismatchBlock)binaryVersionMismatch
            completion:(CheckForUpdateCompletion)completion {
  
  NSDictionary *nativeConfig = [self getConfiguration];
  
  NSMutableDictionary *config = [NSMutableDictionary dictionaryWithDictionary:nativeConfig];
  if (deploymentKey) {
    [config setObject:deploymentKey forKey:@"deploymentKey"];
  }
  
  CPLog(@"开始获取元数据信息");
  __weak __typeof(self) weakSelf = self;
  [self getCurrentPackage:^(NSDictionary * _Nullable localPackage, NSError * _Nullable error) {
    __strong __typeof(weakSelf) strongSelf = weakSelf;
    
    if (error) {
      completion(nil, error);
      return;
    }
    
    // 异步数据获取成功，才走下面流程
    NSMutableDictionary *queryPackage = [NSMutableDictionary dictionary];
    if (localPackage) {
      queryPackage = [localPackage mutableCopy];
    } else {
      NSString *appVersion = config[@"appVersion"];
      [queryPackage setObject:appVersion forKey:@"appVersion"];
      
      NSString *packageHash = config[@"packageHash"] ?: @"";
      if (packageHash && packageHash.length > 0) {
        [queryPackage setObject:packageHash forKey:@"packageHash"];
      }
    }
    
    NSMutableDictionary *newQueryPackage = [NSMutableDictionary dictionaryWithDictionary:queryPackage];
    NSString *basePackageHash = nativeConfig[@"packageHash"] ?: @"";
    [newQueryPackage setObject:basePackageHash forKey:@"basePackageHash"];
    
    CPLog(@"开始调updateCheck接口检查更新");
    strongSelf.sdk = [strongSelf getPromisifiedSdk:config];
      [strongSelf.sdk queryUpdateWithCurrentPackage:newQueryPackage staleTime:staleTime isPreDownload:isPreDownload callback:^(NSDictionary * _Nullable update, NSError * _Nullable error) {
      __strong __typeof(weakSelf) innerStrong = weakSelf;
      
      if (error) {
        completion(nil, error);
        return;
      } else {
        
        BOOL updateAppVersion = [update[@"updateAppVersion"] boolValue];
        NSString *packageHash = update[@"packageHash"];
        NSString *localPackageHash = localPackage[@"packageHash"];
        BOOL isDebugOnly = [localPackage[@"_isDebugOnly"] boolValue];
        NSString *configPackageHash = config[@"packageHash"];
        
        /*
         * There are four cases where checkForUpdate will resolve to null:
         * ----------------------------------------------------------------
         * 1) The server said there isn't an update. This is the most common case.
         * 2) The server said there is an update but it requires a newer binary version.
         *    This would occur when end-users are running an older app store version than
         *    is available, and CodePush is making sure they don't get an update that
         *    potentially wouldn't be compatible with what they are running.
         * 3) The server said there is an update, but the update's hash is the same as
         *    the currently running update. This should _never_ happen, unless there is a
         *    bug in the server, but we're adding this check just to double-check that the
         *    client app is resilient to a potential issue with the update check.
         * 4) The server said there is an update, but the update's hash is the same as that
         *    of the binary's currently running version. This should only happen in Android -
         *    unlike iOS, we don't attach the binary's hash to the updateCheck request
         *    because we want to avoid having to install diff updates against the binary's
         *    version, which we can't do yet on Android.
         */
        
        CPLog(@"update：%@", @(!update));
        CPLog(@"updateAppVersion：%@", @(updateAppVersion));
        CPLog(@"localPackage：%@", @((localPackage && packageHash == localPackageHash)));
        CPLog(@"configPackageHash：%@", @((!localPackage || isDebugOnly) && configPackageHash == packageHash));
        
        if (!update ||
            updateAppVersion ||
            (localPackage && packageHash == localPackageHash) ||
            ((!localPackage || isDebugOnly) && configPackageHash == packageHash)
            ) {
          
          if (update && updateAppVersion) {
            CPLog(@"An update is available but it is not targeting the binary version of your app.");
            
            if (binaryVersionMismatch) {
              binaryVersionMismatch(update);
            }
          }
          
          CPLog(@"远端更新无结果");
          completion(nil, nil);
          return;
        } else {
          
          NSMutableDictionary *remotePackage = [NSMutableDictionary dictionaryWithDictionary:update];
          [remotePackage setObject:@(NO) forKey:@"isPending"];
          
          NSString *packageHash = remotePackage[@"packageHash"] ?: @"";
          BOOL isFailedHash = [innerStrong.codePush isFailedUpdateSync:packageHash];
          [remotePackage setObject:@(isFailedHash) forKey:@"failedInstall"];
          
          NSString *_deploymentKey = deploymentKey ?: nativeConfig[@"deploymentKey"];
          [remotePackage setObject:_deploymentKey forKey:@"deploymentKey"];
          
          CPLog(@"远端更新有结果:%@", remotePackage);
          completion(remotePackage, nil);
          return;
        }
      }
    }];
  }];
}

- (void)getCurrentPackage:(CheckForUpdateCompletion)completion {
  [self getUpdateMetadata:CodePushUpdateStateLatest completion:completion];
}

/// 获取更新包的元数据信息
/// - Parameters:
///   - updateState: updateState description
///   - completion: completion description
- (void)getUpdateMetadata:(CodePushUpdateState)updateState completion:(CheckForUpdateCompletion)completion {
  
  CodePushUpdateState tmpState = updateState;
  if (updateState != CodePushUpdateStateRunning &&
      updateState != CodePushUpdateStatePending &&
      updateState != CodePushUpdateStateLatest) {
    tmpState = CodePushUpdateStateRunning;
  }
  
  __weak __typeof(self) weakSelf = self;
  [self.codePush getUpdateMetadataSync:tmpState completion:^(NSDictionary *updateMetadata, NSError *error) {
    __strong __typeof(weakSelf) strongSelf = weakSelf;
    
    if (error) {
      completion(nil, error);
      return;
    }
    
    // 获取到更新元数据信息
    if (updateMetadata) {
      NSMutableDictionary *newUpdateMetadata = @{@"isPending": @(NO)}.mutableCopy;
      [newUpdateMetadata addEntriesFromDictionary:updateMetadata];
      
      NSString *packageHash = newUpdateMetadata[@"packageHash"];
      BOOL isFailedHash = [strongSelf.codePush isFailedUpdateSync:packageHash];
      BOOL isFirstRun = [strongSelf.codePush isFirstRunSync:packageHash];
      
      [newUpdateMetadata setObject:@(isFailedHash) forKey:@"failedInstall"];
      [newUpdateMetadata setObject:@(isFirstRun) forKey:@"isFirstRun"];
      
      CPLog(@"元数据信息：%@", newUpdateMetadata);
      completion(newUpdateMetadata, nil);
    } else {
      CPLog(@"不存在元数据信息");
      completion(nil, nil);
    }
  }];
}

- (NSDictionary *)notifyApplicationReady {
  NSDictionary *statusReport = [self notifyApplicationReadyInternal];
  return statusReport;
}

- (NSDictionary *)notifyApplicationReadyInternal {
//  [self.codePush notifyApplicationReadySync];
  
  // Don't wait for this to complete.
  NSDictionary *statusReport = [self.codePush getNewStatusReportSync];
  CPLog(@"获取最新的状态来上报：%@", statusReport);
  if (statusReport) {
    [self tryReportStatus:statusReport];
  }
  
  return statusReport;
}

- (void)tryReportStatus:(NSDictionary *)statusReport {
  NSDictionary *config = [self getConfiguration];
  NSString *previousLabelOrAppVersion = statusReport[@"previousLabelOrAppVersion"];
  NSString *previousDeploymentKey = statusReport[@"previousDeploymentKey"] ?: config[@"deploymentKey"];
  
  __weak __typeof(self) weakSelf = self;
  
  NSString *appVersion = statusReport[@"appVersion"];
  if (appVersion) {
    CPLog(@"开始上报部署状态");
    CPLog(@"Reporting binary update (%@)", appVersion);
    
    self.sdk = [self getPromisifiedSdk:config];
    [self.sdk reportStatusDeploy:nil status:nil previousLabelOrAppVersion:previousLabelOrAppVersion previousDeploymentKey:previousDeploymentKey callback:^(NSDictionary * _Nullable response, NSError * _Nullable error) {
      __strong __typeof(weakSelf) strongSelf = weakSelf;
      
      if (error) {
        CPLog(@"部署状态error: %@", error);
        [strongSelf handleReportStatusError:statusReport];
        return;
      } else {
        CPLog(@"部署状态response: %@", response);
        [strongSelf handleReportStatusSuccess:statusReport];
      }
    }];
  } else {
    NSDictionary *package = statusReport[@"package"];
    NSString *label = package[@"label"];
    NSString *status = statusReport[@"status"];
    if ([status isEqualToString:@"DeploymentSucceeded"]) {
      CPLog(@"Reporting CodePush update success (%@)", label);
    } else {
      CPLog(@"Reporting CodePush update rollback (%@)", label);
      
      NSString *packageHash = package[@"packageHash"];
      [self.codePush setLatestRollbackInfoSync:packageHash];
    }
    
    NSMutableDictionary *newConfig = [NSMutableDictionary dictionaryWithDictionary:config];
    NSString *deploymentKey = package[@"deploymentKey"];
    [newConfig setObject:deploymentKey forKey:@"deploymentKey"];
    
    self.sdk = [self getPromisifiedSdk:newConfig];
    [self.sdk reportStatusDeploy:package status:status previousLabelOrAppVersion:previousLabelOrAppVersion previousDeploymentKey:previousDeploymentKey callback:^(NSDictionary * _Nullable response, NSError * _Nullable error) {
      __strong __typeof(weakSelf) strongSelf = weakSelf;
      
      if (error) {
        CPLog(@"部署状态error: %@", error);
        [strongSelf handleReportStatusError:statusReport];
        return;
      } else {
        CPLog(@"部署状态response: %@", response);
        [strongSelf handleReportStatusSuccess:statusReport];
      }
    }];
  }
}


/// 是否忽略远程更新包
/// - Parameters:
///   - remotePackage: remotePackage description
///   - syncOptions: syncOptions description
- (BOOL)shouldUpdateBeIgnored:(NSDictionary *)remotePackage syncOptions:(NSDictionary *)syncOptions {
  NSDictionary *rollbackRetryOptions = syncOptions[@"rollbackRetryOptions"];
  
  BOOL isFailedPackage = false;
  if (remotePackage) {
    isFailedPackage = [remotePackage[@"failedInstall"] boolValue];
  }
  
  BOOL ignoreFailedUpdates = [syncOptions[@"ignoreFailedUpdates"] boolValue];
  if (!isFailedPackage || !ignoreFailedUpdates) {
    return NO;
  }
  
  if (!rollbackRetryOptions) {
    return YES;
  }
  
  NSMutableDictionary *newRollbackRetryOptions = [NSMutableDictionary dictionary];
  if (![rollbackRetryOptions isKindOfClass:[NSDictionary class]]) {
    [newRollbackRetryOptions addEntriesFromDictionary:[self defaultRollbackRetryOptions]];
  } else {
    [newRollbackRetryOptions addEntriesFromDictionary:[self defaultRollbackRetryOptions]];
    [newRollbackRetryOptions addEntriesFromDictionary:rollbackRetryOptions];
  }
  
  if (![self validateRollbackRetryOptions:newRollbackRetryOptions]) {
    return YES;
  }
  
  NSDictionary *latestRollbackInfo = [self.codePush getLatestRollbackInfoSync];
  
  NSString *packageHash = remotePackage[@"packageHash"];
  if (![self validateLatestRollbackInfo:latestRollbackInfo packageHash:packageHash]) {
    CPLog(@"The latest rollback info is not valid.");
    return YES;
  }
  
  NSNumber *delayInHours = newRollbackRetryOptions[@"delayInHours"];
  NSNumber *maxRetryAttempts = newRollbackRetryOptions[@"maxRetryAttempts"];
  
  NSNumber *time = latestRollbackInfo[@"time"];
  NSInteger count = [latestRollbackInfo[@"count"] integerValue];
  NSTimeInterval timeMs = time.doubleValue;
  NSTimeInterval nowMs = [[NSDate date] timeIntervalSince1970] * 1000.0;
  NSTimeInterval hoursSinceLatestRollback = (nowMs - timeMs) / (1000.0 * 60.0 * 60.0);
  
  if (hoursSinceLatestRollback >= [delayInHours doubleValue] &&
      [maxRetryAttempts integerValue] >= count) {
    CPLog(@"Previous rollback should be ignored due to rollback retry options.");
    return NO;
  }
  
  return YES;
}

- (void)sync:(NSDictionary *)options
       statusChanged:(CodePushSyncStatusChangedBlock)statusChanged
    downloadProgress:(CodePushDownloadProgressBlock)downloadProgress
binaryVersionMismatch:(CodePushBinaryVersionMismatchBlock)binaryMismatch
      syncCompletion:(CodePushSyncCompletion)syncCompletion {
  
  if (!options) {
    options = @{};
  }
  
  __block CodePushSyncStatusChangedBlock safeStatusChanged = nil;
  if (statusChanged) {
    safeStatusChanged = ^(CodePushSyncStatus syncStatus, NSDictionary * _Nullable package, NSError * _Nullable error) {
      @try {
        statusChanged(syncStatus, package, error);
      } @catch (NSException *exception) {
        CPLog(@"error: %@", exception);
      }
    };
  }
  
  __block CodePushDownloadProgressBlock safeDownloadProgress = nil;
  if (downloadProgress) {
    safeDownloadProgress = ^(NSUInteger receivedBytes, NSUInteger totalBytes, NSString *persent, NSDictionary * _Nullable package) {
      @try {
        downloadProgress(receivedBytes, totalBytes, persent, package);
      } @catch (NSException *exception) {
        CPLog(@"error: %@", exception);
      }
    };
  }
  
  if (self.syncInProgress) {
    if (safeStatusChanged) {
      safeStatusChanged(CodePushSyncStatusSyncInProgress, nil, nil);
    } else {
      CPLog(@"Sync already in progress.");
    }
    
    if (syncCompletion) {
      syncCompletion(CodePushSyncStatusSyncInProgress, nil);
    }
    return;
  }
  
  self.syncInProgress = YES;
  self.codePush.isNativeSync = YES;
  
  __weak __typeof(self) weakSelf = self;
	[self syncInternal:options statusChanged:safeStatusChanged downloadProgress:safeDownloadProgress binaryVersionMismatch:binaryMismatch syncCompletion:^(CodePushSyncStatus syncStatus, NSError * _Nullable error) {
    __strong __typeof(weakSelf) strongSelf = weakSelf;
    
    strongSelf.syncInProgress = NO;
	strongSelf.codePush.isNativeSync = NO;
    
    if (syncCompletion) {
      syncCompletion(syncStatus, error);
    }
    return;

  }];
}

- (void)syncInternal:(NSDictionary *)options
       statusChanged:(CodePushSyncStatusChangedBlock)statusChanged
    downloadProgress:(CodePushDownloadProgressBlock)downloadProgress
binaryVersionMismatch:(CodePushBinaryVersionMismatchBlock)binaryMismatch
      syncCompletion:(CodePushSyncCompletion)syncCompletion {
  
	[self checkAndDownload:options isPreDownload:NO statusChanged:statusChanged downloadProgress:downloadProgress binaryVersionMismatch:binaryMismatch syncCompletion:syncCompletion];
}

- (void)checkAndDownload:(NSDictionary *)options
					 isPreDownload:(BOOL)isPreDownload
					 statusChanged:(CodePushSyncStatusChangedBlock)statusChanged
				downloadProgress:(CodePushDownloadProgressBlock)downloadProgress
	 binaryVersionMismatch:(CodePushBinaryVersionMismatchBlock)binaryMismatch
					syncCompletion:(CodePushSyncCompletion)syncCompletion {
	
	__block CodePushInstallMode resolvedInstallMode;
	
	NSDictionary *syncOptions = @{
		@"deploymentKey": @"",
		@"ignoreFailedUpdates": @(YES),
		@"rollbackRetryOptions": @{},
		@"installMode": @(CodePushInstallModeOnNextRestart),
		@"mandatoryInstallMode": @(CodePushInstallModeImmediate),
		@"minimumBackgroundDuration": @(0),
	};
	
	NSMutableDictionary *newSyncOptions = [NSMutableDictionary dictionaryWithDictionary:syncOptions];
	[newSyncOptions addEntriesFromDictionary:options];

	CodePushSyncStatusChangedBlock syncStatusChangeCallback = statusChanged;
	
	CPLog(@"开始调用 notifyApplicationReady");
	[self notifyApplicationReady];
	
	NSString *deploymentKey = newSyncOptions[@"deploymentKey"];
	if (!deploymentKey) {
		syncStatusChangeCallback(CodePushSyncStatusUnknownError, nil, nil);
		syncCompletion(CodePushSyncStatusUnknownError, nil);
		return;
	}
	
	CPLog(@"开始调用checkForUpdate");
	syncStatusChangeCallback(CodePushSyncStatusCheckingForUpdate, nil, nil);
	
	__weak __typeof(self) weakSelf = self;
	
  [self checkForUpdate:deploymentKey isPreDownload:isPreDownload staleTime:newSyncOptions[@"staleTime"] binaryVersionMismatch:binaryMismatch completion:^(NSDictionary * _Nullable remotePackage, NSError * _Nullable error) {
		__strong __typeof(weakSelf) strongSelf = weakSelf;
		
		CPLog(@"checkForUpdate结果: %@", remotePackage);
        
        NSMutableDictionary *newRemotePackage = [NSMutableDictionary dictionaryWithDictionary:remotePackage];
        [newRemotePackage setValue:@(isPreDownload) forKey:@"isPreDownloadFlow"];
        
        BOOL isExistPreDownloadPackage = [self isExistPreDownloadPackage:remotePackage];
        if (isExistPreDownloadPackage) {
            [newRemotePackage setValue:@"1" forKey:@"isMandatory"];
            [newRemotePackage setValue:@"1" forKey:@"isPreDownloadPackage"];
        }
        
		syncStatusChangeCallback(CodePushSyncStatusCheckingDone, newRemotePackage.copy, nil);
		
		if (error) {
			CPLog(@"checkForUpdate->error: %@", error.localizedDescription);
			NSError *phaseError = [CodePushErrorUtil generateError:error.localizedDescription code:error.code domain:@"checkForUpdateError"];
			syncStatusChangeCallback(CodePushSyncStatusUnknownError, newRemotePackage.copy, phaseError);
			syncCompletion(CodePushSyncStatusUnknownError, phaseError);
			return;
		}
		
		CPLog(@"开始检测是否忽略更新包");
		BOOL updateShouldBeIgnored = [strongSelf shouldUpdateBeIgnored:remotePackage syncOptions:newSyncOptions];
		CPLog(@"updateShouldBeIgnored: %@", @(updateShouldBeIgnored));
		
		if (!remotePackage || updateShouldBeIgnored) {
			if (updateShouldBeIgnored) {
				CPLog(@"An update is available, but it is being ignored due to having been previously rolled back.");
			}
			
			CPLog(@"没有远程包或者忽略更新case");
			[strongSelf getCurrentPackage:^(NSDictionary * _Nullable currentPackage, NSError * _Nullable error) {
				
				if (error) {
					syncStatusChangeCallback(CodePushSyncStatusUnknownError, newRemotePackage.copy, error);
					syncCompletion(CodePushSyncStatusUnknownError, error);
					return;
				}
				
				BOOL isPending = [currentPackage[@"isPending"] boolValue];
				if (currentPackage && isPending) {
					CPLog(@"CodePushSyncStatusUpdateInstalled");
					syncStatusChangeCallback(CodePushSyncStatusUpdateInstalled, newRemotePackage.copy, nil);
					syncCompletion(CodePushSyncStatusUpdateInstalled, nil);
					return;
				} else {
					CPLog(@"CodePushSyncStatusUpToDate");
					syncStatusChangeCallback(CodePushSyncStatusUpToDate, newRemotePackage.copy, nil);
					syncCompletion(CodePushSyncStatusUpToDate, nil);
					return;
				}
			}];
			
			return;
		} else if (syncOptions[@"updateDialog"]) {
			CPLog(@"更新对话框");
			return;
		} else {
			
            NSString *packageHash = remotePackage[@"packageHash"];
            NSError *err;
            NSDictionary *localPackage = [self.codePush.package getPackage:packageHash error:&err];
            BOOL isExistPreDownloadPackage = [self isExistPreDownloadPackage:remotePackage];
            
			if (isExistPreDownloadPackage) {
				if (isPreDownload) {
					CPLog(@"预下载流程，已经下载过，不再重复下载");
					syncCompletion(CodePushSyncStatusUpdateInstalled, nil);
					return;
				}
                
                NSMutableDictionary *newLocalPackage = [NSMutableDictionary dictionaryWithDictionary:localPackage];
                [newLocalPackage setValue:@"1" forKey:@"isMandatory"];
                [newLocalPackage setValue:@"1" forKey:@"isPreDownloadPackage"];
				
				CPLog(@"sync 流程，已经预下载过，就不在走下载流程，直接走安装流程");
				[strongSelf installPackage:newLocalPackage.copy error:err remotePackage:newRemotePackage.copy newSyncOptions:newSyncOptions resolvedInstallMode:resolvedInstallMode syncStatusChangeCallback:syncStatusChangeCallback syncCompletion:syncCompletion];
				return;
			}
			
			CPLog(@"开始下载");
			syncStatusChangeCallback(CodePushSyncStatusDownloadingPackage, newRemotePackage.copy, nil);
			[strongSelf.downloadManager downloadPackage:newRemotePackage.copy progress:downloadProgress patchState:^(NSString * _Nonnull state, NSNumber * _Nonnull code) {
						__strong __typeof(weakSelf) patchStrongSelf = weakSelf;
				
						NSDictionary *syncStateDic = [patchStrongSelf syncStatus];
						CodePushSyncStatus patchStatus = [syncStateDic[state] intValue];
						if (patchStatus) {
							NSError *error = [CodePushErrorUtil generateError:[NSString stringWithFormat:@"Patch failed. code: %d", code.intValue]];
							syncStatusChangeCallback(patchStatus, newRemotePackage.copy, error);
              // syncCompletion(CodePushSyncStatusPatchError, nil);
							return;
						}
					} completion:^(NSDictionary * _Nullable localPackage, NSError * _Nullable error) {
						__strong __typeof(weakSelf) downloadStrongSelf = weakSelf;
						
						if (isPreDownload) {
							CPLog(@"是codepush预下载流程，不走后续的安装流程");
							syncCompletion(error ? CodePushSyncStatusUnknownError : CodePushSyncStatusUpdateInstalled, error);
							return;
						}

						[downloadStrongSelf installPackage:localPackage error:error remotePackage:remotePackage newSyncOptions:newSyncOptions resolvedInstallMode:resolvedInstallMode syncStatusChangeCallback:syncStatusChangeCallback syncCompletion:syncCompletion];
				}];
			}
	}];
}

- (BOOL)isExistPreDownloadPackage:(NSDictionary *)remotePackage {
    NSString *packageHash = remotePackage[@"packageHash"];
    NSString *expectedBundleName = [NSString stringWithFormat:@"%@.%@", self.codePush.bundleResourceName, self.codePush.bundleResourceExtension];
    
    BOOL isExistPackage = [self.codePush.package bundleFileExists:packageHash expectedBundleName:expectedBundleName];
    
    NSError *err;
    NSDictionary *localPackage = [self.codePush.package getPackage:packageHash error:&err];
    BOOL isPreDownloadFlow = [localPackage[@"isPreDownloadFlow"] boolValue];
    return isExistPackage && localPackage && isPreDownloadFlow;
}

- (void)installPackage:(NSDictionary *)localPackage
								 error:(NSError *)error
				 remotePackage:(NSDictionary *)remotePackage
				newSyncOptions:(NSDictionary *)newSyncOptions
	 resolvedInstallMode:(CodePushInstallMode)resolvedInstallMode
syncStatusChangeCallback:(CodePushSyncStatusChangedBlock)syncStatusChangeCallback 			syncCompletion:(CodePushSyncCompletion)syncCompletion {
	
	if (error) {
		CPLog(@"download->error: %@", error.localizedDescription);
		NSError *phaseError = [CodePushErrorUtil generateError:error.localizedDescription code:error.code domain:@"downloadPackageError"];
		syncStatusChangeCallback(CodePushSyncStatusDownloadError, remotePackage, phaseError);
		syncCompletion(CodePushSyncStatusDownloadError, phaseError);
		return;
	}
	
	BOOL isMandatory = [localPackage[@"isMandatory"] boolValue];
	NSInteger mandatoryInstallMode = [newSyncOptions[@"mandatoryInstallMode"] integerValue];
	NSInteger installMode = [newSyncOptions[@"installMode"] integerValue];
	resolvedInstallMode = isMandatory ? mandatoryInstallMode : installMode;
	
	int minimumBackgroundDuration = [newSyncOptions[@"minimumBackgroundDuration"] intValue];
	
	CPLog(@"开始安装");
	syncStatusChangeCallback(CodePushSyncStatusInstallingUpdate, remotePackage, nil);
	[self.downloadManager installPackage:localPackage installMode:resolvedInstallMode minimumBackgroundDuration:minimumBackgroundDuration completion:^(NSError * _Nullable error) {
//              __strong __typeof(weakSelf) strongSelf = weakSelf;
	
		if (error) {
			CPLog(@"install->error: %@", error.localizedDescription);
			NSError *phaseError = [CodePushErrorUtil generateError:error.localizedDescription code:error.code domain:@"installPackageError"];
			syncStatusChangeCallback(CodePushSyncStatusUnknownError, remotePackage, phaseError);
			syncCompletion(CodePushSyncStatusUnknownError, phaseError);
			return;
		}
	
		syncStatusChangeCallback(CodePushSyncStatusUpdateInstalled, remotePackage, nil);
		syncCompletion(CodePushSyncStatusUpdateInstalled, nil);
		return;
	}];
}

- (BOOL)validateLatestRollbackInfo:(NSDictionary *)latestRollbackInfo packageHash:(NSString *)packageHash {
  if (latestRollbackInfo &&
      latestRollbackInfo[@"time"] &&
      latestRollbackInfo[@"count"] &&
      latestRollbackInfo[@"packageHash"] &&
      [latestRollbackInfo[@"packageHash"] isEqualToString:packageHash]
  ) {
    return YES;
  }
  
  return NO;
}

- (BOOL)validateRollbackRetryOptions:(NSDictionary *)rollbackRetryOptions {
  NSNumber *delayInHours = rollbackRetryOptions[@"delayInHours"];
  NSNumber *maxRetryAttempts = rollbackRetryOptions[@"maxRetryAttempts"];
  
  if (![delayInHours isKindOfClass:[NSNumber class]]) {
    CPLog(@"The 'delayInHours' rollback retry parameter must be a number.");
    return NO;
  }
  
  if (![maxRetryAttempts isKindOfClass:[NSNumber class]]) {
    CPLog(@"The 'maxRetryAttempts' rollback retry parameter must be a number.");
    return NO;
  }
  
  if ([maxRetryAttempts integerValue] < 1) {
    CPLog(@"The 'maxRetryAttempts' rollback retry parameter cannot be less then 1.");
    return NO;
  }
  
  return YES;
}

- (void)handleReportStatusSuccess:(NSDictionary *)statusReport {
  [self.codePush recordStatusReportedSync:statusReport];
  
  // 上报成功后，移除监听
  if (self.resumeObserver) {
    [[NSNotificationCenter defaultCenter] removeObserver:self.resumeObserver];
    self.resumeObserver = nil;
  }
}

- (void)handleReportStatusError:(NSDictionary *)statusReport {
  NSString *statusReportStr = [CPJSONUtils dictionaryToJsonString:statusReport];
  CPLog(@"Report status failed: %@", statusReportStr);
  
  [self.codePush saveStatusReportForRetrySync:statusReport];
  
  if (!self.resumeObserver) {
    __weak typeof(self) weakSelf = self;
    
    __block id observer = nil;
    observer = [[NSNotificationCenter defaultCenter] addObserverForName:UIApplicationDidBecomeActiveNotification object:nil queue:[NSOperationQueue mainQueue] usingBlock:^(NSNotification * _Nonnull notification) {
      __strong typeof(self) strongSelf = weakSelf;
      
      NSDictionary *refreshedStatusReport = [strongSelf.codePush getNewStatusReportSync];
      if (refreshedStatusReport) {
        [strongSelf tryReportStatus:refreshedStatusReport];
      } else {
        if (strongSelf.resumeObserver) {
          [[NSNotificationCenter defaultCenter] removeObserver:strongSelf.resumeObserver];
          strongSelf.resumeObserver = nil;
        }
      }
    }];
    
    self.resumeObserver = observer;
  }
}

- (NSString *)syncStatusToString:(CodePushSyncStatus)syncStatus {
  switch (syncStatus) {
	case CodePushSyncStatusUpToDate:
	  return @"CodePushSyncStatusUpToDate";
	case CodePushSyncStatusUpdateInstalled:
	  return @"CodePushSyncStatusUpdateInstalled";
	case CodePushSyncStatusUpdateIgnored:
	  return @"CodePushSyncStatusUpdateIgnored";
	case CodePushSyncStatusUnknownError:
	  return @"CodePushSyncStatusUnknownError";
	case CodePushSyncStatusSyncInProgress:
	  return @"CodePushSyncStatusSyncInProgress";
	case CodePushSyncStatusCheckingForUpdate:
	  return @"CodePushSyncStatusCheckingForUpdate";
	case CodePushSyncStatusAwaitingUserAction:
	  return @"CodePushSyncStatusAwaitingUserAction";
	case CodePushSyncStatusDownloadingPackage:
	  return @"CodePushSyncStatusDownloadingPackage";
	case CodePushSyncStatusInstallingUpdate:
	  return @"CodePushSyncStatusInstallingUpdate";
	case CodePushSyncStatusCheckingDone:
	  return @"CodePushSyncStatusCheckingDone";
	case CodePushSyncStatusPatchError:
	  return @"CodePushSyncStatusPatchError";
	default:
	  return [NSString stringWithFormat:@"Unknown(%ld)", syncStatus];
  }
}

- (CodePushRequestManager *)getPromisifiedSdk:(NSDictionary *)config {
  CodePushRequestManager *sdk = [[CodePushRequestManager alloc] initWithConfiguration:config];
  return sdk;
}

- (NSDictionary *)installMode {
  return @{
    @"IMMEDIATE": @(CodePushInstallModeImmediate),
    @"ON_NEXT_RESTART": @(CodePushInstallModeOnNextRestart),
    @"ON_NEXT_RESUME": @(CodePushInstallModeOnNextResume),
    @"ON_NEXT_SUSPEND": @(CodePushInstallModeOnNextSuspend),
  };
}

- (NSDictionary *)syncStatus {
  return @{
    @"UP_TO_DATE": @(CodePushSyncStatusUpToDate),
    @"UPDATE_INSTALLED": @(CodePushSyncStatusUpdateInstalled),
    @"UPDATE_IGNORED": @(CodePushSyncStatusUpdateIgnored),
    @"UNKNOWN_ERROR": @(CodePushSyncStatusUnknownError),
    @"SYNC_IN_PROGRESS": @(CodePushSyncStatusSyncInProgress),
    @"CHECKING_FOR_UPDATE": @(CodePushSyncStatusCheckingForUpdate),
    @"AWAITING_USER_ACTION": @(CodePushSyncStatusAwaitingUserAction),
    @"DOWNLOADING_PACKAGE": @(CodePushSyncStatusDownloadingPackage),
    @"INSTALLING_UPDATE": @(CodePushSyncStatusInstallingUpdate),
    @"CHECKING_DONE": @(CodePushSyncStatusCheckingDone),
    @"PATCH_START": @(CodePushSyncStatusPatchStart),
    @"PATCH_DONE": @(CodePushSyncStatusPatchDone),
    @"PATCH_ERROR": @(CodePushSyncStatusPatchError)
  };
}

- (NSDictionary *)checkFrequency {
  return @{
    @"ON_APP_START": @(CodePushCheckFrequencyNoAppStart),
    @"ON_APP_RESUME": @(CodePushCheckFrequencyNoAppResume),
    @"MANUAL": @(CodePushCheckFrequencyManual)
  };
}

- (NSDictionary *)updateState {
  return @{
    @"RUNNING": @(CodePushUpdateStateRunning),
    @"PENDING": @(CodePushUpdateStatePending),
    @"LATEST": @(CodePushUpdateStateLatest)
  };
}

- (NSDictionary *)deploymentStatus {
  return @{
    @"FAILED": @"DeploymentFailed",
    @"SUCCEEDED": @"DeploymentSucceeded"
  };
}

- (NSDictionary *)defaultUpdateDialog {
  return @{
    @"appendReleaseDescription": @(false),
    @"descriptionPrefix": @"Description",
    @"mandatoryContinueButtonLabel": @"Continue",
    @"mandatoryUpdateMessage": @"An update is available that must be installed.",
    @"optionalIgnoreButtonLabel": @"Ignore",
    @"optionalInstallButtonLabel": @"Install",
    @"optionalUpdateMessage": @"An update is available. Would you like to install it?",
    @"title": @"Update available"
  };
}

- (NSDictionary *)defaultRollbackRetryOptions {
  return @{
    @"delayInHours": @(24),
    @"maxRetryAttempts": @(1)
  };
}

- (CodePushDownloadManager *)downloadManager {
  if (!_downloadManager) {
    _downloadManager = [[CodePushDownloadManager alloc] initWithCodePush:self.codePush];
  }
  return _downloadManager;
}

#pragma mark - NativeModules Methods

RCT_EXPORT_METHOD(notifyAppReady:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self notifyApplicationReady];
  resolve(@(YES));
}

- (void)dealloc {
	CPLog(@"🔴 CodePushManager dealloc: %@ ", self);
}

@end

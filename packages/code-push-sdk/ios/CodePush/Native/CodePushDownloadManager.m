//
//  CodePushDownloadManager.m
//  xtapp
//
//  Created by  xtgq on 2025/7/16.
//  Copyright © 2025 Facebook. All rights reserved.
//

#import "CodePushDownloadManager.h"
#import "CodePushRestartManager.h"
#import "CodePushRequestManager.h"
#import "CodePush-Swift.h"

@interface CodePushDownloadManager ()

@property (nonatomic, strong) CodePush *codePush;
@property (nonatomic, strong) CodePushRestartManager *restartManager;
@end

@implementation CodePushDownloadManager {
  int _lastReportedProgress;
  long long _lastReceivedBytes;
}

- (instancetype)initWithCodePush:(CodePush *)codePush {
  if (self = [super init]) {
    _codePush = codePush;
  }
  return self;
}

- (void)downloadPackage:(NSDictionary *)remotePackage progress:(CodePushDownloadProgressBlock)progress patchState:(CodePushPatchStateBlock)patchState completion:(CodePushDownloadBlock)completion {
  
  NSString *downloadUrl = remotePackage[@"downloadUrl"];
  if (!downloadUrl) {
    NSError *error = [CodePushErrorUtil generateError:@"Cannot download an update without a download url"];
    completion(nil, error);
    return;
  }
  
  NSMutableDictionary *copyPackage = [NSMutableDictionary dictionaryWithDictionary:remotePackage];

  __weak __typeof(self) weakSelf = self;
  [self.codePush downloadUpdateSync:copyPackage progress:^(NSUInteger receivedBytes, NSUInteger totalBytes) {
    __strong __typeof(weakSelf) strongSelf = weakSelf;
    
    if (progress) {
      int val = [strongSelf calculateDownloadProgress:receivedBytes total:totalBytes];
      NSString *persent = [NSString stringWithFormat:@"%d", val];
      progress(receivedBytes, totalBytes, persent, remotePackage);
    }
  } patchStatus:^(NSString *state, NSNumber *code) {
    // 处理patch状态
    patchState(state, code);
  } completion:^(NSDictionary *localPackage, NSError *error) {
    __strong __typeof(weakSelf) strongSelf = weakSelf;
    CPLog(@"下载完成");
    
    completion(localPackage, error);
    
    if (error) {
      CPLog(@"下载报错：%@", error.localizedDescription);
      return;
    }
    
    [strongSelf reportStatusDownload:remotePackage];
  }];
}

- (void)installPackage:(NSDictionary *)localPackage
           installMode:(CodePushInstallMode)installMode
minimumBackgroundDuration:(int)minimumBackgroundDuration
            completion:(CodePushInstallBlock)completion {
  
  NSMutableDictionary *copyPackage = [NSMutableDictionary dictionaryWithDictionary:localPackage];
  
  CodePushInstallMode mode = installMode;
  if (mode != CodePushInstallModeImmediate &&
      mode != CodePushInstallModeOnNextRestart &&
      mode != CodePushInstallModeOnNextResume &&
      mode != CodePushInstallModeOnNextSuspend) {
    mode = CodePushInstallModeOnNextRestart;
  }
  
  if (minimumBackgroundDuration < 0) {
    minimumBackgroundDuration = 0;
  }
  
//  __weak __typeof(self) weakSelf = self;
  [self.codePush installUpdateSync:copyPackage installMode:mode minimumBackgroundDuration:minimumBackgroundDuration completion:^(NSError *error) {
//    __strong __typeof(weakSelf) strongSelf = weakSelf;
    
    CPLog(@"安装完成");
    
    completion(error);

    if (error) {
      CPLog(@"安装报错：%@", error.localizedDescription);
      return;
    }
    
      if (mode == CodePushInstallModeImmediate) {
        //  [self.codePush initializeUpdateAfterRestart];
//        [strongSelf.restartManager restartApp:NO];
      } else {
//        [strongSelf.restartManager clearPendingRestart];
      }
  }];
}

- (void)reportStatusDownload:(NSDictionary *)remotePackage {
  CPLog(@"开始上报下载状态");
  
  NSDictionary *config = [self getConfiguration];
  CodePushRequestManager *sdk = [self getPromisifiedSdk:config];
  [sdk reportStatusDownload:remotePackage callback:^(NSDictionary * _Nullable response, NSError * _Nullable error) {
    if (error) {
      CPLog(@"下载状态上报失败");
      CPLog(@"Report download status failed: %@", error.localizedDescription);
      CPLog(@"Report download status failed: %d", error.code);
      return;
    }
    
    CPLog(@"下载状态上报完成");
  }];
}

- (NSDictionary *)getConfiguration {
  NSDictionary *codePushConfig = [self.codePush getConfigurationSync];
  return codePushConfig;
}

- (CodePushRequestManager *)getPromisifiedSdk:(NSDictionary *)config {
  CodePushRequestManager *sdk = [[CodePushRequestManager alloc] initWithConfiguration:config];
  return sdk;
}

- (int)calculateDownloadProgress:(NSUInteger)receivedBytes total:(NSUInteger)totalBytes {
  long long total = totalBytes;
  long long current = receivedBytes;
  
  if (total <= 0) {
    return 0;
  }
  
  if (current <= 0) {
    return 0;
  }
  
  if (current >= total) {
    return 100;
  }
  
  double fraction = (double)current / (double)total;
  int currentProgress = (int)round(fraction * 100.0);
  
  currentProgress = MAX(0, MIN(100, currentProgress));
  
  if (currentProgress < _lastReportedProgress && current >= _lastReceivedBytes) {
    currentProgress = _lastReportedProgress;
  }
  
  _lastReportedProgress = currentProgress;
  _lastReceivedBytes = current;
  
  return currentProgress;
}

- (CodePushRestartManager *)restartManager {
  if (!_restartManager) {
    _restartManager = [[CodePushRestartManager alloc] initWithBridge:[RCTBridge new]];
  }
  return _restartManager;
}

@end

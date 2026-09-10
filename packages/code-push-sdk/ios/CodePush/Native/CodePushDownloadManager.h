//
//  CodePushDownloadManager.h
//  xtapp
//
//  Created by  xtgq on 2025/7/16.
//  Copyright © 2025 Facebook. All rights reserved.
//

#import <Foundation/Foundation.h>
#import "CodePush.h"

NS_ASSUME_NONNULL_BEGIN

typedef void (^CodePushDownloadProgressBlock)(NSUInteger receivedBytes, NSUInteger totalBytes, NSString *persent, NSDictionary * _Nullable package);

typedef void (^CodePushPatchStateBlock)(NSString *state, NSNumber *code);

typedef void (^CodePushDownloadBlock)(NSDictionary * _Nullable localPackage, NSError * _Nullable error);

typedef void (^CodePushInstallBlock)(NSError * _Nullable error);

typedef void(^CodePushDownloadProgressHandle)(NSString *);


@interface CodePushDownloadManager : NSObject


- (instancetype)initWithCodePush:(CodePush *)codePush;


/// 下载
/// - Parameters:
///   - remotePackage: remotePackage description
///   - progress: progress description
///   - completion: completion description
- (void)downloadPackage:(NSDictionary *)remotePackage progress:(CodePushDownloadProgressBlock)progress
    patchState:(CodePushPatchStateBlock)patchState
    completion:(CodePushDownloadBlock)completion;


/// 安装
/// - Parameters:
///   - installMode: installMode description
///   - minimumBackgroundDuration: minimumBackgroundDuration description
///   - completion: completion description
- (void)installPackage:(NSDictionary *)localPackage
installMode:(CodePushInstallMode)installMode minimumBackgroundDuration:(int)minimumBackgroundDuration completion:(CodePushInstallBlock)completion;

@end

NS_ASSUME_NONNULL_END

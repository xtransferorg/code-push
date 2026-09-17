//
//  CodePushRestartManager.h
//  xtapp
//
//  Created by  xtgq on 2025/7/16.
//  Copyright © 2025 Facebook. All rights reserved.
//

#import <Foundation/Foundation.h>
#import "CodePush.h"
#import <React/RCTBridge.h>

NS_ASSUME_NONNULL_BEGIN

@interface CodePushRestartManager : NSObject

@property (nonatomic, weak, readonly) RCTBridge *bridge;

- (instancetype)initWithBridge:(RCTBridge *)bridge;

- (void)allow;
- (void)disallow;
- (void)clearPendingRestart;
- (void)restartApp:(BOOL)onlyIfUpdateIsPending;
@end

NS_ASSUME_NONNULL_END

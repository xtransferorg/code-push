//
//  CodePushRestartManager.m
//  xtapp
//
//  Created by  xtgq on 2025/7/16.
//  Copyright © 2025 Facebook. All rights reserved.
//

#import "CodePushRestartManager.h"

@interface CodePushRestartManager ()

@property (nonatomic, weak) RCTBridge *bridge;
@property (nonatomic, assign) BOOL allowed;
@property (nonatomic, assign) BOOL restartInProgress;
@property (nonatomic, strong) NSMutableArray<NSNumber *> *restartQueue;
@property (nonatomic, strong) dispatch_queue_t syncQueue;
@end

@implementation CodePushRestartManager

- (instancetype)initWithBridge:(RCTBridge *)bridge {
  if (self = [super init]) {
    _bridge = bridge;
    _allowed = YES;
    _restartInProgress = NO;
    _restartQueue = [NSMutableArray array];
    _syncQueue = dispatch_queue_create("xtapp.CodePushRestartManager", DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

- (void)allow {
  dispatch_async(self.syncQueue, ^{
    self.allowed = YES;
    if (self.restartQueue.count > 0) {
      BOOL flag = self.restartQueue.firstObject.boolValue;
      [self.restartQueue removeObjectAtIndex:0];
      [self restartApp:flag];
    }
  });
}

- (void)clearPendingRestart {
  dispatch_async(self.syncQueue, ^{
    [self.restartQueue removeAllObjects];
  });
}

- (void)disallow {
  dispatch_async(self.syncQueue, ^{
    self.allowed = NO;
  });
}

- (void)restartApp:(BOOL)onlyIfUpdateIsPending {
  
  dispatch_async(self.syncQueue, ^{
    
    if (self.restartInProgress) {
      CPLog(@"Restart request queued until the current restart is completed");
      [self.restartQueue addObject:@(onlyIfUpdateIsPending)];
      return;
    }
    
    if (!self.allowed) {
      CPLog(@"Restart request queued until restarts are re-allowed");
      [self.restartQueue addObject:@(onlyIfUpdateIsPending)];
      return;
    }
    
    self.restartInProgress = YES;
    
    CodePush *codepush = nil;
    if (!codepush) { return; }

    __weak __typeof(self) weakSelf = self;
    [codepush restartAppSync:onlyIfUpdateIsPending completion:^(BOOL reloadBundleSuccess) {
      __strong __typeof(weakSelf) strongSelf = weakSelf;
      
      dispatch_async(strongSelf.syncQueue, ^{
        if (reloadBundleSuccess) {
          CPLog(@"Restarting app");
          return;
        }
        
        strongSelf.restartInProgress = NO;
        if (strongSelf.restartQueue.count > 0) {
          BOOL nextFlag = strongSelf.restartQueue.firstObject.boolValue;
          [strongSelf.restartQueue removeObjectAtIndex:0];
          [strongSelf restartApp:nextFlag];
        }
        
      });
    }];
  });
}

@end

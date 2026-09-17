//
//  CodePushCoordinator.h
//  CodePush
//
//  Created by  xtgq on 2026/5/25.
//

#import <Foundation/Foundation.h>
#import "CodePushManager.h"

NS_ASSUME_NONNULL_BEGIN

typedef void(^XTCodePushWaiterBlock)(CodePushSyncStatus syncStatus, NSError * _Nullable error);

@interface CodePushCoordinator : NSObject

+ (instancetype)shared;

- (BOOL)acquireForKey:(NSString *)deploymentKey
							 waiter:(nullable XTCodePushWaiterBlock)waiter;

- (void)finishForKey:(NSString *)deploymentKey
					syncStatus:(CodePushSyncStatus)syncStatus
							 error:(nullable NSError *)error;
@end

NS_ASSUME_NONNULL_END

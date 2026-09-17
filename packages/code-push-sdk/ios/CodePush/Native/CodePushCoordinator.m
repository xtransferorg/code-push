//
//  CodePushCoordinator.m
//  CodePush
//
//  Created by  xtgq on 2026/5/25.
//

#import "CodePushCoordinator.h"
#import <CodePush/CodePush.h>

@implementation CodePushCoordinator {
	dispatch_queue_t _stateQueue;
	NSMutableSet<NSString *> *_checkDownloadFlowRunning;
	NSMutableDictionary<NSString *, NSMutableArray<XTCodePushWaiterBlock> *> *_waiters;
}

+ (instancetype)shared {
	static CodePushCoordinator *instance;
	static dispatch_once_t onceToken;
	dispatch_once(&onceToken, ^{
		instance = [[CodePushCoordinator alloc] _initPrivate];
	});
	return instance;
}

- (instancetype)_initPrivate {
	if (self = [super init]) {
		_stateQueue = dispatch_queue_create("com.xtransfer.xrn.codepush.coordinator", DISPATCH_QUEUE_SERIAL);
		_checkDownloadFlowRunning = [NSMutableSet set];
		_waiters = [NSMutableDictionary dictionary];
	}
	return self;
}

- (BOOL)acquireForKey:(NSString *)deploymentKey
							 waiter:(XTCodePushWaiterBlock)waiter {
	
	if (deploymentKey.length == 0) {
		return YES;
	}

	__block BOOL acquired = NO;
	dispatch_sync(_stateQueue, ^{
		if ([self->_checkDownloadFlowRunning containsObject:deploymentKey]) {
			acquired = NO;
			if (waiter) {
				NSMutableArray<XTCodePushWaiterBlock> *queue = self->_waiters[deploymentKey];
				if (!queue) {
					queue = [NSMutableArray array];
					self->_waiters[deploymentKey] = queue;
				}
				[queue addObject:[waiter copy]];
			}
		} else {
			[self->_checkDownloadFlowRunning addObject:deploymentKey];
			acquired = YES;
		}
	});

	return acquired;
}

- (void)finishForKey:(NSString *)deploymentKey
					syncStatus:(CodePushSyncStatus)syncStatus
							 error:(NSError *)error {
	
	if (deploymentKey.length == 0) {
		return;
	}

	__block NSArray<XTCodePushWaiterBlock> *callbacks = nil;
	__block BOOL checkDownloadFlowRunning = NO;
	
	dispatch_sync(_stateQueue, ^{
		checkDownloadFlowRunning = [self->_checkDownloadFlowRunning containsObject:deploymentKey];
		[self->_checkDownloadFlowRunning removeObject:deploymentKey];

		NSMutableArray<XTCodePushWaiterBlock> *queue = self->_waiters[deploymentKey];
		if (queue.count > 0) {
			callbacks = [queue copy];
		}
		[self->_waiters removeObjectForKey:deploymentKey];
	});

	if (!checkDownloadFlowRunning && callbacks.count == 0) {
		return;
	}

	CPLog(@"CodePushCoordinator: finish： deploymentKey=%@ status=%ld waiter数=%lu",
			deploymentKey, (long)syncStatus, (unsigned long)callbacks.count);

	if (callbacks.count == 0) {
		return;
	}

	dispatch_async(dispatch_get_main_queue(), ^{
		for (XTCodePushWaiterBlock callback in callbacks) {
			@try {
				callback(syncStatus, error);
			} @catch (NSException *exception) {
				CPLog(@"CodePushCoordinator: waiter 抛异常 %@", exception);
			}
		}
	});
}

@end

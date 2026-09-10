#if __has_include(<React/RCTAssert.h>)
#import <React/RCTAssert.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTConvert.h>
#import <React/RCTEventDispatcher.h>
#import <React/RCTRootView.h>
#import <React/RCTUtils.h>
#import <React/RCTReloadCommand.h>
#import <React/RCTBridge+Private.h>
#else // back compatibility for RN version < 0.40
#import "RCTAssert.h"
#import "RCTBridgeModule.h"
#import "RCTConvert.h"
#import "RCTEventDispatcher.h"
#import "RCTRootView.h"
#import "RCTUtils.h"
#endif

#import "CodePush.h"
#import <React/RCTBridgeModule.h>

#ifdef RCT_NEW_ARCH_ENABLED
#import <CodePushSpec/CodePushSpec.h>
#endif

#ifdef RCT_NEW_ARCH_ENABLED
@interface CodePush () <RCTBridgeModule, RCTTurboModule, RCTFrameUpdateObserver>
#else
@interface CodePush () <RCTBridgeModule, RCTFrameUpdateObserver>
#endif

@property (nonatomic, strong) CodePushTelemetryManager *telemetryManager;

@property (nonatomic, strong) NSBundle *bundleResourceBundle;
@property (nonatomic, copy) NSString *bundleResourceSubdirectory;

/// 是否走内置bundle
@property (nonatomic, assign) BOOL isRunningBinaryVersion;

/// 是否需要将回滚操作上报服务器
@property (nonatomic, assign) BOOL needToReportRollback;

// 新增同步patch的回调属性
@property (nonatomic, copy) CodePushPatchStateCallback patchStateCallback;
@end

@implementation CodePush {
    BOOL _hasResumeListener;
    BOOL _isFirstRunAfterUpdate;
    int _minimumBackgroundDuration;
    NSDate *_lastResignedDate;
    CodePushInstallMode _installMode;
    NSTimer *_appSuspendTimer;

    // Used to coordinate the dispatching of download progress events to JS.
    long long _latestExpectedContentLength;
    long long _latestReceivedConentLength;
		long long _latestBaseBundleReceivedConentLength;
    BOOL _didUpdateProgress;
}

#ifdef RCT_NEW_ARCH_ENABLED
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
	return std::make_shared<facebook::react::NativeCodePushSpecJSI>(params);
}
#endif

RCT_EXPORT_MODULE(RTNCodePush)

#pragma mark - Private constants

// These constants represent emitted events
static NSString *const DownloadProgressEvent = @"CodePushDownloadProgress";
static NSString *const CodePushPatchStatus = @"CodePushPatchStatus";

// These constants represent valid deployment statuses
static NSString *const DeploymentFailed = @"DeploymentFailed";
static NSString *const DeploymentSucceeded = @"DeploymentSucceeded";

// These keys represent the names we use to store data in NSUserDefaults
static NSString *const FailedUpdatesKey = @"CODE_PUSH_FAILED_UPDATES";
static NSString *const PendingUpdateKey = @"CODE_PUSH_PENDING_UPDATE";

// These keys are already "namespaced" by the PendingUpdateKey, so
// their values don't need to be obfuscated to prevent collision with app data
static NSString *const PendingUpdateHashKey = @"hash";
static NSString *const PendingUpdateIsLoadingKey = @"isLoading";

// These keys are used to inspect/augment the metadata
// that is associated with an update's package.
static NSString *const AppVersionKey = @"appVersion";
static NSString *const BinaryBundleDateKey = @"binaryDate";
static NSString *const PackageHashKey = @"packageHash";
static NSString *const BasePackageHashKey = @"basePackageHash";
static NSString *const PackageIsPendingKey = @"isPending";

#pragma mark - Static variables

static BOOL testConfigurationFlag = NO;

// These values are used to save the NS bundle, name, extension and subdirectory
// for the JS bundle in the binary.

// These keys represent the names we use to store information about the latest rollback
static NSString *const LatestRollbackInfoKey = @"LATEST_ROLLBACK_INFO";
static NSString *const LatestRollbackPackageHashKey = @"packageHash";
static NSString *const LatestRollbackTimeKey = @"time";
static NSString *const LatestRollbackCountKey = @"count";

#pragma mark - Public Obj-C API

- (NSURL *)binaryBundleURL
{
	CPLog(@"binaryBundleURL：bundleResourceName:%@",self.bundleResourceName);
	CPLog(@"bundleResourceExtension:%@",self.bundleResourceExtension);
	CPLog(@"bundleResourceSubdirectory:%@",self.bundleResourceSubdirectory);
    return [self.bundleResourceBundle URLForResource:self.bundleResourceName
                                  withExtension:self.bundleResourceExtension
                                   subdirectory:self.bundleResourceSubdirectory];
}

- (NSString *)bundleAssetsPath
{
    NSString *resourcePath = [self.bundleResourceBundle resourcePath];
    if (self.bundleResourceSubdirectory) {
        resourcePath = [resourcePath stringByAppendingPathComponent:self.bundleResourceSubdirectory];
    }

    return [resourcePath stringByAppendingPathComponent:[CodePushUpdateUtils assetsFolderName]];
}

- (NSURL *)bundleURL
{
    return [self bundleURLForResource:self.bundleResourceName
                        withExtension:self.bundleResourceExtension
                         subdirectory:self.bundleResourceSubdirectory
                               bundle:self.bundleResourceBundle];
}

- (NSURL *)bundleURLForResource:(NSString *)resourceName
{
    return [self bundleURLForResource:resourceName
                        withExtension:self.bundleResourceExtension
                         subdirectory:self.bundleResourceSubdirectory
                               bundle:self.bundleResourceBundle];
}

- (NSURL *)bundleURLForResource:(NSString *)resourceName
                  withExtension:(NSString *)resourceExtension
{
    return [self bundleURLForResource:resourceName
                        withExtension:resourceExtension
                         subdirectory:self.bundleResourceSubdirectory
                               bundle:self.bundleResourceBundle];
}

- (NSURL *)bundleURLForResource:(NSString *)resourceName
                  withExtension:(NSString *)resourceExtension
                   subdirectory:(NSString *)resourceSubdirectory
{
    return [self bundleURLForResource:resourceName
                        withExtension:resourceExtension
                         subdirectory:resourceSubdirectory
                               bundle:self.bundleResourceBundle];
}

- (NSURL *)bundleURLForResource:(NSString *)resourceName
                  withExtension:(NSString *)resourceExtension
                   subdirectory:(NSString *)resourceSubdirectory
                         bundle:(NSBundle *)resourceBundle
{
    self.bundleResourceName = resourceName;
    self.bundleResourceExtension = resourceExtension;
    self.bundleResourceSubdirectory = resourceSubdirectory;
    self.bundleResourceBundle = resourceBundle;
		
		if ([self.package isBinaryBundle]) {
			[self ensureBinaryBundleExists];
		}
    
    NSString *logMessageFormat = @"Loading JS bundle from %@";

    NSError *error;
  
    // CodePush下发的bundle
    NSString *packageFile = [self.package getCurrentPackageBundlePath:&error];
    // 内置的bundle
    NSURL *binaryBundleURL = [self binaryBundleURL];
	
//		CPLog(@"resourceName：%@", resourceName);
//		CPLog(@"packageFile：%@", packageFile);
	
    if (error || !packageFile) {
				if ([self.package isBinaryBundle]) {
					CPLog(logMessageFormat, binaryBundleURL);
					self.isRunningBinaryVersion = YES;
					return binaryBundleURL;
				} else {
					NSError *error = nil;
					NSDictionary *currentPackageInfo = [self.package getCurrentPackageInfo:&error];
					NSString *expectedBundleName = [resourceName stringByAppendingPathExtension:self.bundleResourceExtension];
					
					if ([self.package isExistsBaseBundleFile:currentPackageInfo expectedBundleName:expectedBundleName]) {
						NSURL *baseBundleUrl = [self.package getBaseBundleFilePathUrl:currentPackageInfo expectedBundleName:expectedBundleName];
						CPLog(@"没有内置包，从基础包，baseBundleUrl：%@", baseBundleUrl.path);
						packageFile = [baseBundleUrl path];
					}
				}
    }

    NSString *binaryAppVersion = [self.config appVersion];
    NSDictionary *currentPackageMetadata = [self.package getCurrentPackage:&error];
		if ((error || !currentPackageMetadata) && [self.package isBinaryBundle]) {
        CPLog(logMessageFormat, binaryBundleURL);
        self.isRunningBinaryVersion = YES;
        return binaryBundleURL;
    }

    NSString *packageDate = [currentPackageMetadata objectForKey:BinaryBundleDateKey];
    NSString *packageAppVersion = [currentPackageMetadata objectForKey:AppVersionKey];
		
		NSString *modifiedDate = [CodePushUpdateUtils modifiedDateStringOfFileAtURL:binaryBundleURL];
	
		if (![self.package isBinaryBundle]) {
			modifiedDate = [CodePushUpdateUtils dymanicBundleModifiedDateString];
		}

		if (packageFile && [modifiedDate isEqualToString:packageDate] && ([CodePush isUsingTestConfiguration] ||[binaryAppVersion isEqualToString:packageAppVersion])) {
        // Return package file because it is newer than the app store binary's JS bundle
        NSURL *packageUrl = [[NSURL alloc] initFileURLWithPath:packageFile];
        CPLog(logMessageFormat, packageUrl);
        self.isRunningBinaryVersion = NO;
        return packageUrl;
    } else {
        BOOL isRelease = NO;
#ifndef DEBUG
        isRelease = YES;
#endif

        if (isRelease || ![binaryAppVersion isEqualToString:packageAppVersion]) {
            [self native_clearUpdates];
        }

        CPLog(logMessageFormat, binaryBundleURL);
        self.isRunningBinaryVersion = YES;
			
        return binaryBundleURL;
    }
}

+ (NSString *)getApplicationSupportDirectory
{
    NSString *applicationSupportDirectory = [NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES) objectAtIndex:0];
    return applicationSupportDirectory;
}

- (void)overrideAppVersion:(NSString *)appVersion
{
    self.config.appVersion = appVersion;
}

- (void)setDeploymentKey:(NSString *)deploymentKey
{
    self.config.deploymentKey = deploymentKey;
}

- (NSString *)deploymentKey {
    return self.config.deploymentKey;
}

/*
 * WARNING: This cleans up all downloaded and pending updates.
 */
- (void)native_clearUpdates
{
    [self.package clearUpdates];
    [self removePendingUpdate];
    [self removeFailedUpdates];
}

#pragma mark - Test-only methods

/*
 * This returns a boolean value indicating whether CodePush has
 * been set to run under a test configuration.
 */
+ (BOOL)isUsingTestConfiguration
{
    return testConfigurationFlag;
}

/*
 * This is used to enable an environment in which tests can be run.
 * Specifically, it flips a boolean flag that causes bundles to be
 * saved to a test folder and enables the ability to modify
 * installed bundles on the fly from JavaScript.
 */
+ (void)setUsingTestConfiguration:(BOOL)shouldUseTestConfiguration
{
    testConfigurationFlag = shouldUseTestConfiguration;
}

#pragma mark - Private API methods

@synthesize methodQueue = _methodQueue;
@synthesize pauseCallback = _pauseCallback;
@synthesize paused = _paused;

- (void)setPaused:(BOOL)paused
{
    if (_paused != paused) {
        _paused = paused;
        if (_pauseCallback) {
            _pauseCallback();
        }
    }
}

/*
 * This method is used to clear updates that are installed
 * under a different app version and hence don't apply anymore,
 * during a debug run configuration and when the bridge is
 * running the JS bundle from the dev server.
 */
- (void)clearDebugUpdates
{
    dispatch_async(dispatch_get_main_queue(), ^{
        if ([super.bridge.bundleURL.scheme hasPrefix:@"http"]) {
            NSError *error;
            NSString *binaryAppVersion = [self.config appVersion];
            NSDictionary *currentPackageMetadata = [self.package getCurrentPackage:&error];
            if (currentPackageMetadata) {
                NSString *packageAppVersion = [currentPackageMetadata objectForKey:AppVersionKey];
                if (![binaryAppVersion isEqualToString:packageAppVersion]) {
                    [self native_clearUpdates];
                }
            }
        }
    });
}

/*
 * This method is used by the React Native bridge to allow
 * our plugin to expose constants to the JS-side. In our case
 * we're simply exporting enum values so that the JS and Native
 * sides of the plugin can be in sync.
 */
- (NSDictionary *)constantsToExport
{
    return @{
             @"codePushInstallModeOnNextRestart":@(CodePushInstallModeOnNextRestart),
             @"codePushInstallModeImmediate": @(CodePushInstallModeImmediate),
             @"codePushInstallModeOnNextResume": @(CodePushInstallModeOnNextResume),
             @"codePushInstallModeOnNextSuspend": @(CodePushInstallModeOnNextSuspend),

             @"codePushUpdateStateRunning": @(CodePushUpdateStateRunning),
             @"codePushUpdateStatePending": @(CodePushUpdateStatePending),
             @"codePushUpdateStateLatest": @(CodePushUpdateStateLatest)
            };
};

#ifdef RCT_NEW_ARCH_ENABLED
- (NSNumber *)codePushInstallModeImmediate {
    return @(CodePushInstallModeImmediate);
}

- (NSNumber *)codePushInstallModeOnNextRestart {
    return @(CodePushInstallModeOnNextRestart);
}

- (NSNumber *)codePushInstallModeOnNextResume {
    return @(CodePushInstallModeOnNextResume);
}

- (NSNumber *)codePushInstallModeOnNextSuspend {
    return @(CodePushInstallModeOnNextSuspend);
}

- (NSNumber *)codePushUpdateStateRunning {
    return @(CodePushUpdateStateRunning);
}

- (NSNumber *)codePushUpdateStatePending {
    return @(CodePushUpdateStatePending);
}

- (NSNumber *)codePushUpdateStateLatest {
    return @(CodePushUpdateStateLatest);
}
#endif

+ (BOOL)requiresMainQueueSetup
{
    return NO;
}

- (void)dealloc
{
		CPLog(@"🔴 CodePush dealloc: %@ ", self);
    // Ensure the global resume handler is cleared, so that
    // this object isn't kept alive unnecessarily
    [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (void)dispatchDownloadProgressEvent {
  // Notify the script-side about the progress
  [self sendEventWithName:DownloadProgressEvent
                     body:@{
                       @"totalBytes" : [NSNumber
                           numberWithLongLong:_latestExpectedContentLength],
                       @"receivedBytes" : [NSNumber
                           numberWithLongLong:_latestReceivedConentLength]
                     }];
}

- (void)dispatchPatchStateEvent:(CodePushPatchState)patchState
                           code:(int)code {
  // Notify CodePushPatchStatus
  [self sendEventWithName:CodePushPatchStatus
                     body:@{
                       @"state" : [self mapPatchEvent:patchState],
                       @"code" : [NSNumber numberWithInt:code]
                     }];
  
  [self dispatchPatchStateEventSync:patchState code:code];
}

- (void)dispatchPatchStateEventSync:(CodePushPatchState)patchState code:(int)code {
  
  if (self.patchStateCallback) {
    NSString *status = [self mapPatchEvent:patchState];
    NSNumber *newCode = [NSNumber numberWithInt:code];
    self.patchStateCallback(status, newCode);
  }
}

- (NSString *)mapPatchEvent:(CodePushPatchState)patchState {
    switch (patchState) {
        case CodePushPatchSTART:
            return @"PATCH_START";
        case CodePushPatchDone:
            return @"PATCH_DONE";
        case CodePushPatchERROR:
            return @"PATCH_ERROR";
        default:
            return @"PATCH_UNKOWN";
    }
}


/*
 * This method ensures that the app was packaged with a JS bundle
 * file, and if not, it throws the appropriate exception.
 */
- (void)ensureBinaryBundleExists
{
    if (![self binaryBundleURL]) {
        NSString *errorMessage;

    #ifdef DEBUG
        #if TARGET_IPHONE_SIMULATOR
            errorMessage = @"React Native doesn't generate your app's JS bundle by default when deploying to the simulator. "
            "If you'd like to test CodePush using the simulator, you can do one of the following depending on your "
            "React Native version and/or preferred workflow:\n\n"

            "1. Update your AppDelegate.m file to load the JS bundle from the packager instead of from CodePush. "
            "You can still test your CodePush update experience using this workflow (Debug builds only).\n\n"

            "2. Force the JS bundle to be generated in simulator builds by adding 'export FORCE_BUNDLING=true' to the script under "
            "\"Build Phases\" > \"Bundle React Native code and images\" (React Native >=0.48 only).\n\n"

            "3. Force the JS bundle to be generated in simulator builds by removing the if block that echoes "
            "\"Skipping bundling for Simulator platform\" in the \"node_modules/react-native/packager/react-native-xcode.sh\" file (React Native <=0.47 only)\n\n"

            "4. Deploy a Release build to the simulator, which unlike Debug builds, will generate the JS bundle (React Native >=0.22.0 only).";
        #else
            errorMessage = [NSString stringWithFormat:@"The specified JS bundle file wasn't found within the app's binary. Is \"%@\" the correct file name?", [self.bundleResourceName stringByAppendingPathExtension:self.bundleResourceExtension]];
        #endif
    #else
        errorMessage = @"Something went wrong. Please verify if generated JS bundle is correct. ";
    #endif

        RCTFatal([CodePushErrorUtils errorWithMessage:errorMessage]);
    }
}

- (instancetype)initWithDeploymentKey:(NSString *)deploymentKey isPreDownload:(BOOL)isPreDownload {
    self = [super init];

    if (self) {
        // Use the mainBundle by default.
        self.bundleResourceBundle = [NSBundle mainBundle];
        self.bundleResourceExtension = @"jsbundle";
        self.bundleResourceName = @"main";
        self.bundleResourceSubdirectory = nil;
        self.isRunningBinaryVersion = NO;
        self.needToReportRollback = NO;

        self.isNativeSync = NO;
        
        self.config = [[CodePushConfig alloc] init];

        self.package = [[CodePushPackage alloc] init];
        self.package.codePush = self;

        self.config.package = self.package;
    
        [self setDeploymentKey:deploymentKey];
            
        self.telemetryManager = [[CodePushTelemetryManager alloc] initWithDeploymentKey:deploymentKey];
            
        // if (!isPreDownload) {
        //     [self initializeUpdateAfterRestart];
        // }
    }

    return self;
}

/*
 * This method is used when the app is started to either
 * initialize a pending update or rollback a faulty update
 * to the previous version.
 */
- (void)initializeUpdateAfterRestart
{
#ifdef DEBUG
    [self clearDebugUpdates];
#endif
    self.paused = YES;
    NSUserDefaults *preferences = [[NSUserDefaults alloc] initWithSuiteName:[self deploymentKey]];
    NSDictionary *pendingUpdate = [preferences objectForKey:PendingUpdateKey];
    if (pendingUpdate) {
        _isFirstRunAfterUpdate = YES;
        BOOL updateIsLoading = [pendingUpdate[PendingUpdateIsLoadingKey] boolValue];
        if (updateIsLoading) {
            // Pending update was initialized, but notifyApplicationReady was not called.
            // Therefore, deduce that it is a broken update and rollback.
            CPLog(@"Update did not finish loading the last time, rolling back to a previous version.");
            self.needToReportRollback = YES;
            [self rollbackPackage];
        } else {
            // Mark that we tried to initialize the new update, so that if it crashes,
            // we will know that we need to rollback when the app next starts.
            [self savePendingUpdate:pendingUpdate[PendingUpdateHashKey]
                          isLoading:YES];
        }
    }
}

/*
 * This method is used to get information about the latest rollback.
 * This information will be used to decide whether the application
 * should ignore the update or not.
 */
- (NSDictionary *)getLatestRollbackInfo
{
    NSUserDefaults *preferences = [[NSUserDefaults alloc] initWithSuiteName:[self deploymentKey]];
    NSDictionary *latestRollbackInfo = [preferences objectForKey:LatestRollbackInfoKey];
    return latestRollbackInfo;
}

/*
 * This method is used to save information about the latest rollback.
 * This information will be used to decide whether the application
 * should ignore the update or not.
 */
- (void)setLatestRollbackInfo:(NSString*)packageHash
{
    if (packageHash == nil) {
        return;
    }

    NSUserDefaults *preferences = [[NSUserDefaults alloc] initWithSuiteName:[self deploymentKey]];
    NSMutableDictionary *latestRollbackInfo = [preferences objectForKey:LatestRollbackInfoKey];
    if (latestRollbackInfo == nil) {
        latestRollbackInfo = [[NSMutableDictionary alloc] init];
    } else {
        latestRollbackInfo = [latestRollbackInfo mutableCopy];
    }

    int initialRollbackCount = [self getRollbackCountForPackage: packageHash fromLatestRollbackInfo: latestRollbackInfo];
    NSNumber *count = [NSNumber numberWithInt: initialRollbackCount + 1];
    NSNumber *currentTimeMillis = [NSNumber numberWithDouble: [[NSDate date] timeIntervalSince1970] * 1000];

    [latestRollbackInfo setValue:count forKey:LatestRollbackCountKey];
    [latestRollbackInfo setValue:currentTimeMillis forKey:LatestRollbackTimeKey];
    [latestRollbackInfo setValue:packageHash forKey:LatestRollbackPackageHashKey];

    [preferences setObject:latestRollbackInfo forKey:LatestRollbackInfoKey];
    [preferences synchronize];
}

/*
 * This method is used to get the count of rollback for the package
 * using the latest rollback information.
 */
- (int)getRollbackCountForPackage:(NSString*) packageHash fromLatestRollbackInfo:(NSMutableDictionary*) latestRollbackInfo
{
    NSString *oldPackageHash = [latestRollbackInfo objectForKey:LatestRollbackPackageHashKey];
    if ([packageHash isEqualToString: oldPackageHash]) {
        NSNumber *oldCount = [latestRollbackInfo objectForKey:LatestRollbackCountKey];
        return [oldCount intValue];
    } else {
        return 0;
    }
}

/*
 * This method checks to see whether a specific package hash
 * has previously failed installation.
 */
- (BOOL)isFailedHash:(NSString*)packageHash
{
    NSUserDefaults *preferences = [[NSUserDefaults alloc] initWithSuiteName:[self deploymentKey]];
    NSMutableArray *failedUpdates = [preferences objectForKey:FailedUpdatesKey];
    if (failedUpdates == nil || packageHash == nil) {
        return NO;
    } else {
        for (NSDictionary *failedPackage in failedUpdates)
        {
            // Type check is needed for backwards compatibility, where we used to just store
            // the failed package hash instead of the metadata. This only impacts "dev"
            // scenarios, since in production we clear out old information whenever a new
            // binary is applied.
            if ([failedPackage isKindOfClass:[NSDictionary class]]) {
                NSString *failedPackageHash = [failedPackage objectForKey:PackageHashKey];
                if ([packageHash isEqualToString:failedPackageHash]) {
                    return YES;
                }
            }
        }

        return NO;
    }
}

/*
 * This method checks to see whether a specific package hash
 * represents a downloaded and installed update, that hasn't
 * been applied yet via an app restart.
 */
- (BOOL)isPendingUpdate:(NSString*)packageHash
{
    NSUserDefaults *preferences = [[NSUserDefaults alloc] initWithSuiteName:[self deploymentKey]];
    NSDictionary *pendingUpdate = [preferences objectForKey:PendingUpdateKey];

    // If there is a pending update whose "state" isn't loading, then we consider it "pending".
    // Additionally, if a specific hash was provided, we ensure it matches that of the pending update.
    BOOL updateIsPending = pendingUpdate &&
                           [pendingUpdate[PendingUpdateIsLoadingKey] boolValue] == NO &&
                           (!packageHash || [pendingUpdate[PendingUpdateHashKey] isEqualToString:packageHash]);

    return updateIsPending;
}

- (BOOL)isPendingHash:(NSString*)packageHash
{
	CPLog(@"runningHash：%@", packageHash);
	NSUserDefaults *preferences = [[NSUserDefaults alloc] initWithSuiteName:[self deploymentKey]];
	NSDictionary *pendingUpdate = [preferences objectForKey:PendingUpdateKey];
	CPLog(@"pendingUpdate：%@", pendingUpdate);
	// If there is a pending update whose "state" isn't loading, then we consider it "pending".
	// Additionally, if a specific hash was provided, we ensure it matches that of the pending update.
	BOOL updateIsPending = pendingUpdate &&
						   (!packageHash || [pendingUpdate[PendingUpdateHashKey] isEqualToString:packageHash]);

	return updateIsPending;
}

- (NSDictionary *)pendingUpdateData {
  NSUserDefaults *preferences = [[NSUserDefaults alloc] initWithSuiteName:[self deploymentKey]];
    NSDictionary *pendingUpdate = [preferences objectForKey:PendingUpdateKey];
  return pendingUpdate;
}

/*
 * This method updates the React Native bridge's bundle URL
 * to point at the latest CodePush update, and then restarts
 * the bridge. This isn't meant to be called directly.
 */
- (void)loadBundle
{
    // This needs to be async dispatched because the bridge is not set on init
    // when the app first starts, therefore rollbacks will not take effect.
    dispatch_async(dispatch_get_main_queue(), ^{
        // If the current bundle URL is using http(s), then assume the dev
        // is debugging and therefore, shouldn't be redirected to a local
        // file (since Chrome wouldn't support it). Otherwise, update
        // the current bundle URL to point at the latest update
        if ([CodePush isUsingTestConfiguration] || ![super.bridge.bundleURL.scheme hasPrefix:@"http"]) {
            // do nothing
            /*
             为了支持 commonBundle 拆包，这里注释掉，
             这里会强制把 RCTBridge 的 bundleURL 设置为bizURL
             但是，我们希望的是 RCTBridge 的 bundleURL 一直是
             commonBundle
             至于 CodePush 的 TestConfiguration 模式，到目前为止也没使用过，
             暂时不考虑它的情况。
             我们这了直接把这里注释掉即可
            */
            //[super.bridge setValue:[self bundleURL] forKey:@"bundleURL"];
        }

        // super.bridge 获取到的是 c++ RCTCxxBridge 的实例，但是本质我们是需要RCTBridge 实例
        RCTBridge *bridge = super.bridge.parentBridge;
        if ([bridge conformsToProtocol:@protocol(RCTReloadListener)]) {
            id <RCTReloadListener>listener =(id <RCTReloadListener>)bridge;
            [listener didReceiveReloadCommand];
        }
        //[super.bridge reload];
    });
}

/*
 * This method is used when an update has failed installation
 * and the app needs to be rolled back to the previous bundle.
 * This method is automatically called when the rollback timer
 * expires without the app indicating whether the update succeeded,
 * and therefore, it shouldn't be called directly.
 */
- (void)rollbackPackage
{
    NSError *error;
    NSDictionary *failedPackage = [self.package getCurrentPackage:&error];
    if (!failedPackage) {
        if (error) {
            CPLog(@"Error getting current update metadata during rollback: %@", error);
        } else {
            CPLog(@"Attempted to perform a rollback when there is no current update");
        }
    } else {
        // Write the current package's metadata to the "failed list"
        [self saveFailedUpdate:failedPackage];
    }

    // Rollback to the previous version and de-register the new update
    [self.package rollbackPackage];
    [self removePendingUpdate];
    [self loadBundle];
}

/*
 * When an update failed to apply, this method can be called
 * to store its hash so that it can be ignored on future
 * attempts to check the server for an update.
 */
- (void)saveFailedUpdate:(NSDictionary *)failedPackage
{
    if ([self isFailedHash:[failedPackage objectForKey:PackageHashKey]]) {
        return;
    }
    
    NSUserDefaults *preferences = [[NSUserDefaults alloc] initWithSuiteName:[self deploymentKey]];
    NSMutableArray *failedUpdates = [preferences objectForKey:FailedUpdatesKey];
    if (failedUpdates == nil) {
        failedUpdates = [[NSMutableArray alloc] init];
    } else {
        // The NSUserDefaults sytem always returns immutable
        // objects, regardless if you stored something mutable.
        failedUpdates = [failedUpdates mutableCopy];
    }

    [failedUpdates addObject:failedPackage];
    [preferences setObject:failedUpdates forKey:FailedUpdatesKey];
    [preferences synchronize];
}

/*
 * This method is used to clear away failed updates in the event that
 * a new app store binary is installed.
 */
- (void)removeFailedUpdates
{
    NSUserDefaults *preferences = [[NSUserDefaults alloc] initWithSuiteName:[self deploymentKey]];
    [preferences removeObjectForKey:FailedUpdatesKey];
    [preferences synchronize];
}

/*
 * This method is used to register the fact that a pending
 * update succeeded and therefore can be removed.
 */
- (void)removePendingUpdate
{
    NSUserDefaults *preferences = [[NSUserDefaults alloc] initWithSuiteName:[self deploymentKey]];
    [preferences removeObjectForKey:PendingUpdateKey];
    [preferences synchronize];
}

/*
 * When an update is installed whose mode isn't IMMEDIATE, this method
 * can be called to store the pending update's metadata (e.g. packageHash)
 * so that it can be used when the actual update application occurs at a later point.
 */
- (void)savePendingUpdate:(NSString *)packageHash
                isLoading:(BOOL)isLoading
{
    // Since we're not restarting, we need to store the fact that the update
    // was installed, but hasn't yet become "active".
    NSUserDefaults *preferences = [[NSUserDefaults alloc] initWithSuiteName:[self deploymentKey]];
    NSDictionary *pendingUpdate = [[NSDictionary alloc] initWithObjectsAndKeys:
                                   packageHash,PendingUpdateHashKey,
                                   [NSNumber numberWithBool:isLoading],PendingUpdateIsLoadingKey, nil];

    [preferences setObject:pendingUpdate forKey:PendingUpdateKey];
    [preferences synchronize];
}

- (NSArray<NSString *> *)supportedEvents {
    return @[DownloadProgressEvent, CodePushPatchStatus];
}

#pragma mark - Application lifecycle event handlers

// These two handlers will only be registered when there is
// a resume-based update still pending installation.
- (void)applicationWillEnterForeground
{
    if (_appSuspendTimer) {
        [_appSuspendTimer invalidate];
        _appSuspendTimer = nil;
    }
    // Determine how long the app was in the background and ensure
    // that it meets the minimum duration amount of time.
    int durationInBackground = 0;
    if (_lastResignedDate) {
        durationInBackground = [[NSDate date] timeIntervalSinceDate:_lastResignedDate];
    }

    if (durationInBackground >= _minimumBackgroundDuration) {
        [self loadBundle];
    }
}

- (void)applicationWillResignActive
{
    // Save the current time so that when the app is later
    // resumed, we can detect how long it was in the background.
    _lastResignedDate = [NSDate date];

    if (_installMode == CodePushInstallModeOnNextSuspend && [self isPendingUpdate:nil]) {
        _appSuspendTimer = [NSTimer scheduledTimerWithTimeInterval:_minimumBackgroundDuration
                                                         target:self
                                                       selector:@selector(loadBundleOnTick:)
                                                       userInfo:nil
                                                        repeats:NO];
    }
}

-(void)loadBundleOnTick:(NSTimer *)timer {
    [self loadBundle];
}

#pragma mark - JavaScript-exported module methods (Public)

/*
 * This is native-side of the RemotePackage.download method
 */
RCT_EXPORT_METHOD(downloadUpdate:(NSDictionary*)updatePackage
                  notifyProgress:(BOOL)notifyProgress
                        resolve:(RCTPromiseResolveBlock)resolve
                        reject:(RCTPromiseRejectBlock)reject)
{
    NSDictionary *mutableUpdatePackage = [updatePackage mutableCopy];
    NSURL *binaryBundleURL = [self binaryBundleURL];
    if (binaryBundleURL != nil) {
        [mutableUpdatePackage setValue:[CodePushUpdateUtils modifiedDateStringOfFileAtURL:binaryBundleURL]
                                forKey:BinaryBundleDateKey];
    }

    if (notifyProgress) {
        // Set up and unpause the frame observer so that it can emit
        // progress events every frame if the progress is updated.
        _didUpdateProgress = NO;
        self.paused = NO;
    }

    NSString * publicKey = [self.config publicKey];

    [self.package
        downloadPackage:mutableUpdatePackage
        expectedBundleFileName:[self.bundleResourceName stringByAppendingPathExtension:self.bundleResourceExtension]
        publicKey:publicKey
        operationQueue:_methodQueue
        // The download is progressing forward
        progressCallback:^(long long expectedContentLength, long long receivedContentLength) {
            // Update the download progress so that the frame observer can notify the JS side
            _latestExpectedContentLength = expectedContentLength;
            _latestReceivedConentLength = receivedContentLength;
            _didUpdateProgress = YES;

            // If the download is completed, stop observing frame
            // updates and synchronously send the last event.
            if (expectedContentLength == receivedContentLength) {
                _didUpdateProgress = NO;
                self.paused = YES;
                [self dispatchDownloadProgressEvent];
            }
        }
        // The download completed
        doneCallback:^{
            NSError *err;
            NSDictionary *newPackage = [self.package getPackage:mutableUpdatePackage[PackageHashKey] error:&err];

            if (err) {
                return reject([NSString stringWithFormat: @"%lu", (long)err.code], err.localizedDescription, err);
            }
            resolve(newPackage);
        }
        // The download failed
        failCallback:^(NSError *err) {
            if ([CodePushErrorUtils isCodePushError:err]) {
                [self saveFailedUpdate:mutableUpdatePackage];
            }

            // Stop observing frame updates if the download fails.
            _didUpdateProgress = NO;
            self.paused = YES;
            reject([NSString stringWithFormat: @"%lu", (long)err.code], err.localizedDescription, err);
        }];
}

- (void)downloadUpdateSync:(NSDictionary *)updatePackage progress:(CodePushDownloadProgressCallback)progress patchStatus:(CodePushPatchStateCallback)patchState completion:(CodePushDownloadCallback)completion {
  
    if (patchState) {
      self.patchStateCallback = patchState;
    }
  
		NSMutableDictionary *mutableUpdatePackage = [updatePackage mutableCopy];
		
    NSURL *binaryBundleURL = [self binaryBundleURL];
    if (binaryBundleURL != nil) {
        [mutableUpdatePackage setValue:[CodePushUpdateUtils modifiedDateStringOfFileAtURL:binaryBundleURL]
                                forKey:BinaryBundleDateKey];
		} else {
			[mutableUpdatePackage setValue:[CodePushUpdateUtils dymanicBundleModifiedDateString] forKey:BinaryBundleDateKey];
		}

    if (progress) {
        // Set up and unpause the frame observer so that it can emit
        // progress events every frame if the progress is updated.
        _didUpdateProgress = NO;
        self.paused = NO;
    }

    NSString * publicKey = [self.config publicKey];
	
		CPLog(@"mutableUpdatePackage：%@", mutableUpdatePackage);
		NSString *packageHash = mutableUpdatePackage[@"packageHash"];
		NSString *basePackageHash = mutableUpdatePackage[@"basePackageHash"];
		long long basePackageSize = [mutableUpdatePackage[@"basePackageSize"] longLongValue];
		long long packageSize = [mutableUpdatePackage[@"downloadDiffSize"] longLongValue];
		
		NSString *expectedBundleName = [self.bundleResourceName stringByAppendingPathExtension:self.bundleResourceExtension];
	
		CPLog(@"expectedBundleName：%@", expectedBundleName);
	
		BOOL dynamicBundleExistsDiff = ![self.package isBinaryBundle] && ![packageHash isEqualToString:basePackageHash];
		CPLog(@"packageHash：%@", packageHash);
		CPLog(@"basePackageHash：%@", basePackageHash);
		CPLog(@"dynamicBundleExistsDiff：%@", @(dynamicBundleExistsDiff));
	
		[self.package
				downloadPackage:mutableUpdatePackage
				expectedBundleFileName:expectedBundleName
				publicKey:publicKey
				operationQueue:_methodQueue
				// The download is progressing forward
				progressCallback:^(long long expectedContentLength, long long receivedContentLength) {
						// Update the download progress so that the frame observer can notify the JS side
	
						// 先下载基础包，再下载增量包，下载总大小 = 基础包+增量包
						if (dynamicBundleExistsDiff && ![self.package isExistsBaseBundleFile:mutableUpdatePackage expectedBundleName:expectedBundleName]) {
							_latestBaseBundleReceivedConentLength = receivedContentLength;
							
							_latestExpectedContentLength = basePackageSize + packageSize;
							_latestReceivedConentLength = receivedContentLength;
						} else if (dynamicBundleExistsDiff && basePackageSize == _latestBaseBundleReceivedConentLength) {
							_latestReceivedConentLength = _latestBaseBundleReceivedConentLength + receivedContentLength;
						} else {
							_latestExpectedContentLength = expectedContentLength;
							 _latestReceivedConentLength = receivedContentLength;
						 }
						
							_didUpdateProgress = YES;
			
						// 下载进度回调
						if (progress) {
							progress(_latestReceivedConentLength, _latestExpectedContentLength);
						}
			
						// If the download is completed, stop observing frame
						// updates and synchronously send the last event.
						if (_latestReceivedConentLength == _latestExpectedContentLength) {
								_didUpdateProgress = NO;
								self.paused = YES;
	//              [self dispatchDownloadProgressEvent];
						}
				}
				// The download completed
				doneCallback:^{
						NSError *err;
						NSDictionary *newPackage = [self.package getPackage:mutableUpdatePackage[PackageHashKey] error:&err];

						if (err) {
	//              return reject([NSString stringWithFormat: @"%lu", (long)err.code], err.localizedDescription, err);
							completion(nil, err);
							return;
						}
	//          resolve(newPackage);
					
						if (dynamicBundleExistsDiff && ![self.package isExistsDynamicBundleLatestDiffFile:mutableUpdatePackage expectedBundleName:expectedBundleName]) {
							CPLog(@"动态bundle，基础包下载成功，再下载增量包");
							[self downloadUpdateSync:updatePackage progress:progress patchStatus:patchState completion:completion];
						} else {
							CPLog(@"下载diff包完成");
							completion(newPackage, nil);
						}

				}
				// The download failed
				failCallback:^(NSError *err) {
						if ([CodePushErrorUtils isCodePushError:err]) {
								[self saveFailedUpdate:mutableUpdatePackage];
						}

						// Stop observing frame updates if the download fails.
						_didUpdateProgress = NO;
						self.paused = YES;
	//          reject([NSString stringWithFormat: @"%lu", (long)err.code], err.localizedDescription, err);
						completion(nil, err);
				}];
	
}


/*
 * This is the native side of the CodePush.getConfiguration method. It isn't
 * currently exposed via the "react-native-code-push" module, and is used
 * internally only by the CodePush.checkForUpdate method in order to get the
 * app version, as well as the deployment key that was configured in the Info.plist file.
 */
RCT_EXPORT_METHOD(getConfiguration:(RCTPromiseResolveBlock)resolve
                          reject:(RCTPromiseRejectBlock)reject)
{
    NSDictionary *configuration = [self.config configuration];
    NSError *error;
    
    NSString *basePackageHash = [self.config basePackageHash];
    NSMutableDictionary *mutableConfiguration = [configuration mutableCopy];
    if (basePackageHash) {
        [mutableConfiguration setObject:basePackageHash forKey:PackageHashKey];
    }
    /*
    if (self.isRunningBinaryVersion) {
        
        // isRunningBinaryVersion will not get set to "YES" if running against the packager.
        NSString *binaryHash = [CodePushUpdateUtils getHashForBinaryContents:[self binaryBundleURL] codePush:self error:&error];
        if (error) {
            CPLog(@"Error obtaining hash for binary contents: %@", error);
            resolve(configuration);
            return;
        }
        
        if (binaryHash == nil) {
            // The hash was not generated either due to a previous unknown error or the fact that
            // the React Native assets were not bundled in the binary (e.g. during dev/simulator)
            // builds.
            resolve(configuration);
            return;
        }

        NSMutableDictionary *mutableConfiguration = [configuration mutableCopy];
        [mutableConfiguration setObject:binaryHash forKey:PackageHashKey];
        resolve(mutableConfiguration);
        return;
    }
    */
    resolve(mutableConfiguration);
}

- (NSDictionary *)getConfigurationSync {
  NSDictionary *configuration = [self.config configuration];
  NSError *error;
  
  NSString *basePackageHash = [self.config basePackageHash];
  NSMutableDictionary *mutableConfiguration = [configuration mutableCopy];
  if (basePackageHash) {
      [mutableConfiguration setObject:basePackageHash forKey:PackageHashKey];
  }
  return mutableConfiguration;
}

/*
 * This method is the native side of the CodePush.getUpdateMetadata method.
 */
RCT_EXPORT_METHOD(getUpdateMetadata:(CodePushUpdateState)updateState
                           resolve:(RCTPromiseResolveBlock)resolve
                           reject:(RCTPromiseRejectBlock)reject)
{
    NSError *error;
    NSMutableDictionary *package = [[self.package getCurrentPackage:&error] mutableCopy];

    if (error) {
        return reject([NSString stringWithFormat: @"%lu", (long)error.code], error.localizedDescription, error);
    } else if (package == nil) {
        // The app hasn't downloaded any CodePush updates yet,
        // so we simply return nil regardless if the user
        // wanted to retrieve the pending or running update.
        return resolve(nil);
    }

    // We have a CodePush update, so let's see if it's currently in a pending state.
    BOOL currentUpdateIsPending = [self isPendingUpdate:[package objectForKey:PackageHashKey]];

    if (updateState == CodePushUpdateStatePending && !currentUpdateIsPending) {
        // The caller wanted a pending update
        // but there isn't currently one.
        resolve(nil);
    } else if (updateState == CodePushUpdateStateRunning && currentUpdateIsPending) {
        // The caller wants the running update, but the current
        // one is pending, so we need to grab the previous.
        resolve([self.package getPreviousPackage:&error]);
    } else {
        // The current package satisfies the request:
        // 1) Caller wanted a pending, and there is a pending update
        // 2) Caller wanted the running update, and there isn't a pending
        // 3) Caller wants the latest update, regardless if it's pending or not
        if (self.isRunningBinaryVersion) {
            // This only matters in Debug builds. Since we do not clear "outdated" updates,
            // we need to indicate to the JS side that somehow we have a current update on
            // disk that is not actually running.
            [package setObject:@(YES) forKey:@"_isDebugOnly"];
        }

        // Enable differentiating pending vs. non-pending updates
        [package setObject:@(currentUpdateIsPending) forKey:PackageIsPendingKey];
        resolve(package);
    }
}

- (void)getUpdateMetadataSync:(CodePushUpdateState)updateState completion:(CodePushGetUpdateMetadataCallback)completoion {
  NSError *error;
  NSMutableDictionary *package = [[self.package getCurrentPackage:&error] mutableCopy];

  if (error) {
//      return reject([NSString stringWithFormat: @"%lu", (long)error.code], error.localizedDescription, error);
    completoion(nil, error);
    return;
  } else if (package == nil) {
      // The app hasn't downloaded any CodePush updates yet,
      // so we simply return nil regardless if the user
      // wanted to retrieve the pending or running update.
//      return resolve(nil);
    completoion(nil, nil);
    return;
  }

  // We have a CodePush update, so let's see if it's currently in a pending state.
  BOOL currentUpdateIsPending = [self isPendingUpdate:[package objectForKey:PackageHashKey]];

  if (updateState == CodePushUpdateStatePending && !currentUpdateIsPending) {
      // The caller wanted a pending update
      // but there isn't currently one.
//      resolve(nil);
    completoion(nil, nil);
    return;
  } else if (updateState == CodePushUpdateStateRunning && currentUpdateIsPending) {
      // The caller wants the running update, but the current
      // one is pending, so we need to grab the previous.
//      resolve([self.package getPreviousPackage:&error]);
    completoion([self.package getPreviousPackage:&error], nil);
    return;
  } else {
      // The current package satisfies the request:
      // 1) Caller wanted a pending, and there is a pending update
      // 2) Caller wanted the running update, and there isn't a pending
      // 3) Caller wants the latest update, regardless if it's pending or not
      if (self.isRunningBinaryVersion) {
          // This only matters in Debug builds. Since we do not clear "outdated" updates,
          // we need to indicate to the JS side that somehow we have a current update on
          // disk that is not actually running.
          [package setObject:@(YES) forKey:@"_isDebugOnly"];
      }

      // Enable differentiating pending vs. non-pending updates
      [package setObject:@(currentUpdateIsPending) forKey:PackageIsPendingKey];
//      resolve(package);
    completoion(package, nil);
    return;
  }
}

/*
 * This method is the native side of the LocalPackage.install method.
 */
RCT_EXPORT_METHOD(installUpdate:(NSDictionary*)updatePackage
                    installMode:(CodePushInstallMode)installMode
      minimumBackgroundDuration:(int)minimumBackgroundDuration
                       resolve:(RCTPromiseResolveBlock)resolve
                       reject:(RCTPromiseRejectBlock)reject)
{
    NSError *error;
    [self.package installPackage:updatePackage
                removePendingUpdate:[self isPendingUpdate:nil]
                              error:&error];

    if (error) {
        reject([NSString stringWithFormat: @"%lu", (long)error.code], error.localizedDescription, error);
    } else {
        [self savePendingUpdate:updatePackage[PackageHashKey]
                      isLoading:NO];

        _installMode = installMode;
        if (_installMode == CodePushInstallModeOnNextResume || _installMode == CodePushInstallModeOnNextSuspend) {
            _minimumBackgroundDuration = minimumBackgroundDuration;

            if (!_hasResumeListener) {
                // Ensure we do not add the listener twice.
                // Register for app resume notifications so that we
                // can check for pending updates which support "restart on resume"
                [[NSNotificationCenter defaultCenter] addObserver:self
                                                         selector:@selector(applicationWillEnterForeground)
                                                             name:UIApplicationWillEnterForegroundNotification
                                                           object:RCTSharedApplication()];

                [[NSNotificationCenter defaultCenter] addObserver:self
                                                         selector:@selector(applicationWillResignActive)
                                                             name:UIApplicationWillResignActiveNotification
                                                           object:RCTSharedApplication()];

                _hasResumeListener = YES;
            }
        }

        // Signal to JS that the update has been applied.
        resolve(nil);
    }
}

- (void)installUpdateSync:(NSDictionary *)updatePackage installMode:(CodePushInstallMode)installMode minimumBackgroundDuration:(int)minimumBackgroundDuration completion:(CodePushInstallCallback)completion {
    NSError *error;
		
		CPLog(@"updatePackage：%@", updatePackage);
    [self.package installPackage:updatePackage
                removePendingUpdate:[self isPendingUpdate:nil]
                              error:&error];

    if (error) {
//        reject([NSString stringWithFormat: @"%lu", (long)error.code], error.localizedDescription, error);
      completion(error);
      return;
    } else {
        [self savePendingUpdate:updatePackage[PackageHashKey]
                      isLoading:NO];

        _installMode = installMode;
        if (_installMode == CodePushInstallModeOnNextResume || _installMode == CodePushInstallModeOnNextSuspend) {
            _minimumBackgroundDuration = minimumBackgroundDuration;

            if (!_hasResumeListener) {
                // Ensure we do not add the listener twice.
                // Register for app resume notifications so that we
                // can check for pending updates which support "restart on resume"
                [[NSNotificationCenter defaultCenter] addObserver:self
                                                         selector:@selector(applicationWillEnterForeground)
                                                             name:UIApplicationWillEnterForegroundNotification
                                                           object:RCTSharedApplication()];

                [[NSNotificationCenter defaultCenter] addObserver:self
                                                         selector:@selector(applicationWillResignActive)
                                                             name:UIApplicationWillResignActiveNotification
                                                           object:RCTSharedApplication()];

                _hasResumeListener = YES;
            }
        }

        // Signal to JS that the update has been applied.
//        resolve(nil);
        completion(nil);
    }
}

/*
 * This method isn't publicly exposed via the "react-native-code-push"
 * module, and is only used internally to populate the RemotePackage.failedInstall property.
 */
RCT_EXPORT_METHOD(isFailedUpdate:(NSString *)packageHash
                         resolve:(RCTPromiseResolveBlock)resolve
                          reject:(RCTPromiseRejectBlock)reject)
{
    BOOL isFailedHash = [self isFailedHash:packageHash];
    resolve(@(isFailedHash));
}

- (BOOL)isFailedUpdateSync:(NSString *)packageHash {
  BOOL isFailedHash = [self isFailedHash:packageHash];
  return isFailedHash;
}

RCT_EXPORT_METHOD(setLatestRollbackInfo:(NSString *)packageHash
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    [self setLatestRollbackInfo:packageHash];
}

- (void)setLatestRollbackInfoSync:(NSString *)packageHash {
  [self setLatestRollbackInfo:packageHash];
}


RCT_EXPORT_METHOD(getLatestRollbackInfo:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    NSDictionary *latestRollbackInfo = [self getLatestRollbackInfo];
    resolve(latestRollbackInfo);
}

- (NSDictionary *)getLatestRollbackInfoSync {
  NSDictionary *latestRollbackInfo = [self getLatestRollbackInfo];
  return latestRollbackInfo;
}

/*
 * This method isn't publicly exposed via the "react-native-code-push"
 * module, and is only used internally to populate the LocalPackage.isFirstRun property.
 */
RCT_EXPORT_METHOD(isFirstRun:(NSString *)packageHash
                     resolve:(RCTPromiseResolveBlock)resolve
                    reject:(RCTPromiseRejectBlock)reject)
{
    NSError *error;
    BOOL isFirstRun = _isFirstRunAfterUpdate
                        && nil != packageHash
                        && [packageHash length] > 0
                        && [packageHash isEqualToString:[self.package getCurrentPackageHash:&error]];

    resolve(@(isFirstRun));
}

- (BOOL)isFirstRunSync:(NSString *)packageHash {
  NSError *error;
  BOOL isFirstRun = _isFirstRunAfterUpdate
                      && nil != packageHash
                      && [packageHash length] > 0
                      && [packageHash isEqualToString:[self.package getCurrentPackageHash:&error]];
  return isFirstRun;
}

/*
 * This method is the native side of the CodePush.notifyApplicationReady() method.
 */
RCT_EXPORT_METHOD(notifyApplicationReady:(RCTPromiseResolveBlock)resolve
                                reject:(RCTPromiseRejectBlock)reject)
{
    CPLog(@"业务JS侧调用到 notifyApplicationReady");
	
	if ([self isPendingHash:self.runningPackageHash]) {
		CPLog(@"移除pendingUpdate");
		[self removePendingUpdate];
	}
	CPLog(@"nativeModules中codepush实例内存地址：%p", self);
    resolve(nil);
}

- (void)notifyApplicationReadySync {
  [self removePendingUpdate];
}

/*
 * This method is the native side of the CodePush.restartApp() method.
 */
RCT_EXPORT_METHOD(restartApp:(BOOL)onlyIfUpdateIsPending
                     resolve:(RCTPromiseResolveBlock)resolve
                    reject:(RCTPromiseRejectBlock)reject)
{
    // If this is an unconditional restart request, or there
    // is current pending update, then reload the app.
    if (!onlyIfUpdateIsPending || [self isPendingUpdate:nil]) {
        [self loadBundle];
        resolve(@(YES));
        return;
    }

    resolve(@(NO));
}

//RCT_EXPORT_METHOD(restartApp:(BOOL)onlyIfUpdateIsPending) {
//	// If this is an unconditional restart request, or there
//	// is current pending update, then reload the app.
//	if (!onlyIfUpdateIsPending || [self isPendingUpdate:nil]) {
//			[self loadBundle];
//	}
//}

- (void)restartAppSync:(BOOL)onlyIfUpdateIsPending completion:(CodePushRestartAppCallback)completion {
  // If this is an unconditional restart request, or there
  // is current pending update, then reload the app.
  if (!onlyIfUpdateIsPending || [self isPendingUpdate:nil]) {
      [self loadBundle];
//      resolve(@(YES));
      completion(YES);
      return;
  }

//  resolve(@(NO));
    completion(NO);
}

/*
 * This method clears CodePush's downloaded updates.
 * It is needed to switch to a different deployment if the current deployment is more recent.
 * Note: we don’t recommend to use this method in scenarios other than that (CodePush will call this method
 * automatically when needed in other cases) as it could lead to unpredictable behavior.
 */
RCT_EXPORT_METHOD(clearUpdates) {
    CPLog(@"Clearing updates.");
    [self native_clearUpdates];
}

#pragma mark - JavaScript-exported module methods (Private)

/*
 * This method is the native side of the CodePush.downloadAndReplaceCurrentBundle()
 * method, which replaces the current bundle with the one downloaded from
 * removeBundleUrl. It is only to be used during tests and no-ops if the test
 * configuration flag is not set.
 */
RCT_EXPORT_METHOD(downloadAndReplaceCurrentBundle:(NSString *)remoteBundleUrl)
{
    if ([CodePush isUsingTestConfiguration]) {
        [self.package downloadAndReplaceCurrentBundle:remoteBundleUrl];
    }
}

/*
 * This method is checks if a new status update exists (new version was installed,
 * or an update failed) and return its details (version label, status).
 */
RCT_EXPORT_METHOD(getNewStatusReport:(RCTPromiseResolveBlock)resolve
                            reject:(RCTPromiseRejectBlock)reject)
{
    if (self.needToReportRollback) {
        self.needToReportRollback = NO;
        NSUserDefaults *preferences = [[NSUserDefaults alloc] initWithSuiteName:[self deploymentKey]];
        NSMutableArray *failedUpdates = [preferences objectForKey:FailedUpdatesKey];
        if (failedUpdates) {
            NSDictionary *lastFailedPackage = [failedUpdates lastObject];
            if (lastFailedPackage) {
                resolve([self.telemetryManager getRollbackReport:lastFailedPackage]);
                return;
            }
        }
    } else if (_isFirstRunAfterUpdate) {
        NSError *error;
        NSDictionary *currentPackage = [self.package getCurrentPackage:&error];
        if (!error && currentPackage) {
            resolve([self.telemetryManager getUpdateReport:currentPackage]);
            return;
        }
    } else if (self.isRunningBinaryVersion) {
        NSString *appVersion = [self.config appVersion];
        resolve([self.telemetryManager getBinaryUpdateReport:appVersion]);
        return;
    } else {
        NSDictionary *retryStatusReport = [self.telemetryManager getRetryStatusReport];
        if (retryStatusReport) {
            resolve(retryStatusReport);
            return;
        }
    }

    resolve(nil);
}

- (NSDictionary *)getNewStatusReportSync {
  if (self.needToReportRollback) {
      self.needToReportRollback = NO;
      NSUserDefaults *preferences = [[NSUserDefaults alloc] initWithSuiteName:[self deploymentKey]];
      NSMutableArray *failedUpdates = [preferences objectForKey:FailedUpdatesKey];
      if (failedUpdates) {
          NSDictionary *lastFailedPackage = [failedUpdates lastObject];
          if (lastFailedPackage) {
//              resolve([self.telemetryManager getRollbackReport:lastFailedPackage]);
              return [self.telemetryManager getRollbackReport:lastFailedPackage];
          }
      }
  } else if (_isFirstRunAfterUpdate) {
      NSError *error;
      NSDictionary *currentPackage = [self.package getCurrentPackage:&error];
      if (!error && currentPackage) {
//          resolve([self.telemetryManager getUpdateReport:currentPackage]);
          return [self.telemetryManager getUpdateReport:currentPackage];
      }
  } else if (self.isRunningBinaryVersion) {
      NSString *appVersion = [self.config appVersion];
//      resolve([self.telemetryManager getBinaryUpdateReport:appVersion]);
      return [self.telemetryManager getBinaryUpdateReport:appVersion];
  } else {
      NSDictionary *retryStatusReport = [self.telemetryManager getRetryStatusReport];
      if (retryStatusReport) {
//          resolve(retryStatusReport);
          return retryStatusReport;
      }
  }
  
  return nil;
}

RCT_EXPORT_METHOD(recordStatusReported:(NSDictionary *)statusReport)
{
    [self.telemetryManager recordStatusReported:statusReport];
}

- (void)recordStatusReportedSync:(NSDictionary *)statusReport {
  [self.telemetryManager recordStatusReported:statusReport];
}

RCT_EXPORT_METHOD(saveStatusReportForRetry:(NSDictionary *)statusReport)
{
    [self.telemetryManager saveStatusReportForRetry:statusReport];
}

- (void)saveStatusReportForRetrySync:(NSDictionary *)statusReport {
  [self.telemetryManager saveStatusReportForRetry:statusReport];
}


/// 判断Native是否正在走Sync流程
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(isNativeSyncing)
{
	CPLog(@"isNativeSyncing 调用：%@", @(self.isNativeSync));
	BOOL isNativeSync = self.isNativeSync;
	return @(isNativeSync);
}


/// 判断当前bundle是否是内置bundle
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(isAssetBundleFileExists)
{
	BOOL isInnerBundle = [self.package isBinaryBundle];
	return @(isInnerBundle);
}


/// 获取基础包xxx.jsbundle 的文件夹目录
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(getBasePackageBundlePath)
{
	NSError *error = nil;
	NSDictionary *bundleInfo = [self.package getCurrentPackageInfo:&error];
	NSString *bundleFolder = [self.package getBaseBundleReleaseIosFolder:bundleInfo];
	
	NSURL *url = [NSURL fileURLWithPath:bundleFolder];
	NSString *encoded = url.absoluteString ?: @"";
	return encoded;
}

RCT_EXPORT_METHOD(sync:(RCTPromiseResolveBlock)resolve
									reject:(RCTPromiseRejectBlock)reject) {
	resolve(@(YES));
}

RCT_EXPORT_METHOD(allow) {
	
}

RCT_EXPORT_METHOD(clearPendingRestart) {
	
}

RCT_EXPORT_METHOD(disallow) {
	
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(isFileExist:(NSString *)path) {
	return @(YES);
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(getIntlResourcePath:(NSString *)path) {
	return @"";
}

#pragma mark - RCTFrameUpdateObserver Methods

- (void)didUpdateFrame:(RCTFrameUpdate *)update
{
    if (!_didUpdateProgress) {
        return;
    }

    [self dispatchDownloadProgressEvent];
    _didUpdateProgress = NO;
}

@end

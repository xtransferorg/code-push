#if __has_include(<React/RCTEventEmitter.h>)
#import <React/RCTEventEmitter.h>
#elif __has_include("RCTEventEmitter.h")
#import "RCTEventEmitter.h"
#else
#import "React/RCTEventEmitter.h"   // Required when used as a Pod in a Swift project
#endif

#import <Foundation/Foundation.h>

typedef NS_ENUM(NSInteger, CodePushPatchState) {
    CodePushPatchSTART,
    CodePushPatchDone,
    CodePushPatchERROR
};

#ifdef __cplusplus
extern "C" {
#endif
void CPLog(NSString *formatString, ...);
#ifdef __cplusplus
}
#endif

typedef NS_ENUM(NSInteger, CodePushInstallMode) {
    CodePushInstallModeImmediate,
    CodePushInstallModeOnNextRestart,
    CodePushInstallModeOnNextResume,
    CodePushInstallModeOnNextSuspend
};

typedef NS_ENUM(NSInteger, CodePushUpdateState) {
    CodePushUpdateStateRunning,
    CodePushUpdateStatePending,
    CodePushUpdateStateLatest
};

static NSString *const RollbackFullBundleUpdatePackage = @"patchFailed";

typedef void (^CodePushDownloadCallback)(NSDictionary *localPackage, NSError *error);

typedef void (^CodePushDownloadProgressCallback)(NSUInteger receivedBytes, NSUInteger totalBytes);

typedef void (^CodePushPatchStateCallback)(NSString *state, NSNumber *code);

typedef void(^CodePushGetUpdateMetadataCallback)(NSDictionary *metaData, NSError * error);

typedef void (^CodePushInstallCallback)(NSError *error);

typedef void(^CodePushRestartAppCallback)(BOOL reloadBundleSuccess);

@class CodePushPackage;
@class CodePushConfig;

@interface CodePush : RCTEventEmitter

- (instancetype)initWithDeploymentKey:(NSString *)deploymentKey isPreDownload:(BOOL)isPreDownload;

@property (nonatomic, strong) CodePushConfig *config;

@property (nonatomic, strong) CodePushPackage *package;

@property (nonatomic, copy) NSString *bundleResourceName;
@property (nonatomic, copy) NSString *bundleResourceExtension;

- (NSURL *)binaryBundleURL;
/*
 * This method is used to retrieve the URL for the most recent
 * version of the JavaScript bundle. This could be either the
 * bundle that was packaged with the app binary, or the bundle
 * that was downloaded as part of a CodePush update. The value returned
 * should be used to "bootstrap" the React Native bridge.
 *
 * This method assumes that your JS bundle is named "main.jsbundle"
 * and therefore, if it isn't, you should use either the bundleURLForResource:
 * or bundleURLForResource:withExtension: methods to override that behavior.
 */
- (NSURL *)bundleURL;

- (NSURL *)bundleURLForResource:(NSString *)resourceName;

- (NSURL *)bundleURLForResource:(NSString *)resourceName
                  withExtension:(NSString *)resourceExtension;

- (NSURL *)bundleURLForResource:(NSString *)resourceName
                  withExtension:(NSString *)resourceExtension
                   subdirectory:(NSString *)resourceSubdirectory;

- (NSURL *)bundleURLForResource:(NSString *)resourceName
                  withExtension:(NSString *)resourceExtension
                   subdirectory:(NSString *)resourceSubdirectory
                         bundle:(NSBundle *)resourceBundle;

+ (NSString *)getApplicationSupportDirectory;

- (NSString *)bundleAssetsPath;

/*
 * This method allows the version of the app's binary interface
 * to be specified, which would otherwise default to the
 * App Store version of the app.
 */
- (void)overrideAppVersion:(NSString *)appVersion;

/*
 * This method allows dynamically setting the app's
 * deployment key, in addition to setting it via
 * the Info.plist file's CodePushDeploymentKey setting.
 */
- (void)setDeploymentKey:(NSString *)deploymentKey;

- (NSString *)deploymentKey;

/*
 * This method checks to see whether a specific package hash
 * has previously failed installation.
 */
- (BOOL)isFailedHash:(NSString*)packageHash;


/*
 * This method is used to get information about the latest rollback.
 * This information will be used to decide whether the application
 * should ignore the update or not.
 */
- (NSDictionary*)getLatestRollbackInfo;
/*
 * This method is used to save information about the latest rollback.
 * This information will be used to decide whether the application
 * should ignore the update or not.
 */
- (void)setLatestRollbackInfo:(NSString*)packageHash;
/*
 * This method is used to get the count of rollback for the package
 * using the latest rollback information.
 */
- (int)getRollbackCountForPackage:(NSString*) packageHash fromLatestRollbackInfo:(NSMutableDictionary*) latestRollbackInfo;

/*
 * This method checks to see whether a specific package hash
 * represents a downloaded and installed update, that hasn't
 * been applied yet via an app restart.
 */
- (BOOL)isPendingUpdate:(NSString*)packageHash;

// The below methods are only used during tests.
+ (BOOL)isUsingTestConfiguration;
+ (void)setUsingTestConfiguration:(BOOL)shouldUseTestConfiguration;
- (void)clearUpdates;
- (void)dispatchPatchStateEvent:(CodePushPatchState)patchState
                           code:(int)code;




// ------(CodePush原生化，Promise异步转同步，方法名称相同，新增Sync后缀)-----

/// Native codepush流程是否正在sync
@property (nonatomic, assign) BOOL isNativeSync;

// 正在运行的hash，防止静默更新移除pendingUpdate数据
@property (nonatomic, copy) NSString *runningPackageHash;


/// 同步获取CodePush基础配置信息
- (NSDictionary *)getConfigurationSync;


/// 获取本地元数据信息
/// - Parameter updateState: updateState description
- (void)getUpdateMetadataSync:(CodePushUpdateState)updateState completion:(CodePushGetUpdateMetadataCallback)completoion;


/// 根据packageHash检查是否为失败的更新
/// - Parameter packageHash: packageHash description
- (BOOL)isFailedUpdateSync:(NSString *)packageHash;


/// 根据packageHash检查是否第一次运行
/// - Parameter packageHash: packageHash description
- (BOOL)isFirstRunSync:(NSString *)packageHash;


/// bundle挂载成功事件
- (void)notifyApplicationReadySync;


/// 获取最新StatusReport
- (NSDictionary *)getNewStatusReportSync;


/// 获取最新的回滚信息
- (NSDictionary *)getLatestRollbackInfoSync;


/// 设置最新的回滚信息
/// - Parameter packageHash: packageHash description
- (void)setLatestRollbackInfoSync:(NSString *)packageHash;


/// 上报状态
/// - Parameter statusReport: statusReport description
- (void)recordStatusReportedSync:(NSDictionary *)statusReport;


/// 重复上报
/// - Parameter statusReport: statusReport description
- (void)saveStatusReportForRetrySync:(NSDictionary *)statusReport;


/// 下载
- (void)downloadUpdateSync:(NSDictionary *)updatePackage progress:(CodePushDownloadProgressCallback)progress
  patchStatus:(CodePushPatchStateCallback)patchStatus
completion:(CodePushDownloadCallback)completion;


/// 安装
- (void)installUpdateSync:(NSDictionary *)updatePackage installMode:(CodePushInstallMode)installMode minimumBackgroundDuration:(int)minimumBackgroundDuration completion:(CodePushInstallCallback)completion;


/// loadbundle
- (void)restartAppSync:(BOOL)onlyIfUpdateIsPending completion:(CodePushRestartAppCallback)completion;


/// 同步dispatch的状态
- (void)dispatchPatchStateEventSync:(CodePushPatchState)patchState
                           code:(int)code;

/// codepush初始化检查回滚
- (void)initializeUpdateAfterRestart;

/// 判断是否是正在运行的packageHash
- (BOOL)isPendingHash:(NSString *)packageHash;

- (NSDictionary *)pendingUpdateData;

@end

@class CodePushPackage;

@interface CodePushConfig : NSObject

@property (nonatomic, weak) CodePushPackage *package;

@property (copy) NSString *appVersion;
@property (nonatomic, copy) NSString *clientUniqueId;
@property (readonly) NSString *buildVersion;
@property (readonly) NSDictionary *configuration;
@property (copy) NSString *deploymentKey;
@property (copy) NSString *serverURL;
@property (copy) NSString *publicKey;
@property (readonly, copy) NSString *basePackageHash;
@property (readonly, copy) NSString *commonHash;

- (NSString *)getBaseHashWithDeploymentKey:(NSString *)deploymentKey;
@end

@interface CodePushDownloadHandler : NSObject <NSURLConnectionDelegate>

@property (strong) NSOutputStream *outputFileStream;
@property long long expectedContentLength;
@property long long receivedContentLength;
@property dispatch_queue_t operationQueue;
@property (copy) void (^progressCallback)(long long, long long);
@property (copy) void (^doneCallback)(BOOL);
@property (copy) void (^failCallback)(NSError *err);
@property NSString *downloadUrl;

- (id)init:(NSString *)downloadFilePath
operationQueue:(dispatch_queue_t)operationQueue
progressCallback:(void (^)(long long, long long))progressCallback
doneCallback:(void (^)(BOOL))doneCallback
failCallback:(void (^)(NSError *err))failCallback;

- (void)download:(NSString*)url;

@end

@interface CodePushErrorUtils : NSObject

+ (NSError *)errorWithMessage:(NSString *)errorMessage;
+ (BOOL)isCodePushError:(NSError *)error;

@end

@interface CodePushPackage : NSObject

@property (nonatomic, weak) CodePush *codePush;

- (void)downloadPackage:(NSDictionary *)updatePackage
 expectedBundleFileName:(NSString *)expectedBundleFileName
              publicKey:(NSString *)publicKey
         operationQueue:(dispatch_queue_t)operationQueue
       progressCallback:(void (^)(long long, long long))progressCallback
           doneCallback:(void (^)())doneCallback
           failCallback:(void (^)(NSError *err))failCallback;

/// 是否是内置bundle
- (BOOL)isBinaryBundle;

/// 是否存在动态bundle的基础包
/// - Parameter updatePackage: updatePackage
- (BOOL)isExistsBaseBundleFile:(NSDictionary *)updatePackage expectedBundleName:(NSString *)expectedBundleName;

/// 动态bundle最新的diff更新包是否存在
/// - Parameter updatePackage: updatePackage
- (BOOL)isExistsDynamicBundleLatestDiffFile:(NSDictionary *)updatePackage expectedBundleName:(NSString *)expectedBundleName;

/// 动态bundle的基础包`basePackageHash`目录
/// - Parameter updatePackage: updatePackage
- (NSString *)baseBundleFileFolder:(NSDictionary *)updatePackage;

/// 获取基础包 bundle文件路径
/// - Parameter updatePackage: updatePackage
- (NSURL *)getBaseBundleFilePathUrl:(NSDictionary *)updatePackage expectedBundleName:(NSString *)expectedBundleName;

/// 获取基础包bundle文件所在的文件`release_ios`目录
/// - Parameter updatePackage: updatePackage
- (NSString *)getBaseBundleReleaseIosFolder:(NSDictionary *)updatePackage;

- (NSDictionary *)getCurrentPackage:(NSError **)error;
- (NSDictionary *)getPreviousPackage:(NSError **)error;
- (NSString *)getCurrentPackageFolderPath:(NSError **)error;
- (NSString *)getCurrentPackageBundlePath:(NSError **)error;
- (NSString *)getCurrentPackageHash:(NSError **)error;

/// 获取动态bundle的basePackageHash
/// - Parameter error: error
- (NSString *)getDynamicBundleBasePackageHash:(NSError **)error;

- (NSMutableDictionary *)getCurrentPackageInfo:(NSError **)error;

- (NSDictionary *)getPackage:(NSString *)packageHash
                       error:(NSError **)error;

- (NSString *)getPackageFolderPath:(NSString *)packageHash;

- (BOOL)installPackage:(NSDictionary *)updatePackage
   removePendingUpdate:(BOOL)removePendingUpdate
                 error:(NSError **)error;

- (void)rollbackPackage;

// The below methods are only used during tests.
- (void)clearUpdates;
- (void)downloadAndReplaceCurrentBundle:(NSString *)remoteBundleUrl;


- (BOOL)bundleFileExists:(NSString *)packageHash expectedBundleName:(NSString *)expectedBundleName;

@end

@interface CodePushTelemetryManager : NSObject

- (instancetype)initWithDeploymentKey:(NSString *)deploymentKey;

- (NSDictionary *)getBinaryUpdateReport:(NSString *)appVersion;
- (NSDictionary *)getRetryStatusReport;
- (NSDictionary *)getRollbackReport:(NSDictionary *)lastFailedPackage;
- (NSDictionary *)getUpdateReport:(NSDictionary *)currentPackage;
- (void)recordStatusReported:(NSDictionary *)statusReport;
- (void)saveStatusReportForRetry:(NSDictionary *)statusReport;

@end

@interface CodePushUpdateUtils : NSObject

+ (BOOL)copyEntriesInFolder:(NSString *)sourceFolder
                 destFolder:(NSString *)destFolder
                      error:(NSError **)error;

+ (NSString *)findMainBundleInFolder:(NSString *)folderPath
                    expectedFileName:(NSString *)expectedFileName
                               error:(NSError **)error;

+ (NSString *)assetsFolderName;
+ (NSString *)getHashForBinaryContents:(NSURL *)binaryBundleUrl
                              codePush:(CodePush *)codePush
                                 error:(NSError **)error;

+ (NSString *)manifestFolderPrefix;
+ (NSString *)modifiedDateStringOfFileAtURL:(NSURL *)fileURL;

/// 获取动态bundle的文件修改时间，也就是App构建时间
+ (NSString *)dymanicBundleModifiedDateString;

+ (BOOL)isHashIgnoredFor:(NSString *) relativePath;

+ (BOOL)verifyFolderHash:(NSString *)finalUpdateFolder
                   expectedHash:(NSString *)expectedHash
                          error:(NSError **)error;

// remove BEGIN / END tags and line breaks from public key string
+ (NSString *)getKeyValueFromPublicKeyString:(NSString *)publicKeyString;

+ (NSString *)getSignatureFilePath:(NSString *)updateFolderPath;

+ (NSDictionary *) verifyAndDecodeJWT:(NSString *) jwt
               withPublicKey:(NSString *)publicKey
                       error:(NSError **)error;

+ (BOOL)verifyUpdateSignatureFor:(NSString *)updateFolderPath
                    expectedHash:(NSString *)newUpdateHash
                   withPublicKey:(NSString *)publicKeyString
                           error:(NSError **)error;

@end

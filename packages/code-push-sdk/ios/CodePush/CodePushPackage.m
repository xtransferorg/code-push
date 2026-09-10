#import "CodePush.h"
#import "SSZipArchive.h"
#import "hpatch_objc.h"

static dispatch_semaphore_t _hpatchGlobalLock;

__attribute__((constructor))
static void _initHpatchLock(void) {
	_hpatchGlobalLock = dispatch_semaphore_create(1);
}

@implementation CodePushPackage

#pragma mark - Private constants

static NSString *const DiffManifestFileName = @"hotcodepush.json";
static NSString *const DownloadFileName = @"download.zip";
static NSString *const RelativeBundlePathKey = @"bundlePath";
static NSString *const StatusFile = @"codepush.json";
static NSString *const UpdateBundleFileName = @"app.jsbundle";
static NSString *const UpdateMetadataFileName = @"app.json";
static NSString *const UnzippedFolderName = @"unzipped";
static NSString *const IOSFolderName = @"release_ios";
static int const DiffPatchSuccessCode = 0;

#pragma mark - Public methods

- (void)clearUpdates
{
    [[NSFileManager defaultManager] removeItemAtPath:[self getCodePushPath] error:nil];
}

- (void)downloadAndReplaceCurrentBundle:(NSString *)remoteBundleUrl
{
    NSURL *urlRequest = [NSURL URLWithString:remoteBundleUrl];
    NSError *error = nil;
    NSString *downloadedBundle = [NSString stringWithContentsOfURL:urlRequest
                                                          encoding:NSUTF8StringEncoding
                                                             error:&error];
    
    if (error) {
        CPLog(@"Error downloading from URL %@", remoteBundleUrl);
    } else {
        NSString *currentPackageBundlePath = [self getCurrentPackageBundlePath:&error];
        [downloadedBundle writeToFile:currentPackageBundlePath
                           atomically:YES
                             encoding:NSUTF8StringEncoding
                                error:&error];
    }
}

- (void)downloadPackage:(NSDictionary *)updatePackage
 expectedBundleFileName:(NSString *)expectedBundleFileName
              publicKey:(NSString *)publicKey
         operationQueue:(dispatch_queue_t)operationQueue
       progressCallback:(void (^)(long long, long long))progressCallback
           doneCallback:(void (^)())doneCallback
           failCallback:(void (^)(NSError *err))failCallback
{
	
    NSString *newUpdateHash = updatePackage[@"packageHash"];
		NSString *basePackageHash = updatePackage[@"basePackageHash"];
	
		if (![self isBinaryBundle] && ![self isExistsBaseBundleFile:updatePackage expectedBundleName:expectedBundleFileName] && basePackageHash) {
			newUpdateHash = basePackageHash;
		}
	
    NSString *newUpdateFolderPath = [self getPackageFolderPath:newUpdateHash];
    NSString *newUpdateMetadataPath = [newUpdateFolderPath stringByAppendingPathComponent:UpdateMetadataFileName];
    NSError *error;
    
    if ([[NSFileManager defaultManager] fileExistsAtPath:newUpdateFolderPath]) {
        // This removes any stale data in newUpdateFolderPath that could have been left
        // uncleared due to a crash or error during the download or install process.
        [[NSFileManager defaultManager] removeItemAtPath:newUpdateFolderPath
                                                   error:&error];
    } else if (![[NSFileManager defaultManager] fileExistsAtPath:[self getCodePushPath]]) {
        [[NSFileManager defaultManager] createDirectoryAtPath:[self getCodePushPath]
                                  withIntermediateDirectories:YES
                                                   attributes:nil
                                                        error:&error];
                                                        
        // Ensure that none of the CodePush updates we store on disk are
        // ever included in the end users iTunes and/or iCloud backups
        NSURL *codePushURL = [NSURL fileURLWithPath:[self getCodePushPath]];
        [codePushURL setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:nil];
    }
    
    if (error) {
        return failCallback(error);
    }
    
    NSString *downloadFilePath = [self getDownloadFilePath];
    NSString *bundleFilePath = [newUpdateFolderPath stringByAppendingPathComponent:UpdateBundleFileName];
    
    NSString *downloadDiffUrl = updatePackage[@"downloadDiffUrl"];
    int64_t downloadDiffSize = [updatePackage[@"downloadDiffSize"] longLongValue];
    BOOL isDiffAvailable = [updatePackage[@"isDiffAvailable"] boolValue];
    BOOL needRollbackFullBundle = [updatePackage[RollbackFullBundleUpdatePackage] boolValue];
    isDiffAvailable = !needRollbackFullBundle && downloadDiffUrl.length > 0 && downloadDiffSize > 0 && isDiffAvailable;
	
		CPLog(@"isDiffAvailable：%@", @(isDiffAvailable));
	
    CodePushDownloadHandler *downloadHandler = [[CodePushDownloadHandler alloc]
                                                init:downloadFilePath
                                                operationQueue:operationQueue
                                                progressCallback:progressCallback
                                                doneCallback:^(BOOL isZip) {
                                                    NSError *error = nil;
                                                    NSString * unzippedFolderPath = [self getUnzippedFolderPath];
                                                    NSMutableDictionary * mutableUpdatePackage = [updatePackage mutableCopy];
                                                    if (isZip || isDiffAvailable) {
                                                        [self handleDownloadResourceWithPackage:updatePackage downloadFilePath:downloadFilePath newUpdateFolderPath:newUpdateFolderPath newUpdateMetadataPath:newUpdateMetadataPath newUpdateHash:newUpdateHash expectedBundleFileName:expectedBundleFileName publicKey:publicKey isZip:isZip    operationQueue:operationQueue progressCallback:progressCallback doneCallback:doneCallback  failCallback:failCallback];
                                                        return;
                                                    } else {
                                                        [[NSFileManager defaultManager] createDirectoryAtPath:newUpdateFolderPath
                                                                                  withIntermediateDirectories:YES
                                                                                                   attributes:nil
                                                                                                        error:&error];
                                                        [[NSFileManager defaultManager] moveItemAtPath:downloadFilePath
                                                                                                toPath:bundleFilePath
                                                                                                 error:&error];
                                                        if (error) {
                                                            failCallback(error);
                                                            return;
                                                        }
                                                    }
                                                    
                                                    NSData *updateSerializedData = [NSJSONSerialization dataWithJSONObject:mutableUpdatePackage
                                                                                                                   options:0
                                                                                                                     error:&error];
                                                    NSString *packageJsonString = [[NSString alloc] initWithData:updateSerializedData
                                                                                                        encoding:NSUTF8StringEncoding];
                                                    
                                                    [packageJsonString writeToFile:newUpdateMetadataPath
                                                                        atomically:YES
                                                                          encoding:NSUTF8StringEncoding
                                                                             error:&error];
                                                    if (error) {
                                                        failCallback(error);
                                                    } else {
                                                        doneCallback();
                                                    }
                                                }
                                                
                                                failCallback:failCallback];
    
		if (![self isBinaryBundle] && ![self isExistsBaseBundleFile:updatePackage expectedBundleName:expectedBundleFileName]) {
			[downloadHandler download:updatePackage[@"baseDownloadUrl"]];
			return;
		}
    
    if (isDiffAvailable) {
        [downloadHandler download:downloadDiffUrl];
    } else {
				[downloadHandler download:updatePackage[@"downloadUrl"]];
    }
}

- (void)handleDownloadResourceWithPackage:(NSDictionary *)updatePackage
                         downloadFilePath:(NSString *)downloadFilePath
                      newUpdateFolderPath:(NSString *)newUpdateFolderPath
                    newUpdateMetadataPath:(NSString *)newUpdateMetadataPath
                            newUpdateHash:(NSString *)newUpdateHash
                   expectedBundleFileName:(NSString *)expectedBundleFileName
                                publicKey:(NSString *)publicKey
                                    isZip:(BOOL)isZip
                           operationQueue:(dispatch_queue_t)operationQueue
                         progressCallback:(void (^)(long long, long long))progressCallback
                             doneCallback:(void (^)())doneCallback
                             failCallback:(void (^)(NSError *err))failCallback {
    NSError *error = nil;
    NSString * unzippedFolderPath = [self getUnzippedFolderPath];
    NSMutableDictionary * mutableUpdatePackage = [updatePackage mutableCopy];
    if ([[NSFileManager defaultManager] fileExistsAtPath:unzippedFolderPath]) {
        // This removes any unzipped download data that could have been left
        // uncleared due to a crash or error during the download process.
        [[NSFileManager defaultManager] removeItemAtPath:unzippedFolderPath
                                                   error:&error];
        if (error) {
            failCallback(error);
            return;
        }
    }
    
    NSError *nonFailingError = nil;
    if (isZip) { // Zip包
		NSString *tempBundleName = [expectedBundleFileName stringByDeletingPathExtension] ?: @"";
		CPLog(@"XT_BUNDLE_UNZIP_START: %@", tempBundleName);
		
		[[NSNotificationCenter defaultCenter] postNotificationName:@"XT_BUNDLE_UNZIP_START" object:self userInfo:@{@"bundleName": tempBundleName}];
		
		BOOL isZipArchiveSuccess = [SSZipArchive unzipFileAtPath:downloadFilePath
                        toDestination:unzippedFolderPath];
			
		CPLog(@"XT_BUNDLE_UNZIP_END");
		[[NSNotificationCenter defaultCenter] postNotificationName:@"XT_BUNDLE_UNZIP_END" object:self userInfo:@{@"bundleName": tempBundleName}];
			
		if (!isZipArchiveSuccess) {
			CPLog(@"SSZipArchive unzip failed for: %@", tempBundleName);
			failCallback([CodePushErrorUtils errorWithMessage:@"SSZipArchive Failed to unzip the update package"]);
			return;
		}
			
    } else { // Patch文件
        //downloadFilePath
        // 内置包路径 xxxx/xt-app-main.jsbundle
        NSURL *baseBundlePath = [self.codePush binaryBundleURL]; 
        if (!baseBundlePath) {
            baseBundlePath = [self getBaseBundleFilePathUrl:updatePackage expectedBundleName:expectedBundleFileName];
        }
        BOOL hasCurrentPackageDiff = [mutableUpdatePackage[@"hasCurrentPackageDiff"] boolValue];
        BOOL useCurrentPackageDiff = NO;
        NSString *previousPackageHash = mutableUpdatePackage[@"previousPackageHash"];
        if (hasCurrentPackageDiff &&
            previousPackageHash &&
            previousPackageHash.length > 0) {
            NSString *currentFileName = [baseBundlePath lastPathComponent];
            useCurrentPackageDiff = [self bundleFileExists:previousPackageHash expectedBundleName:currentFileName];
        }
        NSString *destBasePath = nil;
        NSString *previousPackageFolderPath = nil;
		if (useCurrentPackageDiff) {
            // 基于当前已合并的包做 diff，不再用内置包，避免越更越大
            previousPackageFolderPath = [self getPackageFolderPath:previousPackageHash];
            destBasePath = [previousPackageFolderPath stringByAppendingPathComponent:IOSFolderName];
        } else {
            // bundle名称，比如：xt-app-main
            NSString *bundleName = baseBundlePath.URLByDeletingPathExtension.lastPathComponent;
            // 拷贝内置包到某个目录下 3.4.4_xt-app-main
            destBasePath = [[CodePush getApplicationSupportDirectory] stringByAppendingPathComponent:[NSString stringWithFormat:@"%@_%@", [self appVersion], bundleName]];
            // 拷贝内置包到这个路径 3.4.4_xt-app-main/xt-app-main.jsbundle
            NSString *destFilePath = [destBasePath stringByAppendingPathComponent:baseBundlePath.lastPathComponent];
            
            if (![[NSFileManager defaultManager] fileExistsAtPath:destFilePath]) {
                //不存在该文件,创建这个目录,并拷贝内置包到这个路径
                [[NSFileManager defaultManager] createDirectoryAtPath:destBasePath
                                        withIntermediateDirectories:YES
                                                        attributes:nil
                                                                error:&error];
                [[NSFileManager defaultManager] copyItemAtPath:[baseBundlePath path]
                                                        toPath:destFilePath
                                                        error:&error];
                if (error) {
                    failCallback(error);
                    return;
                }
            }
        }
        
        // 先判断是否存在unzippedFolderPath目录，存在直接删掉整个目录
        if ([[NSFileManager defaultManager] fileExistsAtPath:unzippedFolderPath]) {
            [[NSFileManager defaultManager] removeItemAtPath:unzippedFolderPath
                                                       error:&error];
            if (error) {
                failCallback(error);
                return;
            }
        }
        // newFileFolder 是 unzippedFolderPath 的子目录，创建这个newFileFolder目录
        if (![[NSFileManager defaultManager] fileExistsAtPath:unzippedFolderPath]) {
            //创建newFileFolder这个目录
            [[NSFileManager defaultManager] createDirectoryAtPath:unzippedFolderPath
                                      withIntermediateDirectories:YES
                                                       attributes:nil
                                                            error:&error];
            if (error) {
                failCallback(error);
                return;
            }
            
        }
        [self.codePush dispatchPatchStateEvent:CodePushPatchSTART code:-1];
			
        CPLog(@"开始调用patchWithOld：%@", expectedBundleFileName);
                    
        long lockResult = dispatch_semaphore_wait(_hpatchGlobalLock, dispatch_time(DISPATCH_TIME_NOW, 2LL * NSEC_PER_SEC));
        
        int result = (lockResult == 0) ? [hpatcher patchWithOld:destBasePath withDiff:downloadFilePath toNew:unzippedFolderPath] : -1000;
        
        if (lockResult == 0) {
            dispatch_semaphore_signal(_hpatchGlobalLock);
        }

//        int result = [hpatcher patchWithOld:destBasePath withDiff:downloadFilePath toNew:unzippedFolderPath];
        CPLog(@"patchWithOld：%@", @(result));
			
        if (result == DiffPatchSuccessCode) {
            [self.codePush dispatchPatchStateEvent:CodePushPatchDone code:result];
            // hash一致性校验
            if (![CodePushUpdateUtils verifyFolderHash:unzippedFolderPath
                                          expectedHash:newUpdateHash
                                                 error:&error]) {
                CPLog(@"The update contents failed the data integrity check.");
                // hash校验不一致，抛出错误
                failCallback([CodePushErrorUtils errorWithMessage:@"The update contents failed patch hash verity"]);
                return;
            } else {
                CPLog(@"The update contents succeeded the data integrity check.");
                // if (previousPackageFolderPath.length > 0) {
                //     NSError *previousError = nil;
                //     [[NSFileManager defaultManager] removeItemAtPath:previousPackageFolderPath error:&previousError];
                // }
            }
        } else {
            [self.codePush dispatchPatchStateEvent:CodePushPatchERROR code:result];
            //patch不一致，走全量
            NSDictionary *fullBundleUpdatePackage = [updatePackage mutableCopy];
            [fullBundleUpdatePackage setValue:@(YES) forKey:RollbackFullBundleUpdatePackage];
            [self.codePush setValue:@(NO) forKey:@"didUpdateProgress"];
            [self.codePush setValue:@(NO) forKey:@"paused"];
            [self downloadPackage:fullBundleUpdatePackage expectedBundleFileName:expectedBundleFileName publicKey:publicKey operationQueue:operationQueue progressCallback:progressCallback doneCallback:doneCallback failCallback:failCallback];
            return;
        }
    }
	
    [[NSFileManager defaultManager] removeItemAtPath:downloadFilePath
                                               error:&nonFailingError];
	
		if (![self isBinaryBundle]) {
			NSString *destBasePath = [[CodePush getApplicationSupportDirectory] stringByAppendingPathComponent:[NSString stringWithFormat:@"%@_%@", [self appVersion], [expectedBundleFileName stringByDeletingPathExtension]]];
			[[NSFileManager defaultManager] removeItemAtPath:destBasePath
																								 error:&nonFailingError];
		}
    
    if (nonFailingError) {
        CPLog(@"Error deleting downloaded file: %@", nonFailingError);
        nonFailingError = nil;
    }
    
    NSString *diffManifestFilePath = [unzippedFolderPath stringByAppendingPathComponent:DiffManifestFileName];
    BOOL isDiffUpdate = [[NSFileManager defaultManager] fileExistsAtPath:diffManifestFilePath];
    
    if (isDiffUpdate) {
        // Copy the current package to the new package.
        NSString *currentPackageFolderPath = [self getCurrentPackageFolderPath:&error];
        if (error) {
            failCallback(error);
            return;
        }
        
        if (currentPackageFolderPath == nil) {
            // Currently running the binary version, copy files from the bundled resources
            NSString *newUpdateCodePushPath = [newUpdateFolderPath stringByAppendingPathComponent:[CodePushUpdateUtils manifestFolderPrefix]];
            [[NSFileManager defaultManager] createDirectoryAtPath:newUpdateCodePushPath
                                      withIntermediateDirectories:YES
                                                       attributes:nil
                                                            error:&error];
            if (error) {
                failCallback(error);
                return;
            }
            
            [[NSFileManager defaultManager] copyItemAtPath:[self.codePush bundleAssetsPath]
                                                    toPath:[newUpdateCodePushPath stringByAppendingPathComponent:[CodePushUpdateUtils assetsFolderName]]
                                                     error:&error];
            if (error) {
                failCallback(error);
                return;
            }
            
            [[NSFileManager defaultManager] copyItemAtPath:[[self.codePush binaryBundleURL] path]
                                                    toPath:[newUpdateCodePushPath stringByAppendingPathComponent:[[self.codePush binaryBundleURL] lastPathComponent]]
                                                     error:&error];
            if (error) {
                failCallback(error);
                return;
            }
        } else {
            [[NSFileManager defaultManager] copyItemAtPath:currentPackageFolderPath
                                                    toPath:newUpdateFolderPath
                                                     error:&error];
            if (error) {
                failCallback(error);
                return;
            }
        }
        
        // Delete files mentioned in the manifest.
        NSString *manifestContent = [NSString stringWithContentsOfFile:diffManifestFilePath
                                                              encoding:NSUTF8StringEncoding
                                                                 error:&error];
        if (error) {
            failCallback(error);
            return;
        }
        
        NSData *data = [manifestContent dataUsingEncoding:NSUTF8StringEncoding];
        NSDictionary *manifestJSON = [NSJSONSerialization JSONObjectWithData:data
                                                                     options:kNilOptions
                                                                       error:&error];
        NSArray *deletedFiles = manifestJSON[@"deletedFiles"];
        for (NSString *deletedFileName in deletedFiles) {
            NSString *absoluteDeletedFilePath = [newUpdateFolderPath stringByAppendingPathComponent:deletedFileName];
            if ([[NSFileManager defaultManager] fileExistsAtPath:absoluteDeletedFilePath]) {
                [[NSFileManager defaultManager] removeItemAtPath:absoluteDeletedFilePath
                                                           error:&error];
                if (error) {
                    failCallback(error);
                    return;
                }
            }
        }
        
        [[NSFileManager defaultManager] removeItemAtPath:diffManifestFilePath
                                                   error:&error];
        if (error) {
            failCallback(error);
            return;
        }
    }
    
    [CodePushUpdateUtils copyEntriesInFolder:unzippedFolderPath
                                  destFolder:newUpdateFolderPath
                                       error:&error];
    if (error) {
        failCallback(error);
        return;
    }
    
    [[NSFileManager defaultManager] removeItemAtPath:unzippedFolderPath
                                               error:&nonFailingError];
    if (nonFailingError) {
        CPLog(@"Error deleting downloaded file: %@", nonFailingError);
        nonFailingError = nil;
    }
    
    NSString *relativeBundlePath = [CodePushUpdateUtils findMainBundleInFolder:newUpdateFolderPath
                                                              expectedFileName:expectedBundleFileName
                                                                         error:&error];
    
    if (error) {
        failCallback(error);
        return;
    }
    
    if (relativeBundlePath) {
        [mutableUpdatePackage setValue:relativeBundlePath forKey:RelativeBundlePathKey];
    } else {
        NSString *errorMessage = [NSString stringWithFormat:@"Update is invalid - A JS bundle file named \"%@\" could not be found within the downloaded contents. Please ensure that your app is syncing with the correct deployment and that you are releasing your CodePush updates using the exact same JS bundle file name that was shipped with your app's binary.", expectedBundleFileName];
        
        error = [CodePushErrorUtils errorWithMessage:errorMessage];
        
        failCallback(error);
        return;
    }
    
    if ([[NSFileManager defaultManager] fileExistsAtPath:newUpdateMetadataPath]) {
        [[NSFileManager defaultManager] removeItemAtPath:newUpdateMetadataPath
                                                   error:&error];
        if (error) {
            failCallback(error);
            return;
        }
    }
    
    CPLog((isDiffUpdate) ? @"Applying diff update." : @"Applying full update.");
    
    BOOL isSignatureVerificationEnabled = (publicKey != nil);
    
    NSString *signatureFilePath = [CodePushUpdateUtils getSignatureFilePath:newUpdateFolderPath];
    BOOL isSignatureAppearedInBundle = [[NSFileManager defaultManager] fileExistsAtPath:signatureFilePath];
    
    if (isSignatureVerificationEnabled) {
        if (isSignatureAppearedInBundle) {
            if (![CodePushUpdateUtils verifyFolderHash:newUpdateFolderPath
                                          expectedHash:newUpdateHash
                                                 error:&error]) {
                CPLog(@"The update contents failed the data integrity check.");
                if (!error) {
                    error = [CodePushErrorUtils errorWithMessage:@"The update contents failed the data integrity check."];
                }
                
                failCallback(error);
                return;
            } else {
                CPLog(@"The update contents succeeded the data integrity check.");
            }
            BOOL isSignatureValid = [CodePushUpdateUtils verifyUpdateSignatureFor:newUpdateFolderPath
                                                                     expectedHash:newUpdateHash
                                                                    withPublicKey:publicKey
                                                                            error:&error];
            if (!isSignatureValid) {
                CPLog(@"The update contents failed code signing check.");
                if (!error) {
                    error = [CodePushErrorUtils errorWithMessage:@"The update contents failed code signing check."];
                }
                failCallback(error);
                return;
            } else {
                CPLog(@"The update contents succeeded the code signing check.");
            }
        } else {
            error = [CodePushErrorUtils errorWithMessage:
                     @"Error! Public key was provided but there is no JWT signature within app bundle to verify " \
                     "Possible reasons, why that might happen: \n" \
                     "1. You've been released CodePush bundle update using version of CodePush CLI that is not support code signing.\n" \
                     "2. You've been released CodePush bundle update without providing --privateKeyPath option."];
            failCallback(error);
            return;
        }
        
    } else {
        BOOL needToVerifyHash;
        if (isSignatureAppearedInBundle) {
            CPLog(@"Warning! JWT signature exists in codepush update but code integrity check couldn't be performed" \
                  " because there is no public key configured. " \
                  "Please ensure that public key is properly configured within your application.");
            needToVerifyHash = true;
        } else {
            CPLog(@"isDiffUpdate：%@", @(isDiffUpdate));
            // 开启 全量包的 hash 校验
            needToVerifyHash = YES;
        }
        if(needToVerifyHash){
            if (![CodePushUpdateUtils verifyFolderHash:newUpdateFolderPath
                                          expectedHash:newUpdateHash
                                                 error:&error]) {
                CPLog(@"The update contents failed the data integrity check.");
                if (!error) {
                    error = [CodePushErrorUtils errorWithMessage:@"The update contents failed the data integrity check."];
                }
                
                failCallback(error);
                return;
            } else {
                CPLog(@"The update contents succeeded the data integrity check.");
            }
        }
    }
    
    // //
    NSData *updateSerializedData = [NSJSONSerialization dataWithJSONObject:mutableUpdatePackage
                                                                   options:0
                                                                     error:&error];
    NSString *packageJsonString = [[NSString alloc] initWithData:updateSerializedData
                                                        encoding:NSUTF8StringEncoding];
    
    [packageJsonString writeToFile:newUpdateMetadataPath
                        atomically:YES
                          encoding:NSUTF8StringEncoding
                             error:&error];
    if (error) {
        failCallback(error);
    } else {
        doneCallback();
    }
    
}

- (BOOL)isBinaryBundle {
	NSURL *binaryBundleURL = [self.codePush binaryBundleURL];
	
	if (binaryBundleURL) {
		return YES;
	}
	
	return NO;
}

- (BOOL)isExistsBaseBundleFile:(NSDictionary *)updatePackage expectedBundleName:(NSString *)expectedBundleName {
	return [self bundleFileExists:updatePackage[@"basePackageHash"] expectedBundleName:expectedBundleName];
}

- (BOOL)isExistsDynamicBundleLatestDiffFile:(NSDictionary *)updatePackage expectedBundleName:(NSString *)expectedBundleName {
	return [self bundleFileExists:updatePackage[@"packageHash"] expectedBundleName:expectedBundleName];
}

- (BOOL)bundleFileExists:(NSString *)hash expectedBundleName:(NSString *)expectedBundleName {
	NSString *newUpdateFolderPath = [self getPackageFolderPath:hash];
	
	NSString *releaseIosFolder = [newUpdateFolderPath stringByAppendingPathComponent:@"release_ios"];
	
	NSString *filePath = [releaseIosFolder stringByAppendingPathComponent:expectedBundleName];
	
	BOOL isDir = NO;
	BOOL exists = [[NSFileManager defaultManager] fileExistsAtPath:filePath isDirectory:&isDir];
	
	return exists && !isDir;
}


- (NSURL *)getBaseBundleFilePathUrl:(NSDictionary *)updatePackage expectedBundleName:(NSString *)expectedBundleName {
	NSString *baseBundleFolder = [self getBaseBundleReleaseIosFolder:updatePackage];
	
	baseBundleFolder = [baseBundleFolder stringByAppendingPathComponent:expectedBundleName];
	
	NSURL *baseBundleFilePathUrl = [NSURL fileURLWithPath:baseBundleFolder];
    
	return baseBundleFilePathUrl;
}

- (NSString *)getBaseBundleReleaseIosFolder:(NSDictionary *)updatePackage {
	NSString *baseBundleFolder = [self baseBundleFileFolder:updatePackage];
	
	NSString *releaseIosFolder = [baseBundleFolder stringByAppendingPathComponent:@"release_ios"];
	
	return releaseIosFolder;
}

- (NSString *)baseBundleFileFolder:(NSDictionary *)updatePackage {
	NSString *basePackageHash = updatePackage[@"basePackageHash"];
	NSString *newUpdateFolderPath = [self getPackageFolderPath:basePackageHash];
	return newUpdateFolderPath;
}

- (NSString *)getCodePushPath
{
    NSString* deploymentKey = [self.codePush deploymentKey];
    NSString* deploymentKeyCodePush = [NSString stringWithFormat:@"%@%@", deploymentKey, @"CodePush"];
    NSString* codePushPath = [[CodePush getApplicationSupportDirectory] stringByAppendingPathComponent:deploymentKeyCodePush];
    if ([CodePush isUsingTestConfiguration]) {
        codePushPath = [codePushPath stringByAppendingPathComponent:@"TestPackages"];
    }
    
    return codePushPath;
}

- (NSDictionary *)getCurrentPackage:(NSError **)error
{
    NSString *packageHash = [self getCurrentPackageHash:error];
    if (!packageHash) {
        return nil;
    }

    return [self getPackage:packageHash error:error];
}

- (NSString *)getCurrentPackageBundlePath:(NSError **)error
{
    NSString *packageFolder = [self getCurrentPackageFolderPath:error];
    
    if (!packageFolder) {
        return nil;
    }
    
    NSDictionary *currentPackage = [self getCurrentPackage:error];
    
    if (!currentPackage) {
        return nil;
    }
    
    NSString *relativeBundlePath = [currentPackage objectForKey:RelativeBundlePathKey];
    if (relativeBundlePath) {
        return [packageFolder stringByAppendingPathComponent:relativeBundlePath];
    } else {
        return [packageFolder stringByAppendingPathComponent:UpdateBundleFileName];
    }
}

- (NSString *)getCurrentPackageHash:(NSError **)error
{
    NSDictionary *info = [self getCurrentPackageInfo:error];
    if (!info) {
        return nil;
    }
    
    return info[@"currentPackage"];
}

- (NSString *)getDynamicBundleBasePackageHash:(NSError **)error
{
		NSDictionary *info = [self getCurrentPackageInfo:error];
		if (!info) {
				return nil;
		}
		
		return info[@"basePackageHash"];
}

- (NSString *)getCurrentPackageFolderPath:(NSError **)error
{
    NSDictionary *info = [self getCurrentPackageInfo:error];
    
    if (!info) {
        return nil;
    }
    
    NSString *packageHash = info[@"currentPackage"];
    
    if (!packageHash) {
        return nil;
    }
    
    return [self getPackageFolderPath:packageHash];
}

- (NSMutableDictionary *)getCurrentPackageInfo:(NSError **)error
{
    NSString *statusFilePath = [self getStatusFilePath];
    if (![[NSFileManager defaultManager] fileExistsAtPath:statusFilePath]) {
        return [NSMutableDictionary dictionary];
    }
    
    NSString *content = [NSString stringWithContentsOfFile:statusFilePath
                                                  encoding:NSUTF8StringEncoding
                                                     error:error];
    if (!content) {
        return nil;
    }
    
    NSData *data = [content dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary* json = [NSJSONSerialization JSONObjectWithData:data
                                                         options:kNilOptions
                                                           error:error];
    if (!json) {
        return nil;
    }
    
    return [json mutableCopy];
}

- (NSString *)getDownloadFilePath
{
    return [[self getCodePushPath] stringByAppendingPathComponent:DownloadFileName];
}

- (NSDictionary *)getPackage:(NSString *)packageHash
                       error:(NSError **)error
{
    NSString *updateDirectoryPath = [self getPackageFolderPath:packageHash];
    NSString *updateMetadataFilePath = [updateDirectoryPath stringByAppendingPathComponent:UpdateMetadataFileName];
    
    if (![[NSFileManager defaultManager] fileExistsAtPath:updateMetadataFilePath]) {
        return nil;
    }
    
    NSString *updateMetadataString = [NSString stringWithContentsOfFile:updateMetadataFilePath
                                                               encoding:NSUTF8StringEncoding
                                                                  error:error];
    if (!updateMetadataString) {
        return nil;
    }
    
    NSData *updateMetadata = [updateMetadataString dataUsingEncoding:NSUTF8StringEncoding];
    return [NSJSONSerialization JSONObjectWithData:updateMetadata
                                           options:kNilOptions
                                             error:error];
}

- (NSString *)getPackageFolderPath:(NSString *)packageHash
{
	return [[self getCodePushPath] stringByAppendingPathComponent:packageHash];
}

- (NSDictionary *)getPreviousPackage:(NSError **)error
{
    NSString *packageHash = [self getPreviousPackageHash:error];
    if (!packageHash) {
        return nil;
    }
    
    return [self getPackage:packageHash error:error];
}

- (NSString *)getPreviousPackageHash:(NSError **)error
{
    NSDictionary *info = [self getCurrentPackageInfo:error];
    if (!info) {
        return nil;
    }
    
    return info[@"previousPackage"];
}

- (NSString *)getStatusFilePath
{
    return [[self getCodePushPath] stringByAppendingPathComponent:StatusFile];
}

- (NSString *)getUnzippedFolderPath
{
    return [[self getCodePushPath] stringByAppendingPathComponent:UnzippedFolderName];
}

- (BOOL)installPackage:(NSDictionary *)updatePackage
   removePendingUpdate:(BOOL)removePendingUpdate
                 error:(NSError **)error
{
    NSString *packageHash = updatePackage[@"packageHash"];
		NSString *basePackageHash = updatePackage[@"basePackageHash"];
		CPLog(@"packageHash：%@", packageHash);
		CPLog(@"basePackageHash：%@", basePackageHash);
	
    NSMutableDictionary *info = [self getCurrentPackageInfo:error];
    
    if (!info) {
        return NO;
    }
    
    if (packageHash && [packageHash isEqualToString:info[@"currentPackage"]]) {
        // The current package is already the one being installed, so we should no-op.
        return YES;
    }
	
		CPLog(@"removePendingUpdate：%@", @(removePendingUpdate));

    if (removePendingUpdate) {
        NSString *currentPackageFolderPath = [self getCurrentPackageFolderPath:error];
        if (currentPackageFolderPath) {
            // Error in deleting pending package will not cause the entire operation to fail.
            NSError *deleteError;
            [[NSFileManager defaultManager] removeItemAtPath:currentPackageFolderPath
                                                       error:&deleteError];
            if (deleteError) {
                CPLog(@"Error deleting pending package: %@", deleteError);
            }
        }
    } else {
        NSString *previousPackageHash = [self getPreviousPackageHash:error];
				CPLog(@"previousPackageHash：%@", previousPackageHash);
			
        if (previousPackageHash && ![previousPackageHash isEqualToString:packageHash]) {
            NSString *previousPackageFolderPath = [self getPackageFolderPath:previousPackageHash];
            // Error in deleting old package will not cause the entire operation to fail.
            NSError *deleteError;
					
						if (![previousPackageHash isEqualToString:basePackageHash]) {
							[[NSFileManager defaultManager] removeItemAtPath:previousPackageFolderPath
																												 error:&deleteError];
						}
            
            if (deleteError) {
                CPLog(@"Error deleting old package: %@", deleteError);
            }
        }
        [info setValue:info[@"currentPackage"] forKey:@"previousPackage"];
    }
    
    [info setValue:packageHash forKey:@"currentPackage"];
		
		if (basePackageHash) {
			[info setValue:basePackageHash forKey:@"basePackageHash"];
		}
	
    return [self updateCurrentPackageInfo:info
                                    error:error];
}

- (void)rollbackPackage
{
    NSError *error;
    NSMutableDictionary *info = [self getCurrentPackageInfo:&error];
    if (!info) {
        CPLog(@"Error getting current package info: %@", error);
        return;
    }
    
    NSString *currentPackageFolderPath = [self getCurrentPackageFolderPath:&error];        
    if (!currentPackageFolderPath) {
        CPLog(@"Error getting current package folder path: %@", error);
        return;
    }
    
    NSError *deleteError;
    BOOL result = [[NSFileManager defaultManager] removeItemAtPath:currentPackageFolderPath
                                               error:&deleteError];
    if (!result) {
        CPLog(@"Error deleting current package contents at %@ error %@", currentPackageFolderPath, deleteError);
    }
    
    [info setValue:info[@"previousPackage"] forKey:@"currentPackage"];
    [info removeObjectForKey:@"previousPackage"];
    
    [self updateCurrentPackageInfo:info error:&error];
}

- (BOOL)updateCurrentPackageInfo:(NSDictionary *)packageInfo
                           error:(NSError **)error
{
    NSData *packageInfoData = [NSJSONSerialization dataWithJSONObject:packageInfo
                                                              options:0
                                                                error:error];
    if (!packageInfoData) {
        return NO;
    }

    NSString *packageInfoString = [[NSString alloc] initWithData:packageInfoData
                                                        encoding:NSUTF8StringEncoding];
    BOOL result = [packageInfoString writeToFile:[self getStatusFilePath]
                        atomically:YES
                          encoding:NSUTF8StringEncoding
                             error:error];

    if (!result) {
        return NO;
    }
    return YES;
}

- (NSString *)appVersion {
    NSDictionary *infoDictionary = [[NSBundle mainBundle] infoDictionary];
    NSString *appVersion = [infoDictionary objectForKey:@"CFBundleShortVersionString"];
    return appVersion;
}

@end

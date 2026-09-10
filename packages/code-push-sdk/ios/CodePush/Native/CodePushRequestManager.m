//
//  CodePushRequestManager.m
//  xtapp
//
//  Created by  xtgq on 2025/7/11.
//  Copyright © 2025 Facebook. All rights reserved.
//

#import "CodePushRequestManager.h"
#import "CodePush-Swift.h"
#import "CodePush.h"
#import "XTJSBundleTool.h"
#import "XTCodePushLabelCompare.h"
#import <react-native-xrn-network/XTNativeNetworkClient.h>

static const NSTimeInterval CodePushRequestTimeout = 2.0;

static NSDictionary<NSString *, NSString *> *CodePushRequestHeaders(void) {
  static NSDictionary<NSString *, NSString *> *headers;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    headers = @{
      @"Accept" : @"application/json",
      @"Content-Type" : @"application/json",
      @"X-CodePush-Plugin-Name" : @"native-code-push-xt-ios",
      @"X-CodePush-Plugin-Version" : @"3.0.0",
      @"X-CodePush-SDK-Version" : @"3.0.0"
    };
  });
  return headers;
}

@interface CodePushRequestManager ()

@property (nonatomic, copy) NSString *serverUrl;
@property (nonatomic, copy) NSString *appVersion;
@property (nonatomic, copy) NSString *clientUniqueId;
@property (nonatomic, copy) NSString *deploymentKey;
@property (nonatomic, assign) BOOL ignoreAppVersion;
@property (nonatomic, copy) NSString *commonHash;
@end

@implementation CodePushRequestManager

- (instancetype)initWithConfiguration:(NSDictionary *)configuration {
  self = [super init];
  if (self) {
    self.serverUrl = configuration[@"serverUrl"];
    if (![self.serverUrl hasSuffix:@"/"]) {
      self.serverUrl = [self.serverUrl stringByAppendingString:@"/"];
    }
    
    self.commonHash = configuration[@"commonHash"];
    self.appVersion = configuration[@"appVersion"];
    self.clientUniqueId = configuration[@"clientUniqueId"] ?: @"";
    self.deploymentKey = configuration[@"deploymentKey"] ?: @"";
    self.ignoreAppVersion = [configuration[@"ignoreAppVersion"] boolValue];
  }
  return self;
}

- (void)queryUpdateWithCurrentPackage:(NSDictionary *)currentPackage staleTime:(nullable NSNumber *)staleTime isPreDownload:(BOOL)isPreDownload callback:(nonnull RequestCallback)callback {
  
  NSString *appVersion = currentPackage[@"appVersion"];
  if (!currentPackage || !appVersion) {
    CPLog(@"Calling common acquisition SDK with incorrect package");
    callback(nil, [CodePushErrorUtil generateError:@"Calling common acquisition SDK with incorrect package"]);
    return;
  }
	
  NSDictionary *updateRequest = @{
    @"deploymentKey": self.deploymentKey,
    @"appVersion": appVersion,
    @"commonHash": self.commonHash ?: @"",
    @"packageHash": currentPackage[@"packageHash"] ?: @"",
    @"isCompanion": @(self.ignoreAppVersion),
    @"label": currentPackage[@"label"] ?: @"",
    @"clientUniqueId": self.clientUniqueId,
    @"basePackageHash": currentPackage[@"basePackageHash"] ?: @"",
  };
  
  NSString *query = [self generateRawQueryString:updateRequest];
  NSString *requestUrl = [NSString stringWithFormat:@"%@updateCheck?%@", self.serverUrl, query];
	
  NSDictionary *cachedBatchUpdate = [XTJSBundleTool shared].batchUpdateCacheDate;
  NSDictionary *currentBundleUpdate = cachedBatchUpdate[self.deploymentKey];
  NSDictionary *result = currentBundleUpdate[@"result"];
  NSNumber *cachedAt = currentBundleUpdate[@"cachedAt"];

  if (staleTime != nil && cachedAt != nil) {
    NSTimeInterval ageMs = ([[NSDate date] timeIntervalSince1970] * 1000.0) - cachedAt.doubleValue;
    if (ageMs > staleTime.doubleValue) {
      CPLog(@"batchUpdate缓存已过期，staleTime=%@, cachedAt=%@", staleTime, cachedAt);
      result = nil;
    }
  }

  if (result == nil) {
    CPLog(@"batchUpdate缓存不存在或已过期，继续发起网络请求");
  } else {
  
  NSString *cacheDeploymentKey = result[@"deploymentKey"];
      
  NSString *cacheLabel = result[@"label"];
  NSString *requestLabel = updateRequest[@"label"];
      
      NSString *cacheAppVersion = result[@"appVersion"];
      NSString *requestAppVersion = updateRequest[@"appVersion"];

  BOOL canUseCachedUpdate = [cacheDeploymentKey isEqualToString:self.deploymentKey] &&
          [cacheAppVersion isEqualToString:requestAppVersion] &&
          [XTCodePushLabelCompare isLabelNewer:cacheLabel than:requestLabel];

  if (canUseCachedUpdate) {
    CPLog(@"存在已经batch获取的update数据，直接返回本地数据");
    [self handleCodePushUpdateData:result currentPackage:currentPackage callback:callback];
    return;
  }
  }

  CPLog(@"updateCheck接口：%@", requestUrl);
  __weak __typeof(self) weakSelf = self;

  NSURL *updateCheckURL = [NSURL URLWithString:requestUrl];
  if (updateCheckURL == nil) {
    callback(nil, [CodePushErrorUtil generateError:@"Invalid URL"]);
    return;
  }

  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:updateCheckURL];
  request.HTTPMethod = @"GET";

  XTNativeNetworkRequestOptions *options = [XTNativeNetworkRequestOptions new];
  options.timeoutInterval = CodePushRequestTimeout;
  options.callbackOnMainQueue = NO;
  options.validateHTTPStatusCode = NO;
  options.headers = CodePushRequestHeaders();

  [[XTNativeNetworkClient sharedClient] dataTaskWithRequest:request options:options completion:^(NSData *data, NSHTTPURLResponse *resp, NSError *err) {
    __strong __typeof(weakSelf) strongSelf = weakSelf;

    if (err != nil) {
      callback(nil, err);
      return;
    }

    NSInteger statusCode = resp.statusCode;
    if (statusCode != 200) {
      NSString *errorMsg = @"";
      if (statusCode == 0) {
        errorMsg = [NSString stringWithFormat:@"Couldn't send request to %@, xhr.statusCode = 0 was returned. One of the possible reasons for that might be connection problems. Please, check your internet connection.", strongSelf.serverUrl];
      } else {
        NSDictionary *responseBody = nil;
        if (data.length > 0) {
          id json = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
          if ([json isKindOfClass:[NSDictionary class]]) {
            responseBody = json;
          }
        }
        NSString *resultStr = [CPJSONUtils dictionaryToJsonString:responseBody] ?: @"";
        errorMsg = [NSString stringWithFormat:@"%ld: %@", (long)statusCode, resultStr];
      }

      callback(nil, [CodePushErrorUtil generateError:errorMsg]);
      return;
    }

    if (data.length == 0) {
      callback(nil, [CodePushErrorUtil generateError:@"响应数据为空"]);
      return;
    }

    NSError *jsonError = nil;
    id json = [NSJSONSerialization JSONObjectWithData:data options:0 error:&jsonError];
    if (jsonError != nil || ![json isKindOfClass:[NSDictionary class]]) {
      callback(nil, [CodePushErrorUtil generateError:@"JSON 解析失败"]);
      return;
    }

    CPLog(@"updateCheck response 数据：%@", json);
    NSDictionary *updateInfo = ((NSDictionary *)json)[@"updateInfo"];
    [strongSelf handleCodePushUpdateData:updateInfo currentPackage:currentPackage callback:callback];
  }];
}

- (void)handleCodePushUpdateData:(NSDictionary *)updateInfo currentPackage:(NSDictionary *)currentPackage callback:(nonnull RequestCallback)callback {
	
	BOOL updateAppVersion = [updateInfo[@"updateAppVersion"] boolValue];
	NSString *appVersion = updateInfo[@"appVersion"];
	BOOL isAvailable = [updateInfo[@"isAvailable"] boolValue];

	if (!updateInfo) {
		CPLog(@"没有更新数据");
		callback(nil, nil);
		return;
	} else if (updateAppVersion) {
		CPLog(@"需要更新新版本");
		callback(@{@"updateAppVersion":@(YES), @"appVersion": appVersion}, nil);
		return;
	} else if (!isAvailable) {
		CPLog(@"isAvailable为NO");
		callback(nil, nil);
		return;
	}
	
	// 优先使用 currentPackageDiff（当前包→新包的 diff），否则用顶层 downloadDiffUrl（内置包→新包）
	// 服务端返回示例：downloadDiffUrl 为空、isDiffAvailable 为 false 时，若 currentPackageDiff 有数据则用后者
	NSDictionary *currentPackageDiff = updateInfo[@"currentPackageDiff"];
	NSNumber *isDiffAvailable = updateInfo[@"isDiffAvailable"] ?: @(false);
	NSString *downloadDiffUrl = updateInfo[@"downloadDiffUrl"] ?: @"";
	NSString *downloadDiffSize = updateInfo[@"downloadDiffSize"] ?: @"";
	bool hasCurrentPackageDiff = false;
	if (currentPackageDiff &&
			[currentPackageDiff isKindOfClass:[NSDictionary class]] &&
			[currentPackageDiff[@"isDiffAvailable"] boolValue] &&
			currentPackageDiff[@"downloadDiffUrl"] &&
			[currentPackageDiff[@"downloadDiffSize"] longLongValue] > 0) {
		hasCurrentPackageDiff = true;
		isDiffAvailable = @([currentPackageDiff[@"isDiffAvailable"] boolValue]);
		downloadDiffUrl = currentPackageDiff[@"downloadDiffUrl"];
		downloadDiffSize = currentPackageDiff[@"downloadDiffSize"];
	}
	
	NSDictionary *remotePackage = @{
		@"deploymentKey": self.deploymentKey,
		@"description": updateInfo[@"description"] ?: @"",
		@"label": updateInfo[@"label"] ?: @"",
		@"appVersion": updateInfo[@"appVersion"] ?: @"",
		@"isMandatory": updateInfo[@"isMandatory"] ?: @(YES),
		@"packageHash": updateInfo[@"packageHash"] ?: @"",
		@"packageSize": updateInfo[@"packageSize"] ?: @"",
		@"downloadUrl": updateInfo[@"downloadUrl"] ?: @"",
		@"originalLabel": updateInfo[@"originalLabel"] ?: @"",
		@"hasCurrentPackageDiff": @(hasCurrentPackageDiff),
		@"previousPackageHash": currentPackage[@"packageHash"] ?: @"",
		@"isDiffAvailable": isDiffAvailable,
		@"downloadDiffUrl": downloadDiffUrl,
		@"downloadDiffSize": downloadDiffSize,
		@"isAvailable": updateInfo[@"isAvailable"] ?: @(false),
		@"basePackageHash": updateInfo[@"basePackageHash"] ?: @"",
		@"baseDownloadUrl": updateInfo[@"baseDownloadUrl"] ?: @"",
		@"basePackageSize": updateInfo[@"basePackageSize"] ?: @""
	};
	
	callback(remotePackage, nil);
	return;
}

- (void)reportStatusDeploy:(NSDictionary *)deployedPackage status:(NSString *)status previousLabelOrAppVersion:(NSString *)previousLabelOrAppVersion previousDeploymentKey:(NSString *)previousDeploymentKey callback:(nonnull RequestCallback)callback {
  
  NSString *url = [NSString stringWithFormat:@"%@reportStatus/deploy", self.serverUrl];
  
  NSMutableDictionary *body = [NSMutableDictionary dictionary];
  [body setObject:self.appVersion forKey:@"appVersion"];
  [body setObject:self.deploymentKey forKey:@"deploymentKey"];
  
  if (self.clientUniqueId) {
    [body setObject:self.clientUniqueId forKey:@"clientUniqueId"];
  }
  
  if (deployedPackage) {
    [body setObject:deployedPackage[@"label"] forKey:@"label"];
    [body setObject:deployedPackage[@"appVersion"] forKey:@"appVersion"];
    [body setObject:deployedPackage[@"patchFailed"] ?: @(NO) forKey:@"patchFailed"];
    
    if ([status isEqualToString: @"DeploymentFailed"] ||
        [status isEqualToString:@"DeploymentSucceeded"]) {
      [body setObject:status forKey:@"status"];
    } else {
      if (callback) {
        if (!status) {
          callback(nil, [CodePushErrorUtil generateError:@"Missing status argument."]);
        } else {
          callback(nil, [CodePushErrorUtil generateError:[NSString stringWithFormat:@"Unrecognized status: %@", status]]);
        }
      }
      
      return;
    }
  }
  
  if (previousLabelOrAppVersion) {
    [body setObject:previousLabelOrAppVersion forKey:@"previousLabelOrAppVersion"];
  }
  
  if (previousDeploymentKey) {
    [body setObject:previousDeploymentKey forKey:@"previousDeploymentKey"];
  }

  [self reportPostURL:url body:body callback:callback];
}

- (void)reportStatusDownload:(NSDictionary *)downloadedPackage callback:(RequestCallback)callback {
  
  NSString *url = [NSString stringWithFormat:@"%@reportStatus/download", self.serverUrl];
  
  NSMutableDictionary *body = [NSMutableDictionary dictionary];
  [body setObject:self.clientUniqueId forKey:@"clientUniqueId"];
  [body setObject:self.deploymentKey forKey:@"deploymentKey"];
  
  NSString *label = downloadedPackage[@"label"] ?: @"";
  [body setObject:label forKey:@"label"];

  [self reportPostURL:url body:body callback:callback];
}

/// reportStatus 专用：POST JSON body，仅校验 HTTP 状态码，不强求响应有 JSON body。
/// 服务端 report 接口通常返回 200 + 空 body，不能用 postJSON（会误报 Empty body 错误）。
- (void)reportPostURL:(NSString *)url body:(NSDictionary *)body callback:(RequestCallback)callback {
  NSURL *finalURL = [NSURL URLWithString:url];
  if (finalURL == nil) {
    if (callback) callback(nil, [CodePushErrorUtil generateError:@"Invalid URL"]);
    return;
  }

  NSError *encodeError = nil;
  NSData *jsonData = [NSJSONSerialization dataWithJSONObject:body options:0 error:&encodeError];
  if (encodeError != nil) {
    if (callback) callback(nil, [CodePushErrorUtil generateError:@"body 序列化失败"]);
    return;
  }

  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:finalURL];
  request.HTTPMethod = @"POST";
  request.HTTPBody = jsonData;
  [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
  NSDictionary *cpHeaders = CodePushRequestHeaders();
  [cpHeaders enumerateKeysAndObjectsUsingBlock:^(NSString *key, NSString *value, BOOL *stop) {
    [request setValue:value forHTTPHeaderField:key];
  }];

  XTNativeNetworkRequestOptions *options = [XTNativeNetworkRequestOptions new];
  options.timeoutInterval = CodePushRequestTimeout;
  options.callbackOnMainQueue = NO;
  options.validateHTTPStatusCode = NO;

  [[XTNativeNetworkClient sharedClient] dataTaskWithRequest:request options:options completion:^(NSData *data, NSHTTPURLResponse *resp, NSError *err) {
    if (!callback) return;

    if (err != nil) {
      callback(nil, err);
      return;
    }

    NSInteger statusCode = resp.statusCode;
    if (statusCode != 200) {
      NSDictionary *responseBody = nil;
      if (data.length > 0) {
        id json = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if ([json isKindOfClass:[NSDictionary class]]) {
          responseBody = json;
        }
      }
      NSString *bodyStr = [CPJSONUtils dictionaryToJsonString:responseBody] ?: @"";
      callback(nil, [CodePushErrorUtil generateError:[NSString stringWithFormat:@"%ld: %@", (long)statusCode, bodyStr]]);
      return;
    }

    callback(nil, nil);
  }];
}

- (NSString *)generateRawQueryString:(NSDictionary *)params {
  NSMutableArray<NSString *> *pairs = [NSMutableArray array];
  [params enumerateKeysAndObjectsUsingBlock:^(id key, id value, BOOL *stop) {
    NSString *valueString = [value description];
    [pairs addObject:[NSString stringWithFormat:@"%@=%@", key, valueString]];
  }];
  return [pairs componentsJoinedByString:@"&"];
}

@end

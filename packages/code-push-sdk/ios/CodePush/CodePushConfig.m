#import "CodePush.h"
#import <UIKit/UIKit.h>

@implementation CodePushConfig {
    NSMutableDictionary *_configDictionary;
}

static CodePushConfig *_currentConfig;

static NSString * const AppVersionConfigKey = @"appVersion";
static NSString * const BuildVersionConfigKey = @"buildVersion";
static NSString * const ClientUniqueIDConfigKey = @"clientUniqueId";
static NSString * const DeploymentKeyConfigKey = @"deploymentKey";
static NSString * const ServerURLConfigKey = @"serverUrl";
static NSString * const PublicKeyKey = @"publicKey";
static NSString * const BasePackageHashKey = @"basePackageHash";
static NSString * const CommonHash = @"commonHash";

- (instancetype)init
{
    self = [super init];
    NSDictionary *infoDictionary = [[NSBundle mainBundle] infoDictionary];

    NSString *appVersion = [infoDictionary objectForKey:@"CFBundleShortVersionString"];
    NSString *buildVersion = [infoDictionary objectForKey:(NSString *)kCFBundleVersionKey];
    NSString *deploymentKey = [infoDictionary objectForKey:@"CodePushDeploymentKey"];
    NSString *serverURL = [infoDictionary objectForKey:@"CodePushServerURL"];
    NSString *publicKey = [infoDictionary objectForKey:@"CodePushPublicKey"];
		NSString *commonHash = [infoDictionary objectForKey:@"CommonBundleHash"];
    
    NSUserDefaults *userDefaults = [NSUserDefaults standardUserDefaults];
    NSString *clientUniqueId = [userDefaults stringForKey:ClientUniqueIDConfigKey];
    if (clientUniqueId == nil) {
//        clientUniqueId = [[[UIDevice currentDevice] identifierForVendor] UUIDString];
//        [userDefaults setObject:clientUniqueId forKey:ClientUniqueIDConfigKey];
//        [userDefaults synchronize];
        clientUniqueId = [self getClientUniqueId];
    }

    if (!serverURL) {
        serverURL = @"https://codepush.azurewebsites.net/";
    }
    
    _configDictionary = [NSMutableDictionary dictionary];

    if (appVersion) [_configDictionary setObject:appVersion forKey:AppVersionConfigKey];
    if (buildVersion) [_configDictionary setObject:buildVersion forKey:BuildVersionConfigKey];
    if (serverURL) [_configDictionary setObject:serverURL forKey:ServerURLConfigKey];
    if (clientUniqueId) [_configDictionary setObject:clientUniqueId forKey:ClientUniqueIDConfigKey];
    if (deploymentKey) [_configDictionary setObject:deploymentKey forKey:DeploymentKeyConfigKey];
    if (publicKey) [_configDictionary setObject:publicKey forKey:PublicKeyKey];
	
		if (commonHash) [_configDictionary setObject:commonHash forKey:CommonHash];
	
		CPLog(@"_configDictionary：%@", _configDictionary);

    return self;
}

- (NSString *)appVersion
{
    return [_configDictionary objectForKey:AppVersionConfigKey];
}

- (NSString *)buildVersion
{
    return [_configDictionary objectForKey:BuildVersionConfigKey];
}

- (NSDictionary *)configuration
{
		NSMutableDictionary *newDic = [NSMutableDictionary dictionaryWithDictionary:_configDictionary];
		
		NSString *clientUniqueId = [self getClientUniqueId];
		if (clientUniqueId) {
			[newDic setObject:clientUniqueId forKey:ClientUniqueIDConfigKey];
		}
	
		return newDic;
}

- (NSString *)deploymentKey
{
    return [_configDictionary objectForKey:DeploymentKeyConfigKey];
}

- (NSString *)serverURL
{
    return [_configDictionary objectForKey:ServerURLConfigKey];
}

- (NSString *)clientUniqueId
{
	return [self getClientUniqueId];
}

- (NSString *)publicKey
{
    return [_configDictionary objectForKey:PublicKeyKey];
}

- (NSString *)basePackageHash
{
    return [_configDictionary objectForKey:BasePackageHashKey];
}

- (NSString *)commonHash {
	return [_configDictionary objectForKey:CommonHash];
}

- (void)setAppVersion:(NSString *)appVersion
{
    [_configDictionary setValue:appVersion forKey:AppVersionConfigKey];
}

- (void)setDeploymentKey:(NSString *)deploymentKey
{
    [_configDictionary setValue:deploymentKey forKey:DeploymentKeyConfigKey];
    NSString *basePackageHash = [self getBaseHashWithDeploymentKey:deploymentKey];
    if (basePackageHash) [_configDictionary setObject:basePackageHash forKey:BasePackageHashKey];
}

- (void)setServerURL:(NSString *)serverURL
{
    [_configDictionary setValue:serverURL forKey:ServerURLConfigKey];
}

- (NSString *)getBaseHashWithDeploymentKey:(NSString *)deploymentKey {
    NSString *basePackageHash = nil;
    NSString *xtCodePushConfigPath = [[NSBundle mainBundle] pathForResource:@"HDiffPatch/codepush" ofType:@"json"];
    if (xtCodePushConfigPath) {
        NSError *error = nil;
        // 读取文件内容
        NSData *jsonData = [NSData dataWithContentsOfFile:xtCodePushConfigPath];
        // 解析 JSON 数据
        NSDictionary *jsonDict = [NSJSONSerialization JSONObjectWithData:jsonData options:kNilOptions error:&error];
        if (jsonDict &&
            [jsonDict isKindOfClass:[NSDictionary class]] &&
            [jsonDict[deploymentKey] isKindOfClass:[NSDictionary class]]) {
            basePackageHash = jsonDict[deploymentKey][@"basePackageHash"];
        }
    }
		
		if (!basePackageHash && ![self.package isBinaryBundle]) {
			NSError *error;
			basePackageHash = [self.package getDynamicBundleBasePackageHash:&error];
		}
	
    return basePackageHash;
}

- (NSString *)getClientUniqueId {
	
	NSString *clientUniqueId = [self randomUUID];

	NSNumber *isPolicyGranted = [[NSUserDefaults standardUserDefaults] objectForKey:@"isPolicyGranted"];
//	CPLog(@"isPolicyGranted：%@", isPolicyGranted);

	if ([isPolicyGranted boolValue]) {
		clientUniqueId = [[[UIDevice currentDevice] identifierForVendor] UUIDString];
		
		NSUserDefaults *userDefaults = [NSUserDefaults standardUserDefaults];
		[userDefaults setObject:clientUniqueId forKey:ClientUniqueIDConfigKey];
		[userDefaults synchronize];
	}
	
//	CPLog(@"clientUniqueId：%@", clientUniqueId);
	return clientUniqueId;
}

- (NSString *)randomUUID {
		if(NSClassFromString(@"NSUUID")) {
				return [[NSUUID UUID] UUIDString];
		}
		CFUUIDRef uuidRef = CFUUIDCreate(kCFAllocatorDefault);
		CFStringRef cfuuid = CFUUIDCreateString(kCFAllocatorDefault, uuidRef);
		CFRelease(uuidRef);
		NSString *uuid = [((__bridge NSString *) cfuuid) copy];
		CFRelease(cfuuid);
		return uuid;
}

//no setter for PublicKey, because it's need to be hard coded within Info.plist for safety

@end

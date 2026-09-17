//
//  XTCodePushLabelCompare.h
//  react-native-xrn-bundle
//
//  Created by  xtgq on 2026/5/21.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface XTCodePushLabelCompare : NSObject

+ (BOOL)isLabelNewer:(nullable NSString *)newer than:(nullable NSString *)older;

@end

NS_ASSUME_NONNULL_END

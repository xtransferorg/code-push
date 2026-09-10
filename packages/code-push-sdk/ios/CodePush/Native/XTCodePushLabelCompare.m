//
//  XTCodePushLabelCompare.m
//  react-native-xrn-bundle
//
//  Created by  xtgq on 2026/5/21.
//

#import "XTCodePushLabelCompare.h"

@implementation XTCodePushLabelCompare

+ (BOOL)isLabelNewer:(NSString *)newer than:(NSString *)older {
	if ([self isBlank:newer]) return YES;
	if ([self isBlank:older]) return YES;

	NSNumber *newerNum = [self parseLabelNumber:newer];
	if (newerNum == nil) return NO;

	NSNumber *olderNum = [self parseLabelNumber:older];
	if (olderNum == nil) return NO;

	return newerNum.integerValue > olderNum.integerValue;
}

#pragma mark - Helpers

+ (BOOL)isBlank:(NSString *)s {
	if (s == nil) return YES;
	NSString *trimmed = [s stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
	return trimmed.length == 0;
}

+ (NSNumber *)parseLabelNumber:(NSString *)label {
	NSUInteger i = 0;
	while (i < label.length && [label characterAtIndex:i] == 'v') {
		i++;
	}
	NSString *numPart = [label substringFromIndex:i];
	if (numPart.length == 0) return nil;

	static NSCharacterSet *nonDigits;
	static dispatch_once_t onceToken;
	dispatch_once(&onceToken, ^{
		nonDigits = [[NSCharacterSet decimalDigitCharacterSet] invertedSet];
	});
	if ([numPart rangeOfCharacterFromSet:nonDigits].location != NSNotFound) {
		return nil;
	}

	return @(numPart.integerValue);
}

@end

#import "CodePush.h"

void CPLog(NSString *formatString, ...) {
	NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
	[formatter setDateFormat:@"HH:mm:ss.SSS"];
	NSString *timeString = [formatter stringFromDate:[NSDate date]];

	va_list args;
	va_start(args, formatString);
	NSString *prependedFormatString = [NSString stringWithFormat:@"\n[%@] [CodePush] %@", timeString, formatString];
	NSLogv(prependedFormatString, args);
	va_end(args);
}

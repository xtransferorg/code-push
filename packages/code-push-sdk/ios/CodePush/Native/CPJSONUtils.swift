//
//  CPJSONUtils.swift
//  CodePush
//
//  Created by  xtgq on 2025/8/11.
//

import Foundation

@objcMembers
public class CPJSONUtils: NSObject {
	
	/// JSON字符串转字典
	/// - Parameter jsonString: 需要转换的 JSON 字符串
	/// - Returns: NSDictionary 或 nil
	@objc public static func jsonStringToDictionary(_ jsonString: Any?) -> NSDictionary? {
		guard let str = jsonString as? String, !str.isEmpty else {
			print("[JSONUtils] 输入的 JSON 字符串为空或不是字符串类型")
			return nil
		}
		
		guard let data = str.data(using: .utf8) else {
			print("[JSONUtils] 无法将字符串转换为数据")
			return nil
		}
		
		do {
			let obj = try JSONSerialization.jsonObject(with: data, options: [])
			if let dict = obj as? NSDictionary {
				return dict
			} else {
				print("[JSONUtils] 解析结果不是字典")
				return nil
			}
		} catch {
			print("[JSONUtils] JSON 解析失败: \(error.localizedDescription)")
			return nil
		}
	}
	
	/// 字典转JSON字符串
	/// - Parameter dictionary: 需要转换的 NSDictionary
	/// - Returns: NSString 或 nil
	@objc public static func dictionaryToJsonString(_ dictionary: Any?) -> NSString? {
		guard let dict = dictionary as? NSDictionary else {
			print("[JSONUtils] 输入的字典为 nil 或不是 NSDictionary 类型")
			return nil
		}
		
		do {
			let data = try JSONSerialization.data(withJSONObject: dict, options: [])
			guard let jsonString = String(data: data, encoding: .utf8), !jsonString.isEmpty else {
				return nil
			}
			return jsonString as NSString
		} catch {
			print("[JSONUtils] 无法将字典转换为 JSON 数据: \(error.localizedDescription)")
			return nil
		}
	}
	
}

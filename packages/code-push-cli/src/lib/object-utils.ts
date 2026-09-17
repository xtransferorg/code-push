/**
 * 将字符串从 snake_case 转换为 camelCase
 * @param str snake_case 格式的字符串
 * @returns camelCase 格式的字符串
 */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

/**
 * 递归地将对象的所有键从 snake_case 转换为 camelCase
 * @param obj 要转换的对象
 * @returns 转换后的对象
 */
export function keysToCamelCase<T = any>(obj: any): T {
  if (obj === null || obj === undefined) {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => keysToCamelCase(item)) as any
  }

  if (typeof obj !== 'object') {
    return obj
  }

  const converted: any = {}

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const camelKey = snakeToCamel(key)
      const value = obj[key]

      if (value === null || value === undefined) {
        converted[camelKey] = value
      } else if (Array.isArray(value)) {
        converted[camelKey] = value.map((item) => keysToCamelCase(item))
      } else if (typeof value === 'object' && value.constructor === Object) {
        converted[camelKey] = keysToCamelCase(value)
      } else {
        converted[camelKey] = value
      }
    }
  }

  return converted as T
}

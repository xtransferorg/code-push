import resourceManager from '@ohos.resourceManager';
import { common } from "@kit.AbilityKit"

export function rawfileExists(context: common.Context, name: string): boolean {
  try {
    const fd = context.resourceManager.getRawFdSync(name);
    // 如果文件存在，会返回 descriptor
    return fd !== undefined && fd !== null;
  } catch (_) {
    return false;
  }
}

export function getRawFileBundleName(bundleName: string): string {
  return `oh.${bundleName}.bundle`
}
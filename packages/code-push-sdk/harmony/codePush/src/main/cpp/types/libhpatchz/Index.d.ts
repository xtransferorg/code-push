/**
 * 用 HDiffPatch 引擎把 oldPath 目录的文件和diffPath进行patch，产物写到 newPath
 *
 * @param oldPath     旧文件目录
 * @param diffPath    差分文件绝对路径
 * @param newPath     要生成的新文件绝对路径
 * @param cacheMemory 默认值：-1
 * @returns 0 表示成功
 */
export const patch: (
  oldPath: string,
  diffPath: string,
  newPath: string,
  cacheMemory?: number
) => number;

export default { patch };

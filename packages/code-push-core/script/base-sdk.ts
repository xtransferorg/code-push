// @ts-nocheck
import superagent = require('superagent')

/**
 * SDK 基类
 * 提供统一的错误处理和请求封装
 */
class BaseSdk {
  protected _serverUrl: string
  protected _accessKey: string

  constructor(serverUrl: string, accessKey: string) {
    this._serverUrl = serverUrl
    this._accessKey = accessKey
  }

  /**
   * 统一处理错误，提取服务器返回的详细错误信息
   * @param err 错误对象
   * @returns 格式化的错误对象
   */
  protected _handleError(err: any): Error {
    if (!err) {
      return new Error('未知错误')
    }

    // 如果有响应体，优先使用响应体中的错误信息
    if (err.response && err.response.body) {
      const body = err.response.body
      const statusCode = err.status || err.response.status || 'Unknown'
      const code = body.code !== undefined ? body.code : ''
      const message = body.message || body.msg || err.message || '请求失败'

      // 构造友好的错误信息
      let errorMsg = `${message}`
      if (code !== '') {
        errorMsg = `[错误代码: ${code}] ${errorMsg}`
      }
      errorMsg = `${errorMsg} (HTTP ${statusCode})`

      const error = new Error(errorMsg)
      // 保留原始错误信息，方便需要时获取
      ;(error as any).originalError = err
      ;(error as any).statusCode = statusCode
      ;(error as any).code = code
      ;(error as any).responseBody = body
      return error
    }

    // 如果有响应文本
    if (err.response && err.response.text) {
      const statusCode = err.status || err.response.status || 'Unknown'
      const error = new Error(
        `请求失败: ${err.response.text} (HTTP ${statusCode})`,
      )
      ;(error as any).originalError = err
      ;(error as any).statusCode = statusCode
      return error
    }

    // 如果只有错误消息
    if (err.message) {
      const error = new Error(`请求失败: ${err.message}`)
      ;(error as any).originalError = err
      return error
    }

    // 兜底
    const error = new Error('请求失败: 未知错误')
    ;(error as any).originalError = err
    return error
  }

  /**
   * 封装 POST 请求
   * @param path API 路径
   * @param data 请求数据
   * @param options 额外的请求选项
   * @returns Promise
   */
  protected _post<T = any>(
    path: string,
    data?: any,
    options?: {
      headers?: Record<string, string>
      extractData?: boolean // 是否自动提取 res.body.data，默认 true
    },
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const request = superagent.post(`${this._serverUrl}${path}`)

      // 设置认证头
      request.set('Authorization', `Bearer ${this._accessKey}`)
      request.set('Content-Type', 'application/json')

      // 设置额外的请求头
      if (options?.headers) {
        Object.entries(options.headers).forEach(([key, value]) => {
          request.set(key, value)
        })
      }

      // 设置请求体
      if (data) {
        request.send(data)
      }

      request.end((err: any, res: superagent.Response) => {
        if (err) {
          reject(this._handleError(err))
          return
        }

        if (res.ok) {
          const extractData = options?.extractData !== false
          resolve(extractData ? res.body?.data : res.body)
        } else {
          reject(
            this._handleError(err || { response: res, status: res.status }),
          )
        }
      })
    })
  }

  /**
   * 封装 GET 请求
   * @param path API 路径
   * @param query 查询参数
   * @param options 额外的请求选项
   * @returns Promise
   */
  protected _get<T = any>(
    path: string,
    query?: Record<string, any>,
    options?: {
      headers?: Record<string, string>
      extractData?: boolean // 是否自动提取 res.body.data，默认 true
    },
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const request = superagent.get(`${this._serverUrl}${path}`)

      // 设置认证头
      request.set('Authorization', `Bearer ${this._accessKey}`)

      // 设置额外的请求头
      if (options?.headers) {
        Object.entries(options.headers).forEach(([key, value]) => {
          request.set(key, value)
        })
      }

      // 设置查询参数
      if (query) {
        request.query(query)
      }

      request.end((err: any, res: superagent.Response) => {
        if (err) {
          reject(this._handleError(err))
          return
        }

        if (res.ok) {
          const extractData = options?.extractData !== false
          resolve(extractData ? res.body?.data : res.body)
        } else {
          reject(
            this._handleError(err || { response: res, status: res.status }),
          )
        }
      })
    })
  }

  /**
   * 封装通用请求方法（可用于文件上传等特殊场景）
   * @param callback 自定义请求回调
   * @returns Promise
   */
  protected _request<T = any>(
    callback: (
      handleError: (err: any) => Error,
    ) => Promise<T> | superagent.SuperAgentRequest,
  ): Promise<T> {
    const result = callback(this._handleError.bind(this))
    if (result instanceof Promise) {
      return result
    }
    // 如果返回的是 superagent 请求对象，这里可以进一步处理
    return result as any
  }
}

export = BaseSdk

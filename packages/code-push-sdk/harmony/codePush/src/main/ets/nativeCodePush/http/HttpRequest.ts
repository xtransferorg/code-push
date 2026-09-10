import { BusinessError } from "@kit.BasicServicesKit"
import { http } from "@kit.NetworkKit"
import { log } from "../Logging";
import { HttpRequestError } from "./HttpRequestError";
import { JSON } from "@kit.ArkTS";

/**
 * http timeout option
 */
export class HttpTimeoutOption {
  /**
   * Connection timeout interval
   */
  connectTimeoutMills?: number;
  /**
   * Read timeout period
   */
  readTimeoutMills?: number;
}

/**
 * http request options
 */
export class RequestOption extends HttpTimeoutOption {
  /**
   * url
   */
  url: string;
  /**
   * http request method
   */
  method: http.RequestMethod;
  /**
   * http request header
   */
  header?: object;
  /**
   * http request body
   */
  body?: string | object | ArrayBuffer;
}

/**
 * send http request
 * @param option
 * @returns
 */
export async function request(option: RequestOption): Promise<string> {

  return new Promise((resolve, reject) => {
    try {
      const httpRequest = http.createHttp()
      log(`HttpRequest.request:url=${option.url}, header=${option.header}, body=${option.body}`)
      httpRequest.request(option.url, {
        method: option.method,
        header: option.header,
        extraData: option.body,
        connectTimeout: option.connectTimeoutMills,
        readTimeout: option.readTimeoutMills,
      }, (err: BusinessError, data: http.HttpResponse) => {
        if (err) {
          log(`HttpRequest.request:err=${JSON.stringify(err)}`)
          reject(new HttpRequestError(err.code, err.message))
        } else if (data?.responseCode != http.ResponseCode.OK) {
          let errorMessage: any
          if (data?.responseCode === 0) {
            errorMessage =
              `Couldn't send request to ${option.url}, xhr.statusCode = 0 was returned. One of the possible reasons for that might be connection problems. Please, check your internet connection.`
          } else {
            errorMessage = `${data.responseCode}: ${data.result}`
          }
          log(`HttpRequest.request:errorMessage=${errorMessage}`)
          reject(new HttpRequestError(data?.responseCode, errorMessage))
        } else {
          const result = data?.result as string
          log(`HttpRequest.request:result=${result}`)
          resolve(result)
        }
      })
    } catch (e) {
      log(`HttpRequest.request:catch e=${e}`)
      reject(e)
    }
  })
}

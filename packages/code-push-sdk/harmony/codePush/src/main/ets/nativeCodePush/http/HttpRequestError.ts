export class HttpRequestError {
  httpCode: number
  httpMessage: string

  constructor(code: number, message: string) {
    this.httpCode = code
    this.httpMessage = message
  }
}
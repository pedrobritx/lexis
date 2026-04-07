export type ApiResponse<T> = {
  data: T
  meta?: {
    page: number
    total: number
  }
}

export type ApiError = {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

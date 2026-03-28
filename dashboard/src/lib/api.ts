/**
 * Unwraps a standard API response of the shape `{ success: boolean, data: T }`.
 * Returns `data.data` when the response is OK and `data.success` is true,
 * otherwise returns `undefined`.
 */
export async function unwrapApiResponse<T>(res: Response): Promise<T | undefined> {
  if (!res.ok) return undefined
  const data = await res.json()
  return data.success ? (data.data as T) : undefined
}

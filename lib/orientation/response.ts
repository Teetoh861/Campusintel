import { NextResponse } from 'next/server'
/** Private data, including errors and claim codes, never enters a browser or intermediary cache. */
export function quizJson(value: unknown, status = 200, headers?: Headers) {
  const response = new NextResponse(JSON.stringify(value),{ status,headers })
  response.headers.set('Content-Type','application/json')
  response.headers.set('Cache-Control','private, no-store, max-age=0')
  response.headers.set('Referrer-Policy','no-referrer')
  return response
}

import { HttpErrorResponse, HttpRequest, HttpResponse } from '@angular/common/http'
import { describe, expect, it, vi } from 'vitest'
import { lastValueFrom, of, throwError } from 'rxjs'

import { createMfeHttpAuthInterceptor } from './auth-interceptor.ts'

describe('createMfeHttpAuthInterceptor', () => {
  it('attaches a token only to declared absolute API origins without replacing caller auth', async () => {
    const getAccessToken = vi.fn().mockResolvedValue('shell-token')
    const interceptor = createMfeHttpAuthInterceptor({
      apiOrigins: ['https://api.example.test/v1/'],
      apiBaseUrl: 'https://api.example.test/v1/',
      getAccessToken,
    })
    const sent: HttpRequest<unknown>[] = []
    const next = (request: HttpRequest<unknown>) => {
      sent.push(request)
      return of(new HttpResponse({ status: 200 }))
    }

    await lastValueFrom(
      interceptor(new HttpRequest('GET', 'https://api.example.test/v1/jobs'), next),
    )
    await lastValueFrom(
      interceptor(new HttpRequest('GET', 'https://other.example.test/jobs'), next),
    )
    await lastValueFrom(
      interceptor(new HttpRequest('GET', 'https://api.example.test/v1-extra'), next),
    )
    await lastValueFrom(interceptor(new HttpRequest('GET', '/jobs'), next))
    await lastValueFrom(
      interceptor(
        new HttpRequest('GET', 'https://api.example.test/v1/jobs').clone({
          setHeaders: { Authorization: 'Bearer caller-token' },
        }),
        next,
      ),
    )

    expect(sent.map(request => request.headers.get('Authorization'))).toEqual([
      'Bearer shell-token',
      null,
      null,
      null,
      'Bearer caller-token',
    ])
    expect(getAccessToken).toHaveBeenCalledTimes(1)
  })

  it('refreshes once on a 401 and preserves the original error when renewal cannot help', async () => {
    const rejected = new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' })
    const getAccessToken = vi.fn().mockResolvedValueOnce('expired').mockResolvedValueOnce('renewed')
    const interceptor = createMfeHttpAuthInterceptor({
      apiOrigins: ['https://api.example.test'],
      apiBaseUrl: 'https://api.example.test/v1',
      getAccessToken,
    })
    const sent: string[] = []
    const next = (request: HttpRequest<unknown>) => {
      sent.push(request.headers.get('Authorization') ?? '')
      return sent.length === 1 ? throwError(() => rejected) : of(new HttpResponse({ status: 200 }))
    }

    await expect(
      lastValueFrom(interceptor(new HttpRequest('GET', 'https://api.example.test/v1/jobs'), next)),
    ).resolves.toBeInstanceOf(HttpResponse)
    expect(sent).toEqual(['Bearer expired', 'Bearer renewed'])
    expect(getAccessToken).toHaveBeenNthCalledWith(2, { rejectedToken: 'expired' })

    const unchanged = createMfeHttpAuthInterceptor({
      apiOrigins: ['https://api.example.test'],
      apiBaseUrl: 'https://api.example.test/v1',
      getAccessToken: vi.fn().mockResolvedValue('expired'),
    })
    const original = vi.fn(() => throwError(() => rejected))
    await expect(
      lastValueFrom(
        unchanged(new HttpRequest('GET', 'https://api.example.test/v1/jobs'), original),
      ),
    ).rejects.toBe(rejected)
    expect(original).toHaveBeenCalledTimes(1)
  })
})

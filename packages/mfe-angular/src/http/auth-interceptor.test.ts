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

  it("authenticates every declared origin, and holds only apiBaseUrl's own origin to its path", async () => {
    const interceptor = createMfeHttpAuthInterceptor({
      apiOrigins: ['https://jobs.example.test', 'https://reports.example.test'],
      apiBaseUrl: 'https://jobs.example.test/v1/',
      getAccessToken: vi.fn().mockResolvedValue('shell-token'),
    })
    const sent: HttpRequest<unknown>[] = []
    const next = (request: HttpRequest<unknown>) => {
      sent.push(request)
      return of(new HttpResponse({ status: 200 }))
    }

    for (const url of [
      'https://reports.example.test/summary',
      'https://jobs.example.test/v1/jobs',
      'https://jobs.example.test/admin',
    ]) {
      await lastValueFrom(interceptor(new HttpRequest('GET', url), next))
    }

    expect(sent.map(request => request.headers.get('Authorization'))).toEqual([
      'Bearer shell-token',
      'Bearer shell-token',
      null,
    ])
  })

  it('matches a relative URL where HttpClient sends it, without redirecting it', async () => {
    const documentOrigin = new URL(document.baseURI).origin
    const sent: HttpRequest<unknown>[] = []
    const next = (request: HttpRequest<unknown>) => {
      sent.push(request)
      return of(new HttpResponse({ status: 200 }))
    }
    const sameOriginApi = createMfeHttpAuthInterceptor({
      apiOrigins: [documentOrigin],
      getAccessToken: vi.fn().mockResolvedValue('shell-token'),
    })
    const crossOriginApi = createMfeHttpAuthInterceptor({
      apiOrigins: ['https://api.example.test'],
      apiBaseUrl: 'https://api.example.test/v1/',
      getAccessToken: vi.fn().mockResolvedValue('shell-token'),
    })

    await lastValueFrom(sameOriginApi(new HttpRequest('GET', '/v1/jobs'), next))
    await lastValueFrom(crossOriginApi(new HttpRequest('GET', 'jobs'), next))

    expect(sent.map(request => [request.url, request.headers.get('Authorization')])).toEqual([
      ['/v1/jobs', 'Bearer shell-token'],
      ['jobs', null],
    ])
  })

  it('rejects an origin that could never match a request, as #mfe/fetch does', () => {
    for (const origin of ['file:///tmp/api', 'https://*.example.test', 'not a url']) {
      expect(() =>
        createMfeHttpAuthInterceptor({ apiOrigins: [origin], getAccessToken: vi.fn() }),
      ).toThrow(expect.objectContaining({ code: 'config/invalid' }))
    }
  })
})

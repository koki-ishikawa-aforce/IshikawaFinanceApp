import { describe, it, expect } from 'vitest'
import { ZodError } from 'zod'
import { readFormBody, readJsonObjectBody } from '../src/read-json-object-body.js'

describe('readJsonObjectBody', () => {
  it('空ボディは {} として扱う', () => {
    expect(readJsonObjectBody('')).toEqual({})
  })

  it('正しい JSON はそのまま返す', () => {
    expect(readJsonObjectBody('{"a":1}')).toEqual({ a: 1 })
  })

  it('不正な JSON は ZodError（400 に写像）を throw する', () => {
    expect(() => readJsonObjectBody('{ not json')).toThrow(ZodError)
  })
})

describe('readFormBody', () => {
  it('読み取りが成功すればその結果をそのまま返す', async () => {
    await expect(readFormBody(() => Promise.resolve({ a: 1 }))).resolves.toEqual({ a: 1 })
  })

  it('読み取りが例外を投げても、その中身は伝播させず ZodError（400 に写像）に写像する', async () => {
    const rawError = new TypeError('生ボディの断片を含みうる内部エラー')
    await expect(readFormBody(() => Promise.reject(rawError))).rejects.toThrow(ZodError)
  })
})

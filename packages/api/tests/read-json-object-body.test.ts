import { describe, it, expect } from 'vitest'
import { ZodError } from 'zod'
import { readJsonObjectBody } from '../src/read-json-object-body.js'

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
